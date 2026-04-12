CREATE TABLE archived_workflows (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id),
    workflow_id VARCHAR(255) NOT NULL,
    r2_key VARCHAR(512) NOT NULL,
    total_checkpoints INTEGER NOT NULL,
    total_size_bytes BIGINT NOT NULL,
    first_checkpoint_at TIMESTAMPTZ NOT NULL,
    last_checkpoint_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workflow_id)
);

CREATE INDEX idx_archived_account ON archived_workflows(account_id);
