-- Migration 006: Agent registry

CREATE TABLE agents (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    agent_id VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    description TEXT,
    capabilities JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, agent_id)
);

CREATE INDEX idx_agents_account ON agents(account_id);
CREATE INDEX idx_agents_agent_id ON agents(agent_id);

ALTER TABLE usage_events ADD COLUMN agent_id VARCHAR(255);
