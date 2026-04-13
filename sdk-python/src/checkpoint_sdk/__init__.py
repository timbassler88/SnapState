"""
checkpoint-sdk — Python SDK for the Checkpoint workflow state persistence service.

Quick start::

    from checkpoint_sdk import CheckpointClient

    client = CheckpointClient(api_key="cpk_...", base_url="http://localhost:3000")

    result = client.save(workflow_id="wf_001", step=1, state={"progress": 0})
    resumed = client.resume("wf_001")
    client.close()
"""

from .client import CheckpointClient
from .errors import (
    AuthError,
    CheckpointError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    RateLimitError,
    ValidationError,
)
from .types import Agent, Checkpoint, SaveResult, WorkflowResume, WorkflowReplay

__version__ = "1.0.0"

__all__ = [
    "CheckpointClient",
    # Types
    "Checkpoint",
    "WorkflowResume",
    "WorkflowReplay",
    "Agent",
    "SaveResult",
    # Errors
    "CheckpointError",
    "AuthError",
    "NotFoundError",
    "ConflictError",
    "RateLimitError",
    "ValidationError",
    "PayloadTooLargeError",
]
