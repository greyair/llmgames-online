CREATE TABLE email_login_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    browser_hash TEXT NOT NULL,
    return_to TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL
);
CREATE INDEX email_login_codes_expiry ON email_login_codes(expires_at);
