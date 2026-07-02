import type { Env, Challenge } from "./types";
import { getChallenge, setChallengeStatus, randomToken } from "./store";
import { resolveConfig, type ClawptchaConfig } from "./config";
import type { Quiz, Question } from "./quiz/schema";
import {
  canStartAttempt, scoreQuiz, nextCooldown, answerWithinTimeLimit, type Answer,
} from "./quiz/grade";
import { checkAndRecordRate } from "./policy/ratelimit";
import { telemetrySchema, type Telemetry } from "./risk/report";
import type { GenerateResult } from "./quiz/generate";

export interface PrContext { diff: string; title: string; body: string | null; files: string[] }

export interface ResolvedChallenge {
  challenge: Challenge;
  outcome: "passed" | "failed_retry" | "failed_final" | "neutral";
  score?: number;
  total?: number;
  telemetry: Telemetry | null;
  cfg: ClawptchaConfig;
}

// All side-effectful collaborators are injected for testability.
export interface ChallengeDeps {
  generateQuiz(ctx: PrContext, cfg: ClawptchaConfig): Promise<GenerateResult>;
  verifyTurnstile(token: string): Promise<boolean>;
  fetchPrContext(challenge: Challenge): Promise<PrContext>;
  onChallengeResolved(resolved: ResolvedChallenge): Promise<void>;
  now(): Date;
}

export type StartResult =
  | { ok: true; quizId: string }
  | { ok: false; error: "not_found" | "not_author" | "not_ready" | "cooldown" | "attempts_exhausted" | "rate_limited" | "generation_failed" };

// Data custody (spec): once a challenge reaches a terminal state, quiz
// question content is deleted. Score/answers/telemetry are kept for audit.
async function purgeQuizQuestions(env: Env, challengeId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE quizzes SET questions_json='{"questions":[]}' WHERE challenge_id=?`
  ).bind(challengeId).run();
}

export async function startQuizAttempt(
  env: Env, deps: ChallengeDeps, challengeId: string, ghLogin: string, turnstileToken: string
): Promise<StartResult> {
  const challenge = await getChallenge(env.DB, challengeId);
  if (!challenge) return { ok: false, error: "not_found" };
  if (challenge.author_login !== ghLogin) return { ok: false, error: "not_author" };

  const cfg = resolveConfig(challenge.config_json);
  const gate = canStartAttempt(challenge, cfg, deps.now());
  if (!gate.allowed) {
    return { ok: false, error: gate.reason === "not_ready" ? "not_ready" : gate.reason };
  }

  const rate = await checkAndRecordRate(env.DB, {
    user: `user:${ghLogin}`,
    repo: `repo:${challenge.repo_full_name}`,
    installation: `inst:${challenge.installation_id}`,
  }, deps.now());
  if (!rate.allowed) return { ok: false, error: "rate_limited" };

  // Turnstile informs the risk report; it never blocks (spec).
  const turnstileOk = await deps.verifyTurnstile(turnstileToken);

  const ctx = await deps.fetchPrContext(challenge);
  const generated = await deps.generateQuiz(ctx, cfg);
  if (!generated.ok) {
    // Never block merges on our own failure: neutralize.
    await setChallengeStatus(env.DB, challenge.id, "neutral");
    await deps.onChallengeResolved({
      challenge, outcome: "neutral", telemetry: null, cfg,
    });
    // Terminal state: drop any question content from earlier attempts.
    await purgeQuizQuestions(env, challenge.id);
    return { ok: false, error: "generation_failed" };
  }

  const quizId = randomToken();
  await env.DB.prepare(
    `INSERT INTO quizzes (id, challenge_id, attempt_number, questions_json, question_served_at, turnstile_ok)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    quizId, challenge.id, challenge.attempts_used + 1,
    JSON.stringify(generated.quiz), deps.now().toISOString(), turnstileOk ? 1 : 0
  ).run();
  return { ok: true, quizId };
}

interface QuizRow {
  id: string; challenge_id: string; questions_json: string; current_question: number;
  question_served_at: string | null; answers_json: string; telemetry_json: string;
  turnstile_ok: number | null; finished_at: string | null;
}

export type SubmitResult =
  | { done: false; nextQuestion: number }
  | { done: true; passed: boolean; score: number; total: number }
  | { done: true; error: "not_found" | "already_finished" };

interface PerQuestionTelemetry {
  elapsedMs: number; answerChanges: number; pointerDistancePx: number;
  pointerSamples: number; focusLossCount: number; webdriver: boolean;
}

export async function submitAnswer(
  env: Env, deps: ChallengeDeps, quizId: string, answer: number[], telemetryJson: string
): Promise<SubmitResult> {
  const quiz = await env.DB.prepare("SELECT * FROM quizzes WHERE id=?").bind(quizId).first<QuizRow>();
  if (!quiz) return { done: true, error: "not_found" };
  if (quiz.finished_at) return { done: true, error: "already_finished" };

  const questions = (JSON.parse(quiz.questions_json) as Quiz).questions;
  const answers = JSON.parse(quiz.answers_json) as Answer[];
  const now = deps.now();

  const withinTime = quiz.question_served_at !== null &&
    answerWithinTimeLimit(quiz.question_served_at, now);
  answers.push(withinTime ? answer : null);

  // accumulate per-question telemetry (best-effort; malformed input → skipped)
  const stored = JSON.parse(quiz.telemetry_json || "{}") as { perQuestion?: PerQuestionTelemetry[] };
  const perQuestion = stored.perQuestion ?? [];
  try {
    perQuestion.push(JSON.parse(telemetryJson) as PerQuestionTelemetry);
  } catch { /* missing telemetry is itself a signal, handled at report time */ }

  const nextIndex = quiz.current_question + 1;
  const isLast = nextIndex >= questions.length;

  await env.DB.prepare(
    `UPDATE quizzes SET answers_json=?, telemetry_json=?, current_question=?,
       question_served_at=?, finished_at=? WHERE id=?`
  ).bind(
    JSON.stringify(answers),
    JSON.stringify({ perQuestion }),
    nextIndex,
    isLast ? null : now.toISOString(),
    isLast ? now.toISOString() : null,
    quizId
  ).run();

  if (!isLast) return { done: false, nextQuestion: nextIndex };
  return finalizeQuiz(env, deps, quiz, questions, answers, perQuestion, now);
}

async function finalizeQuiz(
  env: Env, deps: ChallengeDeps, quiz: QuizRow, questions: Question[],
  answers: Answer[], perQuestion: PerQuestionTelemetry[], now: Date
): Promise<SubmitResult> {
  const challenge = (await getChallenge(env.DB, quiz.challenge_id))!;
  const cfg = resolveConfig(challenge.config_json);
  const { score, passed } = scoreQuiz(questions, answers, cfg.pass_threshold);

  await env.DB.prepare("UPDATE quizzes SET score=? WHERE id=?").bind(score, quiz.id).run();

  const telemetry: Telemetry | null = perQuestion.length === 0 ? null : telemetrySchema.parse({
    perQuestionMs: perQuestion.map((t) => t.elapsedMs),
    answerChanges: perQuestion.reduce((a, t) => a + t.answerChanges, 0),
    pointerDistancePx: perQuestion.reduce((a, t) => a + t.pointerDistancePx, 0),
    pointerSamples: perQuestion.reduce((a, t) => a + t.pointerSamples, 0),
    focusLossCount: perQuestion.reduce((a, t) => a + t.focusLossCount, 0),
    webdriver: perQuestion.some((t) => t.webdriver),
    turnstileOk: quiz.turnstile_ok === 1,
  });

  let outcome: ResolvedChallenge["outcome"];
  if (passed) {
    outcome = "passed";
    await setChallengeStatus(env.DB, challenge.id, "passed");
  } else {
    const attemptsUsed = challenge.attempts_used + 1;
    if (attemptsUsed >= cfg.max_attempts) {
      outcome = "failed_final";
      await env.DB.prepare("UPDATE challenges SET status='failed_final', attempts_used=? WHERE id=?")
        .bind(attemptsUsed, challenge.id).run();
    } else {
      outcome = "failed_retry";
      await env.DB.prepare("UPDATE challenges SET attempts_used=?, cooldown_until=? WHERE id=?")
        .bind(attemptsUsed, nextCooldown(cfg, now), challenge.id).run();
    }
  }

  const fresh = (await getChallenge(env.DB, challenge.id))!;
  await deps.onChallengeResolved({
    challenge: fresh, outcome, score, total: questions.length, telemetry, cfg,
  });
  // Terminal states only: retryable failures get a fresh quiz next attempt,
  // but the challenge itself is still live.
  if (outcome === "passed" || outcome === "failed_final") {
    await purgeQuizQuestions(env, challenge.id);
  }
  return { done: true, passed, score, total: questions.length };
}
