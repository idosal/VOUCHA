import type {
  Challenge,
  ChallengeStatus,
  PendingConfirmation,
  PrInvestigation,
  PreparedQuiz,
  WebAuthnCredential,
} from "./types";
import type { Quiz } from "./quiz/schema";

export function randomToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getChallengeByPr(
  db: D1Database, repo: string, prNumber: number, headSha: string
): Promise<Challenge | null> {
  return db
    .prepare("SELECT * FROM challenges WHERE repo_full_name=? AND pr_number=? AND head_sha=?")
    .bind(repo, prNumber, headSha)
    .first<Challenge>();
}

export async function getChallenge(db: D1Database, id: string): Promise<Challenge | null> {
  return db.prepare("SELECT * FROM challenges WHERE id=?").bind(id).first<Challenge>();
}

export async function getLatestChallengeForPr(
  db: D1Database, repo: string, prNumber: number
): Promise<Challenge | null> {
  return db
    .prepare(
      "SELECT * FROM challenges WHERE repo_full_name=? AND pr_number=? ORDER BY created_at DESC, rowid DESC LIMIT 1"
    )
    .bind(repo, prNumber)
    .first<Challenge>();
}

export async function getLatestPassedChallenge(
  db: D1Database, repo: string, prNumber: number
): Promise<Challenge | null> {
  return db
    .prepare(
      `SELECT * FROM challenges
       WHERE repo_full_name=? AND pr_number=? AND status='passed'
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .bind(repo, prNumber)
    .first<Challenge>();
}

export async function insertChallenge(
  db: D1Database,
  c: Omit<
    Challenge,
    "auto_closed_at" | "created_at" | "delta_base_sha" | "retry_cycle" | "terminal_reconciled_at"
  > & { delta_base_sha?: string | null }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO challenges
       (id, installation_id, repo_full_name, pr_number, head_sha, delta_base_sha, author_login,
        check_run_id, status, approved_by, attempts_used, cooldown_until, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      c.id, c.installation_id, c.repo_full_name, c.pr_number, c.head_sha, c.delta_base_sha ?? null, c.author_login,
      c.check_run_id, c.status, c.approved_by, c.attempts_used, c.cooldown_until, c.config_json
    )
    .run();
}

export async function restartChallengeForRetry(
  db: D1Database,
  id: string,
  checkRunId: number,
  approvedBy: string
): Promise<Challenge | null> {
  const updated = await db.prepare(
    `UPDATE challenges
     SET status='ready', attempts_used=0, retry_cycle=retry_cycle+1,
         cooldown_until=NULL, approved_by=?, check_run_id=?,
         auto_closed_at=NULL, terminal_reconciled_at=NULL
     WHERE id=? AND status IN ('awaiting_confirmation','failed_assisted','failed_final','neutral')`
  ).bind(approvedBy, checkRunId, id).run();
  if (updated.meta.changes === 0) return null;
  await db.batch([
    db.prepare("DELETE FROM prepared_quizzes WHERE challenge_id=?").bind(id),
    db.prepare("DELETE FROM webauthn_challenges WHERE challenge_id=?").bind(id),
    db.prepare("DELETE FROM challenge_confirmations WHERE challenge_id=?").bind(id),
  ]);
  return getChallenge(db, id);
}

export async function markChallengeAutoClosed(db: D1Database, id: string): Promise<void> {
  await db.prepare(
    `UPDATE challenges
     SET auto_closed_at=COALESCE(auto_closed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     WHERE id=?`
  ).bind(id).run();
}

export async function markChallengeTerminalReconciled(db: D1Database, id: string): Promise<void> {
  await db.prepare(
    `UPDATE challenges
     SET terminal_reconciled_at=COALESCE(terminal_reconciled_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     WHERE id=?`
  ).bind(id).run();
}

export async function updateChallengeCheckRun(
  db: D1Database, repo: string, prNumber: number, headSha: string, checkRunId: number
): Promise<void> {
  await db.prepare(
    "UPDATE challenges SET check_run_id=? WHERE repo_full_name=? AND pr_number=? AND head_sha=?"
  ).bind(checkRunId, repo, prNumber, headSha).run();
}

export async function transitionChallengeStatus(
  db: D1Database,
  id: string,
  from: ChallengeStatus,
  to: ChallengeStatus
): Promise<boolean> {
  const updated = await db.prepare("UPDATE challenges SET status=? WHERE id=? AND status=?")
    .bind(to, id, from).run();
  return updated.meta.changes > 0;
}

export async function supersedeOldChallenges(
  db: D1Database, repo: string, prNumber: number, keepHeadSha: string
): Promise<void> {
  await db.prepare(
      `UPDATE challenges SET status='superseded'
       WHERE repo_full_name=? AND pr_number=? AND head_sha != ?
         AND status IN ('awaiting_approval','awaiting_confirmation','ready')`
    ).bind(repo, prNumber, keepHeadSha).run();
  const oldChallenges = `SELECT id FROM challenges
    WHERE repo_full_name=? AND pr_number=? AND head_sha != ? AND status='superseded'`;
  await db.batch([
    db.prepare(
      `UPDATE quizzes SET finished_at=COALESCE(finished_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
         state='finished', questions_json='{"questions":[]}'
       WHERE challenge_id IN (${oldChallenges})`
    ).bind(repo, prNumber, keepHeadSha),
    db.prepare(
      `DELETE FROM prepared_quizzes WHERE challenge_id IN (${oldChallenges})`
    ).bind(repo, prNumber, keepHeadSha),
    db.prepare(
      `DELETE FROM webauthn_challenges WHERE challenge_id IN (${oldChallenges})`
    ).bind(repo, prNumber, keepHeadSha),
    db.prepare(
      `DELETE FROM challenge_confirmations WHERE challenge_id IN (${oldChallenges})`
    ).bind(repo, prNumber, keepHeadSha),
  ]);
}

export async function getInvestigationByPr(
  db: D1Database, repo: string, prNumber: number, headSha: string
): Promise<PrInvestigation | null> {
  return db
    .prepare(
      `SELECT * FROM pr_investigations
       WHERE repo_full_name=? AND pr_number=? AND head_sha=?
       LIMIT 1`
    )
    .bind(repo, prNumber, headSha)
    .first<PrInvestigation>();
}

export async function upsertInvestigation(
  db: D1Database,
  investigation: Omit<PrInvestigation, "created_at" | "updated_at">
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO pr_investigations
       (id, repo_full_name, pr_number, head_sha, source, status, artifact_json, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo_full_name, pr_number, head_sha) DO UPDATE SET
         source=excluded.source,
         status=excluded.status,
         artifact_json=excluded.artifact_json,
         error=excluded.error,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    )
    .bind(
      investigation.id,
      investigation.repo_full_name,
      investigation.pr_number,
      investigation.head_sha,
      investigation.source,
      investigation.status,
      investigation.artifact_json,
      investigation.error
    )
    .run();
}

export async function getPreparedQuiz(
  db: D1Database,
  challengeId: string
): Promise<PreparedQuiz | null> {
  return db.prepare(
    "SELECT challenge_id, questions_json, created_at, updated_at FROM prepared_quizzes WHERE challenge_id=?"
  ).bind(challengeId).first<PreparedQuiz>();
}

export async function upsertPreparedQuiz(
  db: D1Database,
  challengeId: string,
  quiz: Quiz
): Promise<void> {
  await db.prepare(
    `INSERT INTO prepared_quizzes (challenge_id, questions_json)
     VALUES (?, ?)
     ON CONFLICT(challenge_id) DO UPDATE SET
       questions_json=excluded.questions_json,
       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).bind(challengeId, JSON.stringify(quiz)).run();
}

export async function deletePreparedQuiz(db: D1Database, challengeId: string): Promise<void> {
  await db.prepare("DELETE FROM prepared_quizzes WHERE challenge_id=?")
    .bind(challengeId)
    .run();
}

export interface ChallengeSession {
  id: string;
  challenge_id: string;
  gh_login: string | null;
  github_user_id: number | null;
  verify_code: string | null;
  created_at: string;
}

export async function getSession(db: D1Database, id: string): Promise<ChallengeSession | null> {
  return db.prepare(
    "SELECT id, challenge_id, gh_login, github_user_id, verify_code, created_at FROM sessions WHERE id=?"
  ).bind(id).first<ChallengeSession>();
}

export async function insertVerificationSession(
  db: D1Database,
  id: string,
  challengeId: string,
  verifyCode: string
): Promise<void> {
  await db.prepare(
    "INSERT INTO sessions (id, challenge_id, verify_code) VALUES (?, ?, ?)"
  ).bind(id, challengeId, verifyCode).run();
}

export async function setSessionVerifyCode(
  db: D1Database,
  id: string,
  verifyCode: string
): Promise<void> {
  await db.prepare("UPDATE sessions SET verify_code=? WHERE id=?")
    .bind(verifyCode, id).run();
}

export async function verifySessionFromComment(
  db: D1Database,
  challengeId: string,
  verifyCode: string,
  login: string,
  githubUserId?: number | null
): Promise<boolean> {
  const session = await db.prepare(
    "SELECT id FROM sessions WHERE challenge_id=? AND verify_code=? AND gh_login IS NULL LIMIT 1"
  ).bind(challengeId, verifyCode).first<{ id: string }>();
  if (!session) return false;
  const stableUserId = typeof githubUserId === "number" && Number.isSafeInteger(githubUserId) && githubUserId > 0
    ? githubUserId
    : null;
  const updated = await db.prepare(
    "UPDATE sessions SET gh_login=?, github_user_id=?, verify_code=NULL WHERE id=? AND gh_login IS NULL"
  ).bind(login, stableUserId, session.id).run();
  return updated.meta.changes > 0;
}

export async function getWebAuthnCredentials(
  db: D1Database,
  githubUserId: number
): Promise<WebAuthnCredential[]> {
  const { results } = await db.prepare(
    `SELECT id, github_user_id, public_key, counter, transports_json, created_at, last_used_at
     FROM webauthn_credentials WHERE github_user_id=? ORDER BY created_at ASC`
  ).bind(githubUserId).all<WebAuthnCredential>();
  return results;
}

export async function getWebAuthnCredential(
  db: D1Database,
  githubUserId: number,
  credentialId: string
): Promise<WebAuthnCredential | null> {
  return db.prepare(
    `SELECT id, github_user_id, public_key, counter, transports_json, created_at, last_used_at
     FROM webauthn_credentials WHERE github_user_id=? AND id=?`
  ).bind(githubUserId, credentialId).first<WebAuthnCredential>();
}

export async function saveWebAuthnCredential(
  db: D1Database,
  credential: Pick<WebAuthnCredential, "id" | "github_user_id" | "public_key" | "counter" | "transports_json">
): Promise<void> {
  await db.prepare(
    `INSERT INTO webauthn_credentials (id, github_user_id, public_key, counter, transports_json)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    credential.id,
    credential.github_user_id,
    credential.public_key,
    credential.counter,
    credential.transports_json
  ).run();
}

export async function updateWebAuthnCounter(
  db: D1Database,
  githubUserId: number,
  credentialId: string,
  counter: number
): Promise<void> {
  await db.prepare(
    `UPDATE webauthn_credentials
     SET counter=?, last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE github_user_id=? AND id=?`
  ).bind(counter, githubUserId, credentialId).run();
}

export type WebAuthnCeremony = "registration" | "authentication";

export interface StoredWebAuthnChallenge {
  session_id: string;
  challenge_id: string;
  ceremony: WebAuthnCeremony;
  challenge: string;
  expires_at: string;
}

export async function putWebAuthnChallenge(
  db: D1Database,
  value: StoredWebAuthnChallenge
): Promise<void> {
  await db.prepare(
    `INSERT INTO webauthn_challenges (session_id, challenge_id, ceremony, challenge, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id, challenge_id, ceremony) DO UPDATE SET
       challenge=excluded.challenge,
       expires_at=excluded.expires_at,
       created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).bind(value.session_id, value.challenge_id, value.ceremony, value.challenge, value.expires_at).run();
}

export async function getWebAuthnChallenge(
  db: D1Database,
  sessionId: string,
  challengeId: string,
  ceremony: WebAuthnCeremony
): Promise<StoredWebAuthnChallenge | null> {
  return db.prepare(
    `SELECT session_id, challenge_id, ceremony, challenge, expires_at
     FROM webauthn_challenges WHERE session_id=? AND challenge_id=? AND ceremony=?`
  ).bind(sessionId, challengeId, ceremony).first<StoredWebAuthnChallenge>();
}

export async function consumeWebAuthnChallenge(
  db: D1Database,
  value: StoredWebAuthnChallenge
): Promise<boolean> {
  const deleted = await db.prepare(
    `DELETE FROM webauthn_challenges
     WHERE session_id=? AND challenge_id=? AND ceremony=? AND challenge=?`
  ).bind(value.session_id, value.challenge_id, value.ceremony, value.challenge).run();
  return deleted.meta.changes > 0;
}

export async function getPendingConfirmation(
  db: D1Database,
  challengeId: string
): Promise<PendingConfirmation | null> {
  return db.prepare(
    `SELECT challenge_id, quiz_id, reason, created_at, confirmed_at, confirmed_by, confirmation_method
     FROM challenge_confirmations WHERE challenge_id=?`
  ).bind(challengeId).first<PendingConfirmation>();
}
