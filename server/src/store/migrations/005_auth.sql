ALTER TABLE accounts ADD COLUMN password_hash VARCHAR(255);
ALTER TABLE accounts ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN verification_token VARCHAR(255);
ALTER TABLE accounts ADD COLUMN verification_expires_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN reset_token VARCHAR(255);
ALTER TABLE accounts ADD COLUMN reset_expires_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN last_login_at TIMESTAMPTZ;

CREATE TABLE sessions (
    id VARCHAR(255) PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_account ON sessions(account_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
