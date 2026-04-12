-- Migration 007: Analytics — workflow stats and error tracking

CREATE TABLE workflow_stats (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id),
    workflow_id VARCHAR(255) NOT NULL,
    total_steps INTEGER DEFAULT 0,
    total_size_bytes BIGINT DEFAULT 0,
    first_checkpoint_at TIMESTAMPTZ,
    last_checkpoint_at TIMESTAMPTZ,
    duration_seconds INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    agent_ids JSONB DEFAULT '[]',
    error_count INTEGER DEFAULT 0,
    resumed_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, workflow_id)
);

CREATE INDEX idx_workflow_stats_account ON workflow_stats(account_id);
CREATE INDEX idx_workflow_stats_status ON workflow_stats(status);
CREATE INDEX idx_workflow_stats_last_checkpoint ON workflow_stats(last_checkpoint_at);

CREATE TABLE workflow_errors (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id),
    workflow_id VARCHAR(255) NOT NULL,
    step INTEGER,
    error_type VARCHAR(100),
    error_message TEXT,
    agent_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workflow_errors_account ON workflow_errors(account_id);
CREATE INDEX idx_workflow_errors_created ON workflow_errors(created_at);
