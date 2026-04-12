"""
SnapState SDK Client

Supports both synchronous and asynchronous usage patterns.

Usage (sync):
    from snapstate_sdk import SnapStateClient

    client = SnapStateClient(api_key="snp_...", base_url="http://localhost:3000")

    result = client.save(
        workflow_id="wf_001",
        step=1,
        label="init",
        state={"key": "value"},
    )

    resumed = client.resume("wf_001")
    history = client.replay("wf_001")

    client.register_agent(agent_id="my-bot", name="My Bot")
    client.close()

Usage (async):
    import asyncio
    from snapstate_sdk import SnapStateClient

    async def main():
        client = SnapStateClient(api_key="snp_...", base_url="http://localhost:3000")
        result = await client.async_save(workflow_id="wf_001", step=1, state={})
        await client.async_close()

    asyncio.run(main())

Context manager (sync):
    with SnapStateClient(api_key="snp_...") as client:
        client.save(...)

Context manager (async):
    async with SnapStateClient(api_key="snp_...") as client:
        await client.async_save(...)
"""

import asyncio
import json as _json
import time
from typing import Optional

import httpx

from .errors import (
    AuthError,
    SnapStateError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    RateLimitError,
    ValidationError,
)
from .types import Agent, Checkpoint, SaveResult, WorkflowResume, WorkflowReplay


class SnapStateClient:
    """
    Client for the SnapState API.

    Parameters
    ----------
    api_key : str
        Your API key (begins with ``snp_``).
    base_url : str
        Base URL for SnapState. Defaults to ``http://localhost:3000``.
    timeout : float
        HTTP request timeout in seconds. Defaults to 30.0.
    max_retries : int
        Maximum number of attempts before raising :class:`RateLimitError` on 429.
        Defaults to 3.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:3000",
        timeout: float = 30.0,
        max_retries: int = 3,
        _sync_transport: Optional[httpx.BaseTransport] = None,
        _async_transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        if not api_key:
            raise ValueError("api_key is required")

        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries

        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout
        self._async_transport = _async_transport

        self._sync_client = httpx.Client(
            headers=self._headers,
            timeout=timeout,
            transport=_sync_transport,
        )
        self._async_client: Optional[httpx.AsyncClient] = None

    # ---------------------------------------------------------------------------
    # Internal helpers
    # ---------------------------------------------------------------------------

    def _get_async_client(self) -> httpx.AsyncClient:
        """Lazily create the async httpx client on first use."""
        if self._async_client is None:
            self._async_client = httpx.AsyncClient(
                headers=self._headers,
                timeout=self._timeout,
                transport=self._async_transport,
            )
        return self._async_client

    def _handle_response(self, response: httpx.Response) -> None:
        """Raise a typed exception for any non-2xx response."""
        if response.status_code < 400:
            return

        try:
            body = response.json()
            message = body.get("error", {}).get("message", response.text)
            code = body.get("error", {}).get("code", "")
        except Exception:
            message = response.text
            code = ""

        status = response.status_code

        if status == 401:
            raise AuthError(message, 401, code)
        elif status == 404:
            raise NotFoundError(message, 404, code)
        elif status == 409:
            raise ConflictError(message, 409, code)
        elif status == 413:
            raise PayloadTooLargeError(message, 413, code)
        elif status == 429:
            retry_after = int(response.headers.get("Retry-After", 1))
            raise RateLimitError(message, retry_after=retry_after)
        elif status == 400:
            raise ValidationError(message, 400, code)
        else:
            raise SnapStateError(message, status, code)

    def _request_with_retry(self, method: str, url: str, **kwargs) -> httpx.Response:
        """Make an HTTP request, retrying on 429 with exponential back-off."""
        last_error: Optional[RateLimitError] = None

        for attempt in range(self.max_retries):
            response = self._sync_client.request(method, url, **kwargs)

            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", 1))
                wait = min(retry_after * (2 ** attempt), 30)
                time.sleep(wait)
                last_error = RateLimitError("Rate limit exceeded — retry exhausted", retry_after=retry_after)
                continue

            self._handle_response(response)
            return response

        raise last_error

    async def _async_request_with_retry(self, method: str, url: str, **kwargs) -> httpx.Response:
        """Async equivalent of _request_with_retry."""
        last_error: Optional[RateLimitError] = None
        client = self._get_async_client()

        for attempt in range(self.max_retries):
            response = await client.request(method, url, **kwargs)

            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", 1))
                wait = min(retry_after * (2 ** attempt), 30)
                await asyncio.sleep(wait)
                last_error = RateLimitError("Rate limit exceeded — retry exhausted", retry_after=retry_after)
                continue

            self._handle_response(response)
            return response

        raise last_error

    @staticmethod
    def _parse_checkpoint(data: dict) -> Checkpoint:
        """Convert a raw API dict into a Checkpoint dataclass."""
        meta = data.get("metadata") or {}
        return Checkpoint(
            checkpoint_id=data.get("checkpoint_id", ""),
            workflow_id=data.get("workflow_id", ""),
            step=data.get("step", 0),
            label=data.get("label"),
            state=data.get("state", {}),
            metadata=meta,
            etag=data.get("etag"),
            created_at=data.get("created_at"),
            diff_from_previous=data.get("diff_from_previous"),
            size_bytes=data.get("size_bytes"),
            # agent_id is either a top-level field or stored inside metadata
            agent_id=data.get("agent_id") or meta.get("agent_id"),
        )

    @staticmethod
    def _build_body(**kwargs) -> bytes:
        """Serialize keyword arguments (excluding None values) to JSON bytes."""
        return _json.dumps({k: v for k, v in kwargs.items() if v is not None}).encode("utf-8")

    # ---------------------------------------------------------------------------
    # Sync: Checkpoints
    # ---------------------------------------------------------------------------

    def save(
        self,
        workflow_id: str,
        step: int,
        state: dict,
        label: Optional[str] = None,
        metadata: Optional[dict] = None,
        agent_id: Optional[str] = None,
        ttl_seconds: Optional[int] = None,
        if_match: Optional[str] = None,
    ) -> SaveResult:
        """
        Save a checkpoint for a workflow step.

        Parameters
        ----------
        workflow_id : str
            Unique identifier for this workflow run.
        step : int
            Sequential step number (1, 2, 3…).
        state : dict
            The full workflow state to persist.
        label : str, optional
            Short human-readable label for this step.
        metadata : dict, optional
            Arbitrary metadata to store alongside the checkpoint.
        agent_id : str, optional
            Agent identity tag — stored in checkpoint metadata.
        ttl_seconds : int, optional
            Override the default TTL via ``X-Checkpoint-TTL`` header.
        if_match : str, optional
            ETag for optimistic concurrency — raises :class:`ConflictError` on mismatch.

        Returns
        -------
        SaveResult
        """
        body: dict = {"workflow_id": workflow_id, "step": step, "state": state}
        if label is not None:
            body["label"] = label
        if agent_id is not None:
            body["agent_id"] = agent_id
        if metadata is not None:
            body["metadata"] = metadata

        extra_headers = {}
        if ttl_seconds is not None:
            extra_headers["X-Checkpoint-TTL"] = str(ttl_seconds)
        if if_match is not None:
            extra_headers["If-Match"] = if_match

        response = self._request_with_retry(
            "POST",
            f"{self.base_url}/checkpoints",
            content=_json.dumps(body).encode("utf-8"),
            headers=extra_headers,
        )
        data = response.json()
        return SaveResult(
            checkpoint_id=data["checkpoint_id"],
            workflow_id=data["workflow_id"],
            step=data["step"],
            etag=data["etag"],
            created_at=data["created_at"],
            diff_from_previous=data.get("diff_from_previous", {}),
            size_bytes=data["size_bytes"],
        )

    def get(self, checkpoint_id: str) -> Checkpoint:
        """
        Retrieve a specific checkpoint by ID.

        Parameters
        ----------
        checkpoint_id : str

        Returns
        -------
        Checkpoint

        Raises
        ------
        NotFoundError
            If the checkpoint does not exist.
        """
        response = self._request_with_retry(
            "GET",
            f"{self.base_url}/checkpoints/{checkpoint_id}",
        )
        return self._parse_checkpoint(response.json())

    def resume(self, workflow_id: str) -> WorkflowResume:
        """
        Get the latest checkpoint state to resume a workflow.

        Parameters
        ----------
        workflow_id : str

        Returns
        -------
        WorkflowResume

        Raises
        ------
        NotFoundError
            If no checkpoints exist for the workflow.
        """
        response = self._request_with_retry(
            "GET",
            f"{self.base_url}/workflows/{workflow_id}/resume",
        )
        data = response.json()
        return WorkflowResume(
            workflow_id=data["workflow_id"],
            latest_checkpoint=self._parse_checkpoint(data["latest_checkpoint"]),
            total_checkpoints=data["total_checkpoints"],
            workflow_started_at=data.get("workflow_started_at"),
            last_activity_at=data.get("last_activity_at"),
        )

    def replay(
        self,
        workflow_id: str,
        from_step: Optional[int] = None,
        to_step: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> WorkflowReplay:
        """
        Get the full ordered checkpoint history for a workflow.

        Parameters
        ----------
        workflow_id : str
        from_step : int, optional
            Only return checkpoints at or after this step number.
        to_step : int, optional
            Only return checkpoints at or before this step number.
        limit : int, optional
            Maximum number of checkpoints to return (default 100, max 1000).

        Returns
        -------
        WorkflowReplay
        """
        params = {}
        if from_step is not None:
            params["from_step"] = str(from_step)
        if to_step is not None:
            params["to_step"] = str(to_step)
        if limit is not None:
            params["limit"] = str(limit)

        response = self._request_with_retry(
            "GET",
            f"{self.base_url}/workflows/{workflow_id}/replay",
            params=params,
        )
        data = response.json()
        return WorkflowReplay(
            workflow_id=data["workflow_id"],
            checkpoints=[self._parse_checkpoint(cp) for cp in data.get("checkpoints", [])],
            total=data["total"],
            has_more=data.get("has_more", False),
        )

    # ---------------------------------------------------------------------------
    # Sync: Agents
    # ---------------------------------------------------------------------------

    def register_agent(
        self,
        agent_id: str,
        name: str,
        description: Optional[str] = None,
        capabilities: Optional[list] = None,
        metadata: Optional[dict] = None,
    ) -> Agent:
        """
        Register or update an agent identity (upsert).

        Parameters
        ----------
        agent_id : str
            Unique identifier for this agent (alphanumeric, underscores, hyphens).
        name : str
            Human-readable display name.
        description : str, optional
        capabilities : list[str], optional
            List of capability strings (e.g. ``["web_search", "summarization"]``).
        metadata : dict, optional
            Arbitrary metadata (model name, version, framework, etc.).

        Returns
        -------
        Agent
        """
        body: dict = {"agent_id": agent_id, "name": name}
        if description is not None:
            body["description"] = description
        if capabilities is not None:
            body["capabilities"] = capabilities
        if metadata is not None:
            body["metadata"] = metadata

        response = self._request_with_retry(
            "POST",
            f"{self.base_url}/agents",
            content=_json.dumps(body).encode("utf-8"),
        )
        return self._parse_agent(response.json())

    def list_agents(self) -> list:
        """
        List all agents registered for this account.

        Returns
        -------
        list[Agent]
        """
        response = self._request_with_retry("GET", f"{self.base_url}/agents")
        data = response.json()
        return [self._parse_agent(a) for a in data.get("agents", [])]

    # ---------------------------------------------------------------------------
    # Sync: Webhooks
    # ---------------------------------------------------------------------------

    def register_webhook(self, url: str, events: list, secret: Optional[str] = None) -> dict:
        """
        Register a webhook URL to receive events.

        Parameters
        ----------
        url : str
            HTTPS endpoint that will receive POST requests.
        events : list[str]
            One or more of ``checkpoint.saved``, ``workflow.resumed``, ``workflow.expired``.
        secret : str, optional
            HMAC signing secret — if provided, requests include an ``X-Checkpoint-Signature`` header.

        Returns
        -------
        dict
            Raw response containing ``webhook_id``, ``url``, ``events``, ``created_at``.
        """
        body: dict = {"url": url, "events": events}
        if secret is not None:
            body["secret"] = secret

        response = self._request_with_retry(
            "POST",
            f"{self.base_url}/webhooks",
            content=_json.dumps(body).encode("utf-8"),
        )
        return response.json()

    # ---------------------------------------------------------------------------
    # Sync: Lifecycle
    # ---------------------------------------------------------------------------

    def close(self) -> None:
        """Close the underlying sync HTTP client and release connections."""
        self._sync_client.close()

    # ---------------------------------------------------------------------------
    # Async: Checkpoints
    # ---------------------------------------------------------------------------

    async def async_save(
        self,
        workflow_id: str,
        step: int,
        state: dict,
        label: Optional[str] = None,
        metadata: Optional[dict] = None,
        agent_id: Optional[str] = None,
        ttl_seconds: Optional[int] = None,
        if_match: Optional[str] = None,
    ) -> SaveResult:
        """Async version of :meth:`save`."""
        body: dict = {"workflow_id": workflow_id, "step": step, "state": state}
        if label is not None:
            body["label"] = label
        if agent_id is not None:
            body["agent_id"] = agent_id
        if metadata is not None:
            body["metadata"] = metadata

        extra_headers = {}
        if ttl_seconds is not None:
            extra_headers["X-Checkpoint-TTL"] = str(ttl_seconds)
        if if_match is not None:
            extra_headers["If-Match"] = if_match

        response = await self._async_request_with_retry(
            "POST",
            f"{self.base_url}/checkpoints",
            content=_json.dumps(body).encode("utf-8"),
            headers=extra_headers,
        )
        data = response.json()
        return SaveResult(
            checkpoint_id=data["checkpoint_id"],
            workflow_id=data["workflow_id"],
            step=data["step"],
            etag=data["etag"],
            created_at=data["created_at"],
            diff_from_previous=data.get("diff_from_previous", {}),
            size_bytes=data["size_bytes"],
        )

    async def async_get(self, checkpoint_id: str) -> Checkpoint:
        """Async version of :meth:`get`."""
        response = await self._async_request_with_retry(
            "GET",
            f"{self.base_url}/checkpoints/{checkpoint_id}",
        )
        return self._parse_checkpoint(response.json())

    async def async_resume(self, workflow_id: str) -> WorkflowResume:
        """Async version of :meth:`resume`."""
        response = await self._async_request_with_retry(
            "GET",
            f"{self.base_url}/workflows/{workflow_id}/resume",
        )
        data = response.json()
        return WorkflowResume(
            workflow_id=data["workflow_id"],
            latest_checkpoint=self._parse_checkpoint(data["latest_checkpoint"]),
            total_checkpoints=data["total_checkpoints"],
            workflow_started_at=data.get("workflow_started_at"),
            last_activity_at=data.get("last_activity_at"),
        )

    async def async_replay(
        self,
        workflow_id: str,
        from_step: Optional[int] = None,
        to_step: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> WorkflowReplay:
        """Async version of :meth:`replay`."""
        params = {}
        if from_step is not None:
            params["from_step"] = str(from_step)
        if to_step is not None:
            params["to_step"] = str(to_step)
        if limit is not None:
            params["limit"] = str(limit)

        response = await self._async_request_with_retry(
            "GET",
            f"{self.base_url}/workflows/{workflow_id}/replay",
            params=params,
        )
        data = response.json()
        return WorkflowReplay(
            workflow_id=data["workflow_id"],
            checkpoints=[self._parse_checkpoint(cp) for cp in data.get("checkpoints", [])],
            total=data["total"],
            has_more=data.get("has_more", False),
        )

    async def async_register_agent(
        self,
        agent_id: str,
        name: str,
        description: Optional[str] = None,
        capabilities: Optional[list] = None,
        metadata: Optional[dict] = None,
    ) -> Agent:
        """Async version of :meth:`register_agent`."""
        body: dict = {"agent_id": agent_id, "name": name}
        if description is not None:
            body["description"] = description
        if capabilities is not None:
            body["capabilities"] = capabilities
        if metadata is not None:
            body["metadata"] = metadata

        response = await self._async_request_with_retry(
            "POST",
            f"{self.base_url}/agents",
            content=_json.dumps(body).encode("utf-8"),
        )
        return self._parse_agent(response.json())

    async def async_list_agents(self) -> list:
        """Async version of :meth:`list_agents`."""
        response = await self._async_request_with_retry("GET", f"{self.base_url}/agents")
        data = response.json()
        return [self._parse_agent(a) for a in data.get("agents", [])]

    async def async_close(self) -> None:
        """Close the underlying async HTTP client and release connections."""
        if self._async_client is not None:
            await self._async_client.aclose()
            self._async_client = None

    # ---------------------------------------------------------------------------
    # Context manager support
    # ---------------------------------------------------------------------------

    def __enter__(self) -> "SnapStateClient":
        return self

    def __exit__(self, *args) -> None:
        self.close()

    async def __aenter__(self) -> "SnapStateClient":
        return self

    async def __aexit__(self, *args) -> None:
        await self.async_close()

    # ---------------------------------------------------------------------------
    # Private parse helpers
    # ---------------------------------------------------------------------------

    @staticmethod
    def _parse_agent(data: dict) -> Agent:
        """Convert a raw API dict into an Agent dataclass."""
        return Agent(
            agent_id=data.get("agent_id", ""),
            name=data.get("name", ""),
            description=data.get("description"),
            capabilities=data.get("capabilities") or [],
            metadata=data.get("metadata") or {},
            last_seen_at=data.get("last_seen_at"),
            created_at=data.get("created_at"),
        )


# Deprecated alias
CheckpointClient = SnapStateClient
