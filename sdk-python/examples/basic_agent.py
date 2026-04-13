"""
basic_agent.py — Simple save/resume example.

Demonstrates a multi-step workflow that can be interrupted and resumed.
Run this script twice to see resumption in action.

Usage:
    SNAPSTATE_API_KEY=snp_... python examples/basic_agent.py
"""

import os
from snapstate_sdk import SnapStateClient
from snapstate_sdk.errors import NotFoundError


def main():
    client = SnapStateClient(
        api_key=os.environ.get("SNAPSTATE_API_KEY", "snp_your_key_here"),
        base_url=os.environ.get("SNAPSTATE_API_URL", "https://snapstate.dev"),
    )

    workflow_id = "wf_python_basic_001"

    # ------------------------------------------------------------------
    # Try to resume from a previous run
    # ------------------------------------------------------------------
    try:
        resumed = client.resume(workflow_id)
        print(f"Resuming from step {resumed.latest_checkpoint.step}")
        start_step = resumed.latest_checkpoint.step + 1
        state = resumed.latest_checkpoint.state
    except NotFoundError:
        print("Starting fresh workflow")
        start_step = 1
        state = {"results": []}

    # ------------------------------------------------------------------
    # Simulate a multi-step workflow
    # ------------------------------------------------------------------
    topics = ["AI agents", "MCP protocol", "LLM tooling", "vector databases", "RAG pipelines"]

    for i, topic in enumerate(topics[start_step - 1:], start=start_step):
        print(f"Processing step {i}: {topic}...")

        # Simulate work (replace with real logic)
        state["results"].append({
            "step": i,
            "topic": topic,
            "summary": f"Research summary for '{topic}' — key findings and analysis.",
        })

        # Checkpoint after each meaningful step
        result = client.save(
            workflow_id=workflow_id,
            step=i,
            label=f"researched_{topic.replace(' ', '_').lower()}",
            state=state,
            metadata={"duration_ms": 120, "tokens_used": 340},
        )
        print(f"  Saved checkpoint {result.checkpoint_id} (etag: {result.etag})")

    # ------------------------------------------------------------------
    # Show full history
    # ------------------------------------------------------------------
    history = client.replay(workflow_id)
    print(f"\nWorkflow complete. {history.total} checkpoints:")
    for cp in history.checkpoints:
        print(f"  Step {cp.step:2d}: {cp.label} ({cp.size_bytes} bytes)")

    client.close()


if __name__ == "__main__":
    main()
