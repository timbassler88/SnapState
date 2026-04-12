"""
Dataclass response models for the SnapState SDK.

All fields map 1-to-1 with the JSON keys returned by the SnapState API
(snake_case). Optional fields default to None / empty collection.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Checkpoint:
    """A single saved checkpoint for a workflow step."""

    checkpoint_id: str
    workflow_id: str
    step: int
    label: Optional[str] = None
    state: dict = field(default_factory=dict)
    metadata: dict = field(default_factory=dict)
    etag: Optional[str] = None
    created_at: Optional[str] = None
    diff_from_previous: Optional[dict] = None
    size_bytes: Optional[int] = None
    # Convenience field — populated from metadata.agent_id when present
    agent_id: Optional[str] = None


@dataclass
class WorkflowResume:
    """Result of GET /workflows/{id}/resume — the latest checkpoint for a workflow."""

    workflow_id: str
    latest_checkpoint: Checkpoint
    total_checkpoints: int
    workflow_started_at: Optional[str] = None
    last_activity_at: Optional[str] = None


@dataclass
class WorkflowReplay:
    """Result of GET /workflows/{id}/replay — ordered checkpoint history."""

    workflow_id: str
    checkpoints: list  # List[Checkpoint]
    total: int
    has_more: bool = False


@dataclass
class Agent:
    """An agent registered with the SnapState service."""

    agent_id: str
    name: str
    description: Optional[str] = None
    capabilities: list = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    last_seen_at: Optional[str] = None
    created_at: Optional[str] = None


@dataclass
class SaveResult:
    """Result of POST /checkpoints — confirmation of a saved checkpoint."""

    checkpoint_id: str
    workflow_id: str
    step: int
    etag: str
    created_at: str
    diff_from_previous: dict
    size_bytes: int
