import type { Env, Challenge } from "./types";
import {
  deletePreparedQuiz,
  getChallenge,
  getPreparedQuiz,
  randomToken,
  transitionChallengeStatus,
  upsertPreparedQuiz,
} from "./store";
import {
  getCodeHoneypotSignals,
  getMultipleChoiceGate,
  hasHoneypotSignal,
  resolveConfig,
  type VouchaConfig,
} from "./config";
import { validateQuiz, type Quiz, type Question } from "./quiz/schema";
import {
  canStartAttempt,
  scoreQuiz,
  nextCooldown,
  answerWithinTimeLimit,
  QUESTION_TIME_LIMIT_MS,
  QUESTION_GRACE_MS,
  type Answer,
} from "./quiz/grade";
import { checkAndRecordRate } from "./policy/ratelimit";
import { evaluateCodeHoneypotSignals } from "./policy/code-honeypot";
import {
  buildRiskReport,
  CONFIRMATION_REQUIRED_REASON,
  STRONG_TIMING_FAILURE_REASON,
  telemetrySchema,
  type Telemetry,
} from "./risk/report";
import type { GenerateResult } from "./quiz/generate";
import { normalizeGitHubLogin, sameGitHubLogin } from "./github/login";
import { createTurnstileCData } from "./turnstile";

export interface PrFilePatch {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
}

export interface PrContext {
  diff: string;
  title: string;
  body: string | null;
  files: string[];
  repoFullName?: string;
  prNumber?: number;
  headSha?: string;
  deltaBaseSha?: string;
  installationId?: number;
  changedLines?: number;
  filePatches?: PrFilePatch[];
}

export interface ResolvedChallenge {
  challenge: Challenge;
  outcome: "passed" | "pending_confirmation" | "failed_retry" | "failed_assisted" | "failed_final" | "neutral";
  score?: number;
  total?: number;
  telemetry: Telemetry | null;
  cfg: VouchaConfig;
  failureReason?: string;
  confirmation?: { method: "passkey" | "maintainer"; by: string };
}

// All side-effectful collaborators are injected for testability.
export interface ChallengeDeps {
  generateQuiz(ctx: PrContext, cfg: VouchaConfig): Promise<GenerateResult>;
  verifyTurnstile(
    token: string,
    binding: { expectedCData: string; remoteIp?: string }
  ): Promise<"passed" | "failed" | "unavailable">;
  fetchPrContext(challenge: Challenge): Promise<PrContext>;
  onChallengeResolved(resolved: ResolvedChallenge): Promise<void>;
  now(): Date;
}

export type StartResult =
  | { ok: true; quizId: string; resumed?: boolean }
  | { ok: false; error: "not_found" | "not_author" | "not_ready" | "cooldown" | "attempts_exhausted" | "attempt_preparing" | "rate_limited" | "generation_failed" | "turnstile_missing" | "turnstile_unavailable" }
  | { ok: false; error: "bot_detected"; reason: string };

export const TURNSTILE_BOT_FAILURE_REASON = "Turnstile did not validate this browser session.";
export const WEBDRIVER_BOT_FAILURE_REASON = "The browser identified itself as automated software.";
export const QUIZ_ABANDONMENT_SLACK_MS = 60_000;
export const QUIZ_PREPARATION_TIMEOUT_MS = 2 * 60_000;

// Data custody (spec): once a challenge reaches a terminal state, quiz
// question content is deleted. Score/answers/telemetry are kept for audit.
async function purgeQuizQuestions(env: Env, challengeId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE quizzes SET questions_json='{"questions":[]}' WHERE challenge_id=?`
  ).bind(challengeId).run();
}

async function notifyChallengeResolved(
  deps: ChallengeDeps,
  resolved: ResolvedChallenge
): Promise<void> {
  try {
    await deps.onChallengeResolved(resolved);
  } catch (err) {
    console.error("challenge resolution callback failed", resolved.challenge.id, err);
  }
}

async function failChallengeForBotSignal(
  env: Env,
  deps: ChallengeDeps,
  challenge: Challenge,
  cfg: VouchaConfig,
  reason: string,
  now: Date
): Promise<StartResult> {
  const quizId = randomToken();
  const gate = getMultipleChoiceGate(cfg);
  const telemetry = telemetrySchema.parse({ turnstileOk: false });
  const failed = await env.DB.prepare(
    `UPDATE challenges
     SET status='failed_assisted', attempts_used=attempts_used+1, cooldown_until=NULL
     WHERE id=? AND status='ready'`
  ).bind(challenge.id).run();
  if (failed.meta.changes === 0) return { ok: false, error: "bot_detected", reason };
  const fresh = (await getChallenge(env.DB, challenge.id))!;
  await env.DB.prepare(
    `UPDATE quizzes
     SET finished_at=?, state='finished', questions_json='{"questions":[]}'
     WHERE challenge_id=? AND finished_at IS NULL`
  ).bind(now.toISOString(), challenge.id).run();
  await env.DB.prepare(
    `INSERT INTO quizzes (id, challenge_id, attempt_number, retry_cycle, questions_json, question_served_at,
       time_limit_ms, turnstile_ok, telemetry_json, finished_at, score, state)
     VALUES (?, ?, ?, ?, '{"questions":[]}', NULL, ?, 0, ?, ?, 0, 'finished')`
  ).bind(
    quizId,
    challenge.id,
    fresh.attempts_used,
    challenge.retry_cycle,
    QUESTION_TIME_LIMIT_MS,
    JSON.stringify({ botFailureReason: reason }),
    now.toISOString()
  ).run();
  await notifyChallengeResolved(deps, {
    challenge: fresh,
    outcome: "failed_assisted",
    score: 0,
    total: gate.questions,
    telemetry,
    cfg,
    failureReason: reason,
  });
  return { ok: false, error: "bot_detected", reason };
}

async function takePreparedQuiz(env: Env, challengeId: string, questionCount: number): Promise<Quiz | null> {
  const prepared = await getPreparedQuiz(env.DB, challengeId);
  if (!prepared) return null;
  await deletePreparedQuiz(env.DB, challengeId);
  try {
    const parsed = validateQuiz(JSON.parse(prepared.questions_json), questionCount);
    if (parsed.ok) return parsed.quiz;
    console.error("prepared quiz validation failed", { challengeId, error: parsed.error });
    return null;
  } catch (err) {
    console.error("prepared quiz JSON invalid", { challengeId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function prepareQuizForChallenge(
  env: Env,
  deps: ChallengeDeps,
  challengeId: string
): Promise<void> {
  const challenge = await getChallenge(env.DB, challengeId);
  if (!challenge) return;
  const cfg = resolveConfig(challenge.config_json);
  const gate = canStartAttempt(challenge, cfg, deps.now());
  if (!gate.allowed) return;
  if (await getPreparedQuiz(env.DB, challenge.id)) return;

  const ctx = await deps.fetchPrContext(challenge);
  const generated = await deps.generateQuiz(ctx, cfg);
  if (!generated.ok) {
    console.error("prepared quiz generation failed", {
      challengeId: challenge.id,
      repo: challenge.repo_full_name,
      prNumber: challenge.pr_number,
      headSha: challenge.head_sha,
      error: generated.error,
    });
    return;
  }

  await upsertPreparedQuiz(env.DB, challenge.id, generated.quiz);
}

interface QuizRow {
  id: string;
  challenge_id: string;
  attempt_number: number;
  retry_cycle: number;
  questions_json: string;
  current_question: number;
  question_served_at: string | null;
  answers_json: string;
  telemetry_json: string;
  turnstile_ok: number | null;
  started_at: string;
  finished_at: string | null;
  time_limit_ms: number;
  state: "preparing" | "active" | "finalizing" | "finished";
}

async function getOpenQuiz(env: Env, challengeId: string): Promise<QuizRow | null> {
  return env.DB.prepare(
    `SELECT * FROM quizzes
     WHERE challenge_id=? AND finished_at IS NULL
     ORDER BY started_at DESC, rowid DESC LIMIT 1`
  ).bind(challengeId).first<QuizRow>();
}

function openQuizExpired(quiz: QuizRow, now: Date): boolean {
  const startedAt = new Date(quiz.started_at).getTime();
  if (!Number.isFinite(startedAt)) return true;
  let questionCount = 1;
  try {
    questionCount = Math.max(1, (JSON.parse(quiz.questions_json) as Quiz).questions.length);
  } catch { /* malformed server state expires conservatively */ }
  const totalBudget = questionCount * (quiz.time_limit_ms + QUESTION_GRACE_MS) + QUIZ_ABANDONMENT_SLACK_MS;
  return now.getTime() > startedAt + totalBudget;
}

async function finalizeAbandonedAttempt(
  env: Env,
  challenge: Challenge,
  quiz: QuizRow,
  cfg: VouchaConfig,
  now: Date
): Promise<ResolvedChallenge | null> {
  let questions: Question[] = [];
  let answers: Answer[] = [];
  try {
    questions = (JSON.parse(quiz.questions_json) as Quiz).questions;
    answers = JSON.parse(quiz.answers_json) as Answer[];
  } catch { /* score remains zero */ }
  const gate = getMultipleChoiceGate(cfg);
  const total = questions.length || gate.questions;
  const { score } = scoreQuiz(questions, answers, gate.pass_threshold);
  const closed = await env.DB.prepare(
    `UPDATE quizzes SET finished_at=?, score=?, state='finished'
     WHERE id=? AND finished_at IS NULL AND state='active'`
  ).bind(now.toISOString(), score, quiz.id).run();
  if (closed.meta.changes === 0) return null;

  const attemptsUsed = challenge.attempts_used;
  const outcome: ResolvedChallenge["outcome"] = attemptsUsed >= cfg.max_attempts
    ? "failed_final"
    : "failed_retry";
  const transitioned = outcome === "failed_final"
    ? await transitionChallengeStatus(env.DB, challenge.id, "ready", "failed_final")
    : (await env.DB.prepare(
      `UPDATE challenges SET cooldown_until=? WHERE id=? AND status='ready'`
    ).bind(nextCooldown(cfg, now, attemptsUsed), challenge.id).run()).meta.changes > 0;
  await env.DB.prepare(`UPDATE quizzes SET questions_json='{"questions":[]}' WHERE id=?`)
    .bind(quiz.id).run();
  if (!transitioned) return null;

  const stored = parseStoredTelemetry(quiz.telemetry_json);
  const telemetry = telemetryFromStored(stored, quiz.turnstile_ok === 1);
  const fresh = (await getChallenge(env.DB, challenge.id))!;
  return {
    challenge: fresh,
    outcome,
    score,
    total,
    telemetry,
    cfg,
  };
}

export async function expireAbandonedQuiz(
  env: Env,
  quizId: string,
  now: Date
): Promise<ResolvedChallenge | null> {
  const quiz = await env.DB.prepare("SELECT * FROM quizzes WHERE id=?")
    .bind(quizId).first<QuizRow>();
  if (!quiz || quiz.state !== "active" || quiz.finished_at || !openQuizExpired(quiz, now)) return null;
  const challenge = await getChallenge(env.DB, quiz.challenge_id);
  if (!challenge || challenge.status !== "ready") return null;
  const cfg = resolveConfig(challenge.config_json);
  return finalizeAbandonedAttempt(env, challenge, quiz, cfg, now);
}

export async function startQuizAttempt(
  env: Env, deps: ChallengeDeps, challengeId: string, ghLogin: string, turnstileToken: string,
  honeypotTriggered = false,
  remoteIp?: string
): Promise<StartResult> {
  let challenge = await getChallenge(env.DB, challengeId);
  if (!challenge) return { ok: false, error: "not_found" };
  if (!sameGitHubLogin(challenge.author_login, ghLogin)) return { ok: false, error: "not_author" };
  if (challenge.status !== "ready") return { ok: false, error: "not_ready" };

  let cfg = resolveConfig(challenge.config_json);
  const now = deps.now();
  const openQuiz = await getOpenQuiz(env, challenge.id);
  if (openQuiz) {
    if (openQuiz.state === "preparing" || openQuiz.state === "finalizing") {
      const preparationAge = now.getTime() - new Date(openQuiz.started_at).getTime();
      if (Number.isFinite(preparationAge) && preparationAge <= QUIZ_PREPARATION_TIMEOUT_MS) {
        return { ok: false, error: "attempt_preparing" };
      }
      const neutralized = await transitionChallengeStatus(env.DB, challenge.id, "ready", "neutral");
      await env.DB.prepare(
        "UPDATE quizzes SET finished_at=?, state='finished' WHERE id=? AND finished_at IS NULL"
      ).bind(now.toISOString(), openQuiz.id).run();
      await purgeQuizQuestions(env, challenge.id);
      if (neutralized) {
        const fresh = (await getChallenge(env.DB, challenge.id))!;
        await notifyChallengeResolved(deps, { challenge: fresh, outcome: "neutral", telemetry: null, cfg });
      }
      return { ok: false, error: "generation_failed" };
    }
    if (!openQuizExpired(openQuiz, now)) {
      return { ok: true, quizId: openQuiz.id, resumed: true };
    }
    const abandoned = await finalizeAbandonedAttempt(env, challenge, openQuiz, cfg, now);
    if (abandoned) await notifyChallengeResolved(deps, abandoned);
    challenge = await getChallenge(env.DB, challenge.id);
    if (!challenge) return { ok: false, error: "not_found" };
    cfg = resolveConfig(challenge.config_json);
  }

  const gate = canStartAttempt(challenge, cfg, now);
  if (!gate.allowed) {
    return { ok: false, error: gate.reason === "not_ready" ? "not_ready" : gate.reason };
  }

  const verifiedTurnstileToken = turnstileToken.trim();
  if (!verifiedTurnstileToken) return { ok: false, error: "turnstile_missing" };

  const rate = await checkAndRecordRate(env.DB, {
    user: `user:${normalizeGitHubLogin(ghLogin)}`,
    repo: `repo:${challenge.repo_full_name}`,
    installation: `inst:${challenge.installation_id}`,
  }, now);
  if (!rate.allowed) return { ok: false, error: "rate_limited" };

  const expectedCData = await createTurnstileCData(env.SESSION_SIGNING_KEY, challenge.id);
  const turnstileResult = await deps.verifyTurnstile(verifiedTurnstileToken, { expectedCData, remoteIp });
  if (turnstileResult === "unavailable") {
    console.error("Turnstile verification unavailable", {
      challengeId: challenge.id,
      repo: challenge.repo_full_name,
      prNumber: challenge.pr_number,
    });
    const concurrentAttempt = await getOpenQuiz(env, challenge.id);
    if (concurrentAttempt?.state === "active") {
      return { ok: true, quizId: concurrentAttempt.id, resumed: true };
    }
    if (concurrentAttempt) return { ok: false, error: "attempt_preparing" };
    const neutralized = await transitionChallengeStatus(env.DB, challenge.id, "ready", "neutral");
    if (!neutralized) return { ok: false, error: "not_ready" };
    await purgeQuizQuestions(env, challenge.id);
    const fresh = (await getChallenge(env.DB, challenge.id))!;
    await notifyChallengeResolved(deps, {
      challenge: fresh, outcome: "neutral", telemetry: null, cfg,
    });
    return { ok: false, error: "turnstile_unavailable" };
  }
  if (turnstileResult === "failed") {
    const concurrentAttempt = await getOpenQuiz(env, challenge.id);
    if (concurrentAttempt?.state === "active") {
      return { ok: true, quizId: concurrentAttempt.id, resumed: true };
    }
    if (concurrentAttempt) return { ok: false, error: "attempt_preparing" };
    return failChallengeForBotSignal(env, deps, challenge, cfg, TURNSTILE_BOT_FAILURE_REASON, now);
  }

  const quizId = randomToken();
  try {
    await env.DB.prepare(
      `INSERT INTO quizzes (id, challenge_id, attempt_number, retry_cycle, questions_json,
         question_served_at, time_limit_ms, turnstile_ok, telemetry_json, state)
       VALUES (?, ?, ?, ?, '{"questions":[]}', NULL, ?, 1, '{}', 'preparing')`
    ).bind(
      quizId,
      challenge.id,
      challenge.attempts_used + 1,
      challenge.retry_cycle,
      QUESTION_TIME_LIMIT_MS
    ).run();
  } catch {
    const existing = await getOpenQuiz(env, challenge.id);
    if (existing?.state === "active") return { ok: true, quizId: existing.id, resumed: true };
    if (existing?.state === "preparing" || existing?.state === "finalizing") {
      return { ok: false, error: "attempt_preparing" };
    }
    return { ok: false, error: "not_ready" };
  }

  const admitted = await env.DB.prepare(
    `UPDATE challenges SET attempts_used=attempts_used+1
     WHERE id=? AND status='ready' AND attempts_used=? AND attempts_used < ?
       AND (cooldown_until IS NULL OR cooldown_until <= ?)`
  ).bind(
    challenge.id,
    challenge.attempts_used,
    cfg.max_attempts,
    now.toISOString()
  ).run();
  if (admitted.meta.changes === 0) {
    await env.DB.prepare("DELETE FROM quizzes WHERE id=? AND state='preparing'").bind(quizId).run();
    const latest = await getChallenge(env.DB, challenge.id);
    if (!latest) return { ok: false, error: "not_found" };
    const latestGate = canStartAttempt(latest, cfg, now);
    return latestGate.allowed
      ? { ok: false, error: "not_ready" }
      : { ok: false, error: latestGate.reason === "not_ready" ? "not_ready" : latestGate.reason };
  }

  const codeHoneypotSignals = getCodeHoneypotSignals(cfg);
  const preparedQuiz = await takePreparedQuiz(env, challenge.id, getMultipleChoiceGate(cfg).questions);
  let codeHoneypot = { triggered: false };
  let generated: GenerateResult;
  if (preparedQuiz) {
    if (codeHoneypotSignals.length > 0) {
      const ctx = await deps.fetchPrContext(challenge);
      codeHoneypot = evaluateCodeHoneypotSignals(ctx.diff, codeHoneypotSignals);
    }
    generated = { ok: true, quiz: preparedQuiz };
  } else {
    const ctx = await deps.fetchPrContext(challenge);
    codeHoneypot = evaluateCodeHoneypotSignals(ctx.diff, codeHoneypotSignals);
    generated = await deps.generateQuiz(ctx, cfg);
  }
  if (!generated.ok) {
    console.error("quiz generation failed", {
      challengeId: challenge.id,
      repo: challenge.repo_full_name,
      prNumber: challenge.pr_number,
      headSha: challenge.head_sha,
      error: generated.error,
    });
    // Never block merges on our own failure: neutralize.
    const neutralized = await transitionChallengeStatus(env.DB, challenge.id, "ready", "neutral");
    await env.DB.prepare(
      "UPDATE quizzes SET finished_at=?, state='finished' WHERE id=? AND finished_at IS NULL"
    ).bind(deps.now().toISOString(), quizId).run();
    // Terminal state: drop any question content from earlier attempts.
    // DB state (status, score, purge) is finalized before the GitHub callback —
    // a callback failure leaves consistent state for the cron sweep to reconcile.
    await purgeQuizQuestions(env, challenge.id);
    if (!neutralized) return { ok: false, error: "not_ready" };
    await notifyChallengeResolved(deps, {
      challenge: (await getChallenge(env.DB, challenge.id)) ?? challenge,
      outcome: "neutral", telemetry: null, cfg,
    });
    return { ok: false, error: "generation_failed" };
  }

  const initialTelemetry: { honeypotTriggered?: boolean; codeHoneypotTriggered?: boolean } = {};
  if (hasHoneypotSignal(cfg) && honeypotTriggered) initialTelemetry.honeypotTriggered = true;
  if (codeHoneypot.triggered) initialTelemetry.codeHoneypotTriggered = true;
  const activated = await env.DB.prepare(
    `UPDATE quizzes SET questions_json=?, telemetry_json=?, state='active'
     WHERE id=? AND state='preparing' AND finished_at IS NULL
       AND EXISTS (
         SELECT 1 FROM challenges WHERE id=? AND status='ready'
       )`
  ).bind(
    JSON.stringify(generated.quiz),
    JSON.stringify(initialTelemetry),
    quizId,
    challenge.id
  ).run();
  if (activated.meta.changes === 0) {
    await env.DB.prepare(
      `UPDATE quizzes SET finished_at=?, state='finished', questions_json='{"questions":[]}'
       WHERE id=? AND finished_at IS NULL`
    ).bind(deps.now().toISOString(), quizId).run();
    return { ok: false, error: "not_ready" };
  }
  return { ok: true, quizId };
}

export type SubmitResult =
  | { done: false; nextQuestion: number }
  | { done: true; passed: boolean; score: number; total: number; failureReason?: string }
  | { done: true; confirmationRequired: true; score: number; total: number }
  | { done: true; error: "not_found" | "already_finished" | "challenge_closed" };

interface PerQuestionTelemetry {
  elapsedMs: number; answerChanges: number; pointerDistancePx: number;
  pointerSamples: number; focusLossCount: number; webdriver: boolean;
}

interface StoredTelemetry {
  perQuestion: PerQuestionTelemetry[];
  honeypotTriggered: boolean;
  codeHoneypotTriggered: boolean;
  botFailureReason?: string;
}

function finiteNonNegative(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parsePerQuestionTelemetry(
  json: string,
  serverElapsedMs: number | null
): PerQuestionTelemetry | null {
  if (serverElapsedMs === null) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return {
      // Timing used for risk decisions is measured by the server-authoritative
      // served timestamp, never by the browser-provided elapsed value.
      elapsedMs: serverElapsedMs,
      answerChanges: Math.floor(finiteNonNegative(parsed.answerChanges)),
      pointerDistancePx: finiteNonNegative(parsed.pointerDistancePx),
      pointerSamples: Math.floor(finiteNonNegative(parsed.pointerSamples)),
      focusLossCount: Math.floor(finiteNonNegative(parsed.focusLossCount)),
      webdriver: parsed.webdriver === true,
    };
  } catch {
    return null;
  }
}

function parseStoredTelemetry(json: string): StoredTelemetry {
  try {
    const parsed = JSON.parse(json || "{}") as {
      perQuestion?: unknown;
      honeypotTriggered?: unknown;
      codeHoneypotTriggered?: unknown;
      botFailureReason?: unknown;
    };
    return {
      perQuestion: Array.isArray(parsed.perQuestion)
        ? parsed.perQuestion as PerQuestionTelemetry[]
        : [],
      honeypotTriggered: parsed.honeypotTriggered === true,
      codeHoneypotTriggered: parsed.codeHoneypotTriggered === true,
      botFailureReason: typeof parsed.botFailureReason === "string" ? parsed.botFailureReason : undefined,
    };
  } catch {
    return { perQuestion: [], honeypotTriggered: false, codeHoneypotTriggered: false };
  }
}

function telemetryFromStored(stored: StoredTelemetry, turnstileOk: boolean): Telemetry | null {
  if (
    stored.perQuestion.length === 0 &&
    !stored.honeypotTriggered &&
    !stored.codeHoneypotTriggered
  ) return null;
  return telemetrySchema.parse({
    perQuestionMs: stored.perQuestion.map((t) => t.elapsedMs),
    answerChanges: stored.perQuestion.reduce((a, t) => a + t.answerChanges, 0),
    pointerDistancePx: stored.perQuestion.reduce((a, t) => a + t.pointerDistancePx, 0),
    pointerSamples: stored.perQuestion.reduce((a, t) => a + t.pointerSamples, 0),
    focusLossCount: stored.perQuestion.reduce((a, t) => a + t.focusLossCount, 0),
    webdriver: stored.perQuestion.some((t) => t.webdriver),
    turnstileOk,
    honeypotTriggered: stored.honeypotTriggered,
    codeHoneypotTriggered: stored.codeHoneypotTriggered,
  });
}

function botFailureReasonForQuiz(quiz: QuizRow, perQuestion: PerQuestionTelemetry[]): string | undefined {
  if (quiz.turnstile_ok === 0) return TURNSTILE_BOT_FAILURE_REASON;
  if (perQuestion.some((t) => t.webdriver)) return WEBDRIVER_BOT_FAILURE_REASON;
  return undefined;
}

export async function submitAnswer(
  env: Env, deps: ChallengeDeps, quizId: string, questionIndex: number,
  answer: number[], telemetryJson: string, honeypotTriggered = false
): Promise<SubmitResult> {
  // Defense in depth: option indices outside the rendered range are discarded.
  answer = answer.filter((n) => Number.isInteger(n) && n >= 0 && n <= 3);

  const quiz = await env.DB.prepare(
    `SELECT q.*, ch.config_json
     FROM quizzes q JOIN challenges ch ON ch.id = q.challenge_id
     WHERE q.id=?`
  ).bind(quizId).first<QuizRow & { config_json: string }>();
  if (!quiz) return { done: true, error: "not_found" };
  if (quiz.finished_at || quiz.state !== "active") return { done: true, error: "already_finished" };

  // A stale/duplicate POST (back button, double submit) re-renders the current
  // question instead of consuming the next one.
  if (questionIndex !== quiz.current_question) {
    return { done: false, nextQuestion: quiz.current_question };
  }

  const questions = (JSON.parse(quiz.questions_json) as Quiz).questions;
  const answers = JSON.parse(quiz.answers_json) as Answer[];
  const now = deps.now();
  const servedAtMs = quiz.question_served_at === null
    ? Number.NaN
    : new Date(quiz.question_served_at).getTime();
  const serverElapsedMs = Number.isFinite(servedAtMs)
    ? Math.max(0, now.getTime() - servedAtMs)
    : null;

  const withinTime = quiz.question_served_at !== null &&
    answerWithinTimeLimit(quiz.question_served_at, now, quiz.time_limit_ms);
  answers.push(withinTime ? answer : null);

  // accumulate per-question telemetry (best-effort; malformed input → skipped)
  const cfg = resolveConfig(quiz.config_json);
  const stored = parseStoredTelemetry(quiz.telemetry_json);
  const perQuestion = stored.perQuestion;
  const sawHoneypot = stored.honeypotTriggered || (hasHoneypotSignal(cfg) && honeypotTriggered);
  const sawCodeHoneypot = stored.codeHoneypotTriggered;
  const questionTelemetry = parsePerQuestionTelemetry(telemetryJson, serverElapsedMs);
  if (questionTelemetry) perQuestion.push(questionTelemetry);

  const nextIndex = quiz.current_question + 1;
  const isLast = nextIndex >= questions.length;

  // Guarded write: if a concurrent duplicate already advanced or finished this
  // quiz, we lose the race and must not double-record or double-finalize.
  // The next question's window starts when it is first rendered (the route
  // stamps it via COALESCE).
  const updated = await env.DB.prepare(
    `UPDATE quizzes SET answers_json=?, telemetry_json=?, current_question=?,
       question_served_at=?, state=?
     WHERE id=? AND current_question=? AND finished_at IS NULL AND state='active'`
  ).bind(
    JSON.stringify(answers),
    JSON.stringify({
      perQuestion,
      honeypotTriggered: sawHoneypot,
      codeHoneypotTriggered: sawCodeHoneypot,
    }),
    nextIndex,
    null,
    isLast ? "finalizing" : "active",
    quizId,
    quiz.current_question
  ).run();
  if (updated.meta.changes === 0) return { done: true, error: "already_finished" };

  if (!isLast) return { done: false, nextQuestion: nextIndex };
  return finalizeQuiz(env, deps, quiz, questions, answers, perQuestion, sawHoneypot, sawCodeHoneypot, now);
}

async function finalizeQuiz(
  env: Env, deps: ChallengeDeps, quiz: QuizRow, questions: Question[],
  answers: Answer[], perQuestion: PerQuestionTelemetry[], honeypotTriggered: boolean,
  codeHoneypotTriggered: boolean, now: Date
): Promise<SubmitResult> {
  const challenge = (await getChallenge(env.DB, quiz.challenge_id))!;
  // Outcomes only apply to a live challenge. A quiz finishing after the
  // challenge left `ready` (failed_final, superseded, passed via another quiz,
  // neutral) must not override that state — pre-starting multiple quizzes
  // would otherwise bypass the attempt cap and cooldown entirely.
  if (challenge.status !== "ready") {
    await env.DB.prepare(
      `UPDATE quizzes SET finished_at=?, state='finished', questions_json='{"questions":[]}'
       WHERE id=? AND finished_at IS NULL`
    ).bind(now.toISOString(), quiz.id).run();
    return { done: true, error: "challenge_closed" };
  }
  const cfg = resolveConfig(challenge.config_json);
  const quizGate = getMultipleChoiceGate(cfg);
  const { score, passed: scorePassed } = scoreQuiz(questions, answers, quizGate.pass_threshold);
  const botFailureReason = botFailureReasonForQuiz(quiz, perQuestion);
  const stored: StoredTelemetry = {
    perQuestion,
    honeypotTriggered,
    codeHoneypotTriggered,
  };
  const telemetry = telemetryFromStored(stored, quiz.turnstile_ok === 1);
  const report = buildRiskReport(telemetry);
  const assistanceReason = botFailureReason ??
    (scorePassed && report.strongTimingEvidence ? STRONG_TIMING_FAILURE_REASON : undefined);
  const confirmationRequired = scorePassed && !assistanceReason && report.confirmationRecommended;
  const passed = scorePassed && !assistanceReason && !confirmationRequired;

  if (assistanceReason) {
    await env.DB.prepare("UPDATE quizzes SET score=?, telemetry_json=? WHERE id=?").bind(
      score,
      JSON.stringify({
        perQuestion,
        honeypotTriggered,
        codeHoneypotTriggered,
        botFailureReason: assistanceReason,
      }),
      quiz.id
    ).run();
  } else {
    await env.DB.prepare("UPDATE quizzes SET score=? WHERE id=?").bind(score, quiz.id).run();
  }

  let outcome: ResolvedChallenge["outcome"];
  let transitioned = false;
  if (passed) {
    outcome = "passed";
    transitioned = await transitionChallengeStatus(env.DB, challenge.id, "ready", "passed");
  } else if (confirmationRequired) {
    outcome = "pending_confirmation";
    await env.DB.prepare(
      `INSERT OR IGNORE INTO challenge_confirmations (challenge_id, quiz_id, reason)
       VALUES (?, ?, ?)`
    ).bind(challenge.id, quiz.id, CONFIRMATION_REQUIRED_REASON).run();
    transitioned = await transitionChallengeStatus(
      env.DB,
      challenge.id,
      "ready",
      "awaiting_confirmation"
    );
    if (!transitioned) {
      await env.DB.prepare(
        "DELETE FROM challenge_confirmations WHERE challenge_id=? AND quiz_id=?"
      ).bind(challenge.id, quiz.id).run();
    }
  } else if (assistanceReason) {
    outcome = "failed_assisted";
    const updated = await env.DB.prepare(
      `UPDATE challenges SET status='failed_assisted', cooldown_until=NULL
       WHERE id=? AND status='ready'`
    ).bind(challenge.id).run();
    transitioned = updated.meta.changes > 0;
  } else {
    const attemptsUsed = challenge.attempts_used;
    if (attemptsUsed >= cfg.max_attempts) {
      outcome = "failed_final";
      transitioned = await transitionChallengeStatus(env.DB, challenge.id, "ready", "failed_final");
    } else {
      outcome = "failed_retry";
      const updated = await env.DB.prepare(
        `UPDATE challenges SET cooldown_until=? WHERE id=? AND status='ready'`
      ).bind(nextCooldown(cfg, now, attemptsUsed), challenge.id).run();
      transitioned = updated.meta.changes > 0;
    }
  }

  if (!transitioned) {
    await env.DB.prepare(
      `UPDATE quizzes SET finished_at=?, state='finished', questions_json='{"questions":[]}'
       WHERE id=? AND finished_at IS NULL`
    ).bind(now.toISOString(), quiz.id).run();
    return { done: true, error: "challenge_closed" };
  }
  await env.DB.prepare(
    "UPDATE quizzes SET finished_at=?, state='finished' WHERE id=? AND finished_at IS NULL"
  ).bind(now.toISOString(), quiz.id).run();

  // A finished quiz never remains a source of answer keys. Retryable failures
  // still receive freshly generated questions on the next admitted attempt.
  // DB state (status, score, purge) is finalized before the GitHub callback —
  // a callback failure leaves consistent state for the cron sweep to reconcile.
  if (outcome !== "failed_retry") {
    await purgeQuizQuestions(env, challenge.id);
  } else {
    await env.DB.prepare(`UPDATE quizzes SET questions_json='{"questions":[]}' WHERE id=?`)
      .bind(quiz.id).run();
  }

  const fresh = (await getChallenge(env.DB, challenge.id))!;
  await notifyChallengeResolved(deps, {
    challenge: fresh, outcome, score, total: questions.length, telemetry, cfg,
    failureReason: assistanceReason ?? (confirmationRequired ? CONFIRMATION_REQUIRED_REASON : undefined),
  });
  if (confirmationRequired) {
    return { done: true, confirmationRequired: true, score, total: questions.length };
  }
  const result = { done: true as const, passed, score, total: questions.length };
  return assistanceReason ? { ...result, failureReason: assistanceReason } : result;
}

export async function confirmPendingChallenge(
  env: Env,
  deps: ChallengeDeps,
  challengeId: string,
  confirmation: { method: "passkey" | "maintainer"; by: string }
): Promise<boolean> {
  const pending = await env.DB.prepare(
    `SELECT cc.quiz_id, q.score, q.answers_json, q.telemetry_json, q.turnstile_ok
     FROM challenge_confirmations cc
     JOIN quizzes q ON q.id=cc.quiz_id
     WHERE cc.challenge_id=? AND cc.confirmed_at IS NULL`
  ).bind(challengeId).first<{
    quiz_id: string;
    score: number;
    answers_json: string;
    telemetry_json: string;
    turnstile_ok: number | null;
  }>();
  const challenge = await getChallenge(env.DB, challengeId);
  if (!pending || !challenge || challenge.status !== "awaiting_confirmation") return false;

  const transitioned = await transitionChallengeStatus(
    env.DB,
    challenge.id,
    "awaiting_confirmation",
    "passed"
  );
  if (!transitioned) return false;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE challenge_confirmations
       SET confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), confirmed_by=?, confirmation_method=?
       WHERE challenge_id=? AND quiz_id=? AND confirmed_at IS NULL`
    ).bind(confirmation.by, confirmation.method, challenge.id, pending.quiz_id),
    env.DB.prepare("DELETE FROM webauthn_challenges WHERE challenge_id=?").bind(challenge.id),
  ]);

  const cfg = resolveConfig(challenge.config_json);
  const stored = parseStoredTelemetry(pending.telemetry_json);
  const telemetry = telemetryFromStored(stored, pending.turnstile_ok === 1);
  let total = getMultipleChoiceGate(cfg).questions;
  try {
    const answers = JSON.parse(pending.answers_json) as Answer[];
    if (answers.length > 0) total = answers.length;
  } catch { /* use gate total */ }
  const fresh = (await getChallenge(env.DB, challenge.id))!;
  await notifyChallengeResolved(deps, {
    challenge: fresh,
    outcome: "passed",
    score: pending.score,
    total,
    telemetry,
    cfg,
    confirmation,
  });
  return true;
}
