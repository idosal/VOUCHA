import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:test";
import { signSessionCookie, verifySessionCookie } from "../src/ui/session";
import {
  startQuizAttempt, submitAnswer, type ChallengeDeps,
} from "../src/challenge";
import { insertChallenge, randomToken, getChallenge } from "../src/store";
import { DEFAULT_CONFIG } from "../src/config";
import type { Env } from "../src/types";

const testEnv = env as unknown as Env;

const KEY = "0123456789abcdef0123456789abcdef";

describe("session cookie", () => {
  it("round-trips a session id", async () => {
    const cookie = await signSessionCookie(KEY, "sess-123");
    expect(await verifySessionCookie(KEY, cookie)).toBe("sess-123");
  });
  it("rejects tampered values and wrong keys", async () => {
    const cookie = await signSessionCookie(KEY, "sess-123");
    expect(await verifySessionCookie(KEY, cookie.replace("sess-123", "sess-999"))).toBeNull();
    expect(await verifySessionCookie("f".repeat(32), cookie)).toBeNull();
    expect(await verifySessionCookie(KEY, "garbage")).toBeNull();
  });
});

const quiz = {
  questions: [
    { type: "consequence_mcq" as const, prompt: "q1 prompt is long enough", options: ["a","b","c","d"], correct: [0] },
    { type: "blast_radius_multi" as const, prompt: "q2 prompt is long enough", options: ["a","b","c","d"], correct: [1,2] },
    { type: "false_claim" as const, prompt: "q3 prompt is long enough", options: ["a","b","c","d"], correct: [3] },
    { type: "consequence_mcq" as const, prompt: "q4 prompt is long enough", options: ["a","b","c","d"], correct: [2] },
  ],
};

function deps(overrides: Partial<ChallengeDeps> = {}): ChallengeDeps {
  return {
    generateQuiz: vi.fn(async () => ({ ok: true as const, quiz })),
    verifyTurnstile: vi.fn(async () => true),
    fetchPrContext: vi.fn(async () => ({ diff: "d", title: "t", body: null, files: ["a.ts"] })),
    onChallengeResolved: vi.fn(async () => {}),
    now: () => new Date("2026-07-02T12:00:00Z"),
    ...overrides,
  };
}

async function makeChallenge(status = "ready"): Promise<string> {
  const id = randomToken();
  await insertChallenge(testEnv.DB, {
    id, installation_id: 1, repo_full_name: "o/r", pr_number: 1,
    head_sha: randomToken(8), author_login: "alice", check_run_id: 42,
    status: status as any, approved_by: null, attempts_used: 0,
    cooldown_until: null, config_json: JSON.stringify(DEFAULT_CONFIG),
  });
  return id;
}

describe("startQuizAttempt", () => {
  it("creates a quiz for the author when ready + turnstile ok", async () => {
    const id = await makeChallenge();
    const d = deps();
    const r = await startQuizAttempt(testEnv, d, id, "alice", "turnstile-token");
    expect(r.ok).toBe(true);
    expect(d.generateQuiz).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-author even with a valid session", async () => {
    const id = await makeChallenge();
    const r = await startQuizAttempt(testEnv, deps(), id, "mallory", "tok");
    expect(r).toEqual({ ok: false, error: "not_author" });
  });

  it("rejects when awaiting approval", async () => {
    const id = await makeChallenge("awaiting_approval");
    const r = await startQuizAttempt(testEnv, deps(), id, "alice", "tok");
    expect(r).toEqual({ ok: false, error: "not_ready" });
  });

  it("records turnstile failure but still allows the attempt (informs, never blocks)", async () => {
    const id = await makeChallenge();
    const d = deps({ verifyTurnstile: vi.fn(async () => false) });
    const r = await startQuizAttempt(testEnv, d, id, "alice", "tok");
    expect(r.ok).toBe(true);
  });

  it("neutralizes the check when LLM generation fails twice", async () => {
    const id = await makeChallenge();
    const d = deps({ generateQuiz: vi.fn(async () => ({ ok: false as const, error: "boom" })) });
    const r = await startQuizAttempt(testEnv, d, id, "alice", "tok");
    expect(r).toEqual({ ok: false, error: "generation_failed" });
    expect(d.onChallengeResolved).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "neutral" })
    );
    expect((await getChallenge(testEnv.DB, id))?.status).toBe("neutral");
  });
});

describe("submitAnswer", () => {
  async function startedQuiz(passOverrides: Partial<ChallengeDeps> = {}) {
    const id = await makeChallenge();
    const d = deps(passOverrides);
    const started = await startQuizAttempt(testEnv, d, id, "alice", "tok");
    if (!started.ok) throw new Error("setup failed");
    return { challengeId: id, quizId: started.quizId, d };
  }

  const telemetry = JSON.stringify({
    elapsedMs: 30000, answerChanges: 1, pointerDistancePx: 900,
    pointerSamples: 50, focusLossCount: 0, webdriver: false,
  });

  it("passes with 3+ correct answers, resolves challenge as passed", async () => {
    const { challengeId, quizId, d } = await startedQuiz();
    await submitAnswer(testEnv, d, quizId, [0], telemetry);  // correct
    await submitAnswer(testEnv, d, quizId, [1, 2], telemetry); // correct
    await submitAnswer(testEnv, d, quizId, [0], telemetry);  // wrong (correct is 3)
    const final = await submitAnswer(testEnv, d, quizId, [2], telemetry); // correct
    expect(final.done).toBe(true);
    if (final.done && "passed" in final) expect(final.passed).toBe(true);
    else expect.fail("expected a graded result, not an error");
    expect((await getChallenge(testEnv.DB, challengeId))?.status).toBe("passed");
    expect(d.onChallengeResolved).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "passed", score: 3 })
    );
  });

  it("fails below threshold, sets cooldown, increments attempts", async () => {
    const { challengeId, quizId, d } = await startedQuiz();
    for (const ans of [[1], [0], [0], [0]]) await submitAnswer(testEnv, d, quizId, ans, telemetry);
    const ch = await getChallenge(testEnv.DB, challengeId);
    expect(ch?.status).toBe("ready"); // retryable
    expect(ch?.attempts_used).toBe(1);
    expect(ch?.cooldown_until).toBe("2026-07-02T12:15:00.000Z");
  });

  it("marks failed_final when max attempts exhausted", async () => {
    const id = await makeChallenge();
    await testEnv.DB.prepare("UPDATE challenges SET attempts_used=2 WHERE id=?").bind(id).run();
    const d = deps();
    const started = await startQuizAttempt(testEnv, d, id, "alice", "tok");
    if (!started.ok) throw new Error("setup failed");
    for (const ans of [[1], [0], [0], [0]]) await submitAnswer(testEnv, d, started.quizId, ans, telemetry);
    expect((await getChallenge(testEnv.DB, id))?.status).toBe("failed_final");
    expect(d.onChallengeResolved).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed_final" })
    );
  });

  it("counts an over-time answer as wrong", async () => {
    const { quizId, d } = await startedQuiz();
    // pretend the question was served 3 minutes ago
    await testEnv.DB.prepare("UPDATE quizzes SET question_served_at=? WHERE id=?")
      .bind("2026-07-02T11:57:00Z", quizId).run();
    const r = await submitAnswer(testEnv, d, quizId, [0], telemetry);
    expect(r.done).toBe(false);
    const row = await testEnv.DB.prepare("SELECT answers_json FROM quizzes WHERE id=?")
      .bind(quizId).first<{ answers_json: string }>();
    expect(JSON.parse(row!.answers_json)[0]).toBeNull(); // recorded as timeout
  });

  it("purges question content from the quiz row after a pass (data custody)", async () => {
    const { quizId, d } = await startedQuiz();
    await submitAnswer(testEnv, d, quizId, [0], telemetry);
    await submitAnswer(testEnv, d, quizId, [1, 2], telemetry);
    await submitAnswer(testEnv, d, quizId, [3], telemetry);
    const final = await submitAnswer(testEnv, d, quizId, [2], telemetry);
    expect(final.done).toBe(true);
    const row = await testEnv.DB.prepare(
      "SELECT questions_json, score, answers_json, telemetry_json FROM quizzes WHERE id=?"
    ).bind(quizId).first<{ questions_json: string; score: number; answers_json: string; telemetry_json: string }>();
    expect(row!.questions_json).not.toContain("prompt is long enough");
    expect(JSON.parse(row!.questions_json)).toEqual({ questions: [] });
    // score, answers, telemetry are retained
    expect(row!.score).toBe(4);
    expect(JSON.parse(row!.answers_json)).toHaveLength(4);
    expect(JSON.parse(row!.telemetry_json).perQuestion).toHaveLength(4);
  });
});
