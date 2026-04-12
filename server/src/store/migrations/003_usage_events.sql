CREATE TABLE usage_events (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id),
    api_key_id INTEGER REFERENCES api_keys(id),
    event_type VARCHAR(50) NOT NULL,
    workflow_id VARCHAR(255),
    checkpoint_size_bytes INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_account_date ON usage_events(account_id, created_at);

CREATE TABLE usage_daily (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id),
    date DATE NOT NULL,
    checkpoint_writes INTEGER DEFAULT 0,
    checkpoint_reads INTEGER DEFAULT 0,
    resume_calls INTEGER DEFAULT 0,
    replay_calls INTEGER DEFAULT 0,
    storage_bytes_written BIGINT DEFAULT 0,
    webhook_deliveries INTEGER DEFAULT 0,
    UNIQUE(account_id, date)
);
