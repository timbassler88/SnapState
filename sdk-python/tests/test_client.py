"""
Tests for the Checkpoint Python SDK.

Uses custom httpx transports to mock HTTP calls — no real server required.
"""

import json
import pytest
import httpx

from snapstate_sdk import SnapStateClient
from snapstate_sdk.errors import (
    AuthError,
    ConflictError,
    NotFoundError,
    RateLimitError,
    ValidationError,
)
from snapstate_sdk.types import Agent, Checkpoint, SaveResult, WorkflowResume, WorkflowReplay


# ---------------------------------------------------------------------------
# Mock transport helpers
# ---------------------------------------------------------------------------

class SyncMockTransport(httpx.BaseTransport):
    """
    Sync transport that serves pre-canned (status_code, body) responses in order.
    Captured requests are stored in ``self.requests`` for assertion.
    """

    def __init__(self, responses: list):
        self._responses = list(responses)
        self._index = 0
        self.requests: list[httpx.Request] = []

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status_code, body = self._responses[self._index]
        self._index = min(self._index + 1, len(self._responses) - 1)
        content = json.dumps(body).encode("utf-8") if body is not None else b""
        return httpx.Response(
            status_code=status_code,
            content=content,
            headers={"content-type": "application/json"},
            request=request,
        )


class AsyncMockTransport(httpx.AsyncBaseTransport):
    """Async equivalent of SyncMockTransport."""

    def __init__(self, responses: list):
        self._responses = list(responses)
        self._index = 0
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status_code, body = self._responses[self._index]
        self._index = min(self._index + 1, len(self._responses) - 1)
        content = json.dumps(body).encode("utf-8") if body is not None else b""
        return httpx.Response(
            status_code=status_code,
            content=content,
            headers={"content-type": "application/json"},
            request=request,
        )


def make_client(responses: list, max_retries: int = 3) -> tuple[SnapStateClient, SyncMockTransport]:
    """Create a SnapStateClient backed by a SyncMockTransport."""
    transport = SyncMockTransport(responses)
    client = SnapStateClient(
        api_key="snp_test",
        base_url="http://testserver",
        max_retries=max_retries,
        _sync_transport=transport,
    )
    return client, transport


def make_async_client(responses: list, max_retries: int = 3) -> tuple[SnapStateClient, AsyncMockTransport]:
    """Create a SnapStateClient backed by an AsyncMockTransport."""
    transport = AsyncMockTransport(responses)
    client = SnapStateClient(
        api_key="snp_test",
        base_url="http://testserver",
        max_retries=max_retries,
        _async_transport=transport,
    )
    return client, transport


# ---------------------------------------------------------------------------
# Sample fixtures
# ---------------------------------------------------------------------------

SAVE_RESPONSE = {
    "checkpoint_id": "cp_wf_001_0001",
    "workflow_id": "wf_001",
    "step": 1,
    "etag": "abc123",
    "created_at": "2026-04-10T12:00:00Z",
    "diff_from_previous": {"added": [], "removed": [], "changed": []},
    "size_bytes": 128,
}

CHECKPOINT_RESPONSE = {
    "checkpoint_id": "cp_wf_001_0001",
    "workflow_id": "wf_001",
    "step": 1,
    "label": "init",
    "state": {"progress": 0},
    "metadata": {"agent_id": "my-bot"},
    "etag": "abc123",
    "created_at": "2026-04-10T12:00:00Z",
    "size_bytes": 128,
}

RESUME_RESPONSE = {
    "workflow_id": "wf_001",
    "latest_checkpoint": CHECKPOINT_RESPONSE,
    "total_checkpoints": 1,
    "workflow_started_at": "2026-04-10T11:00:00Z",
    "last_activity_at": "2026-04-10T12:00:00Z",
}

REPLAY_RESPONSE = {
    "workflow_id": "wf_001",
    "checkpoints": [CHECKPOINT_RESPONSE],
    "total": 1,
    "has_more": False,
}

AGENT_RESPONSE = {
    "agent_id": "research-bot",
    "name": "Research Bot",
    "description": "Finds things",
    "capabilities": ["search"],
    "metadata": {"model": "test"},
    "last_seen_at": None,
    "created_at": "2026-04-10T10:00:00Z",
}


# ---------------------------------------------------------------------------
# Tests: save checkpoint
# ---------------------------------------------------------------------------

def test_save_checkpoint():
    client, transport = make_client([(201, SAVE_RESPONSE)])

    result = client.save(workflow_id="wf_001", step=1, state={"progress": 0})

    assert isinstance(result, SaveResult)
    assert result.checkpoint_id == "cp_wf_001_0001"
    assert result.workflow_id == "wf_001"
    assert result.step == 1
    assert result.etag == "abc123"
    assert result.size_bytes == 128
    client.close()


def test_save_with_agent_id():
    client, transport = make_client([(201, SAVE_RESPONSE)])

    client.save(
        workflow_id="wf_001",
        step=1,
        state={"x": 1},
        agent_id="research-bot",
        label="step_1",
        metadata={"source": "test"},
    )

    # Verify agent_id was included in the request body
    req = transport.requests[0]
    body = json.loads(req.content)
    assert body["agent_id"] == "research-bot"
    assert body["label"] == "step_1"
    assert body["metadata"] == {"source": "test"}
    client.close()


def test_save_with_ttl_and_if_match():
    client, transport = make_client([(201, SAVE_RESPONSE)])

    client.save(
        workflow_id="wf_001",
        step=1,
        state={},
        ttl_seconds=3600,
        if_match="etag_abc",
    )

    req = transport.requests[0]
    assert req.headers.get("x-checkpoint-ttl") == "3600"
    assert req.headers.get("if-match") == "etag_abc"
    client.close()


# ---------------------------------------------------------------------------
# Tests: get checkpoint
# ---------------------------------------------------------------------------

def test_get_checkpoint():
    client, _ = make_client([(200, CHECKPOINT_RESPONSE)])

    cp = client.get("cp_wf_001_0001")

    assert isinstance(cp, Checkpoint)
    assert cp.checkpoint_id == "cp_wf_001_0001"
    assert cp.step == 1
    assert cp.label == "init"
    assert cp.state == {"progress": 0}
    # agent_id should be extracted from metadata
    assert cp.agent_id == "my-bot"
    client.close()


# ---------------------------------------------------------------------------
# Tests: resume workflow
# ---------------------------------------------------------------------------

def test_resume_workflow():
    client, _ = make_client([(200, RESUME_RESPONSE)])

    resumed = client.resume("wf_001")

    assert isinstance(resumed, WorkflowResume)
    assert resumed.workflow_id == "wf_001"
    assert resumed.total_checkpoints == 1
    assert isinstance(resumed.latest_checkpoint, Checkpoint)
    assert resumed.latest_checkpoint.step == 1
    assert resumed.latest_checkpoint.etag == "abc123"
    client.close()


def test_resume_not_found():
    client, _ = make_client([(404, {"error": {"code": "NOT_FOUND", "message": "Workflow not found"}})])

    with pytest.raises(NotFoundError) as exc_info:
        client.resume("wf_missing")

    assert exc_info.value.status_code == 404
    assert "not found" in str(exc_info.value).lower()
    client.close()


# ---------------------------------------------------------------------------
# Tests: replay workflow
# ---------------------------------------------------------------------------

def test_replay_workflow():
    client, _ = make_client([(200, REPLAY_RESPONSE)])

    replay = client.replay("wf_001")

    assert isinstance(replay, WorkflowReplay)
    assert replay.workflow_id == "wf_001"
    assert replay.total == 1
    assert replay.has_more is False
    assert len(replay.checkpoints) == 1
    assert isinstance(replay.checkpoints[0], Checkpoint)
    client.close()


def test_replay_with_params():
    client, transport = make_client([(200, REPLAY_RESPONSE)])

    client.replay("wf_001", from_step=2, to_step=5, limit=10)

    req = transport.requests[0]
    assert "from_step=2" in str(req.url)
    assert "to_step=5" in str(req.url)
    assert "limit=10" in str(req.url)
    client.close()


# ---------------------------------------------------------------------------
# Tests: agents
# ---------------------------------------------------------------------------

def test_register_agent():
    client, transport = make_client([(201, AGENT_RESPONSE)])

    agent = client.register_agent(
        agent_id="research-bot",
        name="Research Bot",
        capabilities=["search"],
        metadata={"model": "test"},
    )

    assert isinstance(agent, Agent)
    assert agent.agent_id == "research-bot"
    assert agent.name == "Research Bot"
    assert agent.capabilities == ["search"]

    req = transport.requests[0]
    body = json.loads(req.content)
    assert body["agent_id"] == "research-bot"
    assert body["capabilities"] == ["search"]
    client.close()


def test_list_agents():
    client, _ = make_client([(200, {"agents": [AGENT_RESPONSE]})])

    agents = client.list_agents()

    assert len(agents) == 1
    assert isinstance(agents[0], Agent)
    assert agents[0].agent_id == "research-bot"
    client.close()


# ---------------------------------------------------------------------------
# Tests: error handling
# ---------------------------------------------------------------------------

def test_auth_error():
    client, _ = make_client([(401, {"error": {"code": "UNAUTHORIZED", "message": "Invalid API key"}})])

    with pytest.raises(AuthError) as exc_info:
        client.resume("wf_001")

    assert exc_info.value.status_code == 401
    assert exc_info.value.code == "UNAUTHORIZED"
    client.close()


def test_conflict_error():
    client, _ = make_client([(409, {"error": {"code": "CONFLICT", "message": "ETag mismatch"}})])

    with pytest.raises(ConflictError) as exc_info:
        client.save(workflow_id="wf_001", step=1, state={}, if_match="stale-etag")

    assert exc_info.value.status_code == 409
    client.close()


def test_validation_error():
    client, _ = make_client([(400, {"error": {"code": "VALIDATION_ERROR", "message": "agent_id is required"}})])

    with pytest.raises(ValidationError) as exc_info:
        client.save(workflow_id="wf_001", step=1, state={})

    assert exc_info.value.status_code == 400
    client.close()


# ---------------------------------------------------------------------------
# Tests: rate limit retry
# ---------------------------------------------------------------------------

def test_rate_limit_retry(monkeypatch):
    """429 on first attempt, 201 on second — should succeed."""
    monkeypatch.setattr("time.sleep", lambda _: None)

    client, transport = make_client(
        [
            (429, {"error": {"code": "RATE_LIMITED", "message": "Too many requests"}}),
            (201, SAVE_RESPONSE),
        ],
        max_retries=3,
    )

    result = client.save(workflow_id="wf_001", step=1, state={})

    assert isinstance(result, SaveResult)
    assert len(transport.requests) == 2  # one 429, one success
    client.close()


def test_rate_limit_exhausted(monkeypatch):
    """429 on all attempts — should raise RateLimitError."""
    monkeypatch.setattr("time.sleep", lambda _: None)

    client, _ = make_client(
        [(429, {"error": {"code": "RATE_LIMITED", "message": "Too many requests"}})] * 3,
        max_retries=3,
    )

    with pytest.raises(RateLimitError) as exc_info:
        client.save(workflow_id="wf_001", step=1, state={})

    assert exc_info.value.status_code == 429
    client.close()


# ---------------------------------------------------------------------------
# Tests: context manager
# ---------------------------------------------------------------------------

def test_context_manager():
    """Sync 'with' statement should close the client cleanly."""
    with make_client([(201, SAVE_RESPONSE)])[0] as client:
        result = client.save(workflow_id="wf_001", step=1, state={})
        assert isinstance(result, SaveResult)
    # After __exit__, the sync client should be closed (no exception raised)


# ---------------------------------------------------------------------------
# Tests: async methods
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_async_save():
    client, transport = make_async_client([(201, SAVE_RESPONSE)])

    result = await client.async_save(
        workflow_id="wf_001",
        step=1,
        state={"x": 1},
        agent_id="async-bot",
    )

    assert isinstance(result, SaveResult)
    assert result.checkpoint_id == "cp_wf_001_0001"
    req = transport.requests[0]
    body = json.loads(req.content)
    assert body["agent_id"] == "async-bot"
    await client.async_close()


@pytest.mark.asyncio
async def test_async_resume():
    client, _ = make_async_client([(200, RESUME_RESPONSE)])

    resumed = await client.async_resume("wf_001")

    assert isinstance(resumed, WorkflowResume)
    assert resumed.total_checkpoints == 1
    assert isinstance(resumed.latest_checkpoint, Checkpoint)
    await client.async_close()


@pytest.mark.asyncio
async def test_async_context_manager():
    """Async 'async with' statement should close the client cleanly."""
    async with make_async_client([(201, SAVE_RESPONSE)])[0] as client:
        result = await client.async_save(workflow_id="wf_001", step=1, state={})
        assert isinstance(result, SaveResult)


# ---------------------------------------------------------------------------
# Tests: close
# ---------------------------------------------------------------------------

def test_close():
    """close() should not raise even if called multiple times."""
    client, _ = make_client([(200, CHECKPOINT_RESPONSE)])
    client.close()
    client.close()  # second call should be safe


@pytest.mark.asyncio
async def test_async_close():
    """async_close() should not raise even if async client was never used."""
    client, _ = make_async_client([])
    await client.async_close()  # client never used — should be a no-op
    await client.async_close()  # second call also safe
