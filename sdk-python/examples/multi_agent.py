"""
multi_agent.py — Two agents collaborating via checkpoint identity tagging.

Research Bot gathers data and checkpoints it. Writer Bot resumes the workflow
and continues from where Research Bot left off. Both agents register themselves
at startup so their activity shows up in the Checkpoint Service dashboard.

Usage:
    SNAPSTATE_API_KEY=snp_... python examples/multi_agent.py
"""

import os
from snapstate_sdk import SnapStateClient
from snapstate_sdk.errors import NotFoundError

API_KEY = os.environ.get("SNAPSTATE_API_KEY", "snp_your_key_here")
API_URL = os.environ.get("SNAPSTATE_API_URL", "http://localhost:3000")
WORKFLOW_ID = "wf_collab_python_001"


def research_agent():
    """Agent 1: Gathers and structures research data."""
    client = SnapStateClient(api_key=API_KEY, base_url=API_URL)

    # Register agent identity
    client.register_agent(
        agent_id="research-bot",
        name="Research Bot",
        description="Discovers and structures information from multiple sources",
        capabilities=["web_search", "data_collection", "source_ranking"],
        metadata={"model": "claude-sonnet-4-6", "version": "1.0.0"},
    )
    print("Research Bot: registered with checkpoint service")

    # Do research work (simulated)
    result = client.save(
        workflow_id=WORKFLOW_ID,
        step=1,
        label="research_complete",
        agent_id="research-bot",
        state={
            "topic": "quantum computing",
            "sources": [
                "arxiv.org/abs/2301.00001",
                "nature.com/articles/s41586-023-0001",
                "science.org/doi/10.1126/science.abo5641",
            ],
            "key_findings": [
                "Error correction improved 40% in 2024 via surface code advances",
                "Commercial quantum advantage demonstrated in logistics optimization",
                "Fault-tolerant qubit threshold crossed by three independent groups",
            ],
            "confidence": 0.87,
            "next_agent": "writer-bot",
        },
        metadata={"sources_evaluated": 24, "duration_ms": 3200},
    )
    print(f"Research Bot: checkpoint saved at step {result.step} (etag: {result.etag})")
    client.close()


def writer_agent():
    """Agent 2: Produces written output from research data."""
    client = SnapStateClient(api_key=API_KEY, base_url=API_URL)

    # Register agent identity
    client.register_agent(
        agent_id="writer-bot",
        name="Writer Bot",
        description="Transforms structured research into polished written content",
        capabilities=["drafting", "editing", "formatting", "citation"],
        metadata={"model": "claude-sonnet-4-6", "version": "1.0.0"},
    )
    print("Writer Bot: registered with checkpoint service")

    # Resume from where Research Bot left off
    try:
        resumed = client.resume(WORKFLOW_ID)
    except NotFoundError:
        print("Writer Bot: no prior state found — run research_agent() first")
        client.close()
        return

    state = resumed.latest_checkpoint.state
    prior_agent = state.get("next_agent", "unknown")
    print(f"Writer Bot: resuming from step {resumed.latest_checkpoint.step} (handoff from {prior_agent!r})")
    print(f"  Found {len(state['key_findings'])} findings on topic: {state['topic']!r}")

    # Generate draft from research data
    findings_text = "; ".join(state["key_findings"])
    draft = (
        f"Quantum computing is undergoing a transformative period. "
        f"Drawing on {len(state['sources'])} authoritative sources, this report highlights: "
        f"{findings_text}. "
        f"These developments signal a near-term inflection point for enterprise adoption."
    )

    result = client.save(
        workflow_id=WORKFLOW_ID,
        step=2,
        label="draft_complete",
        agent_id="writer-bot",
        state={
            **state,
            "draft": draft,
            "word_count": len(draft.split()),
            "status": "ready_for_review",
        },
        metadata={"tokens_generated": 512, "duration_ms": 1800},
    )
    print(f"Writer Bot: draft saved at step {result.step} ({result.size_bytes} bytes)")
    client.close()


def show_history():
    """Display the complete workflow audit trail."""
    client = SnapStateClient(api_key=API_KEY, base_url=API_URL)
    history = client.replay(WORKFLOW_ID)

    print(f"\nWorkflow {WORKFLOW_ID} — {history.total} steps:")
    for cp in history.checkpoints:
        agent_tag = (cp.metadata or {}).get("agent_id", "unknown")
        print(f"  Step {cp.step}: [{cp.label}] by agent={agent_tag!r}")

    client.close()


if __name__ == "__main__":
    research_agent()
    writer_agent()
    show_history()
