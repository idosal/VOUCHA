-- Active attempts are durable server-side leases. Existing open quizzes were
-- admitted before attempts were consumed at start, so reconcile their counter
-- before enforcing one open quiz per challenge.
ALTER TABLE quizzes ADD COLUMN state TEXT NOT NULL DEFAULT 'active';

UPDATE quizzes SET state='finished' WHERE finished_at IS NOT NULL;

UPDATE challenges
SET attempts_used = MAX(
  attempts_used,
  COALESCE((
    SELECT MAX(q.attempt_number)
    FROM quizzes q
    WHERE q.challenge_id=challenges.id
      AND q.retry_cycle=challenges.retry_cycle
      AND q.finished_at IS NULL
  ), attempts_used)
)
WHERE EXISTS (
  SELECT 1 FROM quizzes q
  WHERE q.challenge_id=challenges.id AND q.finished_at IS NULL
);

-- Keep only the newest legacy open quiz before adding the invariant. Historical
-- rows remain available for audit; only their active lease is closed.
WITH ranked AS (
  SELECT rowid,
         ROW_NUMBER() OVER (
           PARTITION BY challenge_id
           ORDER BY started_at DESC, rowid DESC
         ) AS position
  FROM quizzes
  WHERE finished_at IS NULL
)
UPDATE quizzes
SET finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    state='finished',
    questions_json='{"questions":[]}'
WHERE rowid IN (SELECT rowid FROM ranked WHERE position > 1);

-- Closed challenges must not retain a takeable lease or answer-bearing quiz,
-- even if legacy state drift left one unfinished.
UPDATE quizzes
SET finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    state='finished',
    questions_json='{"questions":[]}'
WHERE finished_at IS NULL
  AND challenge_id IN (
    SELECT id FROM challenges WHERE status != 'ready'
  );

CREATE UNIQUE INDEX idx_quizzes_one_open_per_challenge
  ON quizzes(challenge_id)
  WHERE finished_at IS NULL;

-- GitHub's numeric user id is stable across login renames and is the WebAuthn
-- account key. Existing verified sessions can continue without passkeys.
ALTER TABLE sessions ADD COLUMN github_user_id INTEGER;

CREATE TABLE webauthn_credentials (
  id TEXT PRIMARY KEY,
  github_user_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT,
  UNIQUE (github_user_id, id)
);
CREATE INDEX idx_webauthn_credentials_user ON webauthn_credentials(github_user_id);

CREATE TABLE webauthn_challenges (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  ceremony TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (session_id, challenge_id, ceremony)
);

-- A correct quiz with multiple ambiguous automation signals pauses here. The
-- row snapshots the exact quiz being confirmed so a maintainer or passkey can
-- never approve a later or parallel result by accident.
CREATE TABLE challenge_confirmations (
  challenge_id TEXT PRIMARY KEY REFERENCES challenges(id) ON DELETE CASCADE,
  quiz_id TEXT NOT NULL UNIQUE REFERENCES quizzes(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confirmed_at TEXT,
  confirmed_by TEXT,
  confirmation_method TEXT
);
