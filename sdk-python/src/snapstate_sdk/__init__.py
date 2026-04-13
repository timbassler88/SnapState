"""
snapstate-sdk — Python SDK for the SnapState workflow state persistence service.

Quick start::

    from snapstate_sdk import SnapStateClient

    client = SnapStateClient(api_key="snp_...", base_url="https://snapstate.dev")

    result = client.save(workflow_id="wf_001", step=1, state={"progress": 0})
    resumed = client.resume("wf_001")
    client.close()
"""

from .client import SnapStateClient
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

__version__ = "1.0.0"

__all__ = [
    "SnapStateClient",
    # Deprecated aliases
    "CheckpointClient",
    # Types
    "Checkpoint",
    "WorkflowResume",
    "WorkflowReplay",
    "Agent",
    "SaveResult",
    # Errors
    "SnapStateError",
    "CheckpointError",
    "AuthError",
    "NotFoundError",
    "ConflictError",
    "RateLimitError",
    "ValidationError",
    "PayloadTooLargeError",
]

# Deprecated aliases
CheckpointClient = SnapStateClient
CheckpointError = SnapStateError
