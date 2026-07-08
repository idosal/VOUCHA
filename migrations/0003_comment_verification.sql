ALTER TABLE sessions ADD COLUMN verify_code TEXT;

CREATE INDEX idx_sessions_verify_code ON sessions(challenge_id, verify_code);
