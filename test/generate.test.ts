import { describe, it, expect, vi } from "vitest";
import { generateQuiz, buildGenerationPrompt, capContext } from "../src/quiz/generate";

const goodQuizJson = JSON.stringify({
  questions: [
    { type: "consequence_mcq", prompt: "What happens when X after this change?", options: ["a", "b", "c", "d"], correct: [0] },
    { type: "blast_radius_multi", prompt: "Which behaviors are affected by this PR?", options: ["a", "b", "c", "d"], correct: [1, 2] },
    { type: "false_claim", prompt: "Which statement about this PR is false?", options: ["a", "b", "c", "d"], correct: [3] },
    { type: "consequence_mcq", prompt: "What happens on cold start after this change?", options: ["a", "b", "c", "d"], correct: [2] },
  ],
});

function stubClient(responses: string[]) {
  let i = 0;
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: "text", text: responses[Math.min(i++, responses.length - 1)] }],
        stop_reason: "end_turn",
      })),
    },
  };
}

describe("capContext", () => {
  it("passes small diffs through untouched", () => {
    expect(capContext("small diff", ["a.ts"], null)).toBe("small diff");
  });
  it("truncates and appends a file list when over the cap", () => {
    const big = "x".repeat(400);
    const out = capContext(big, ["a.ts", "b.ts"], 50); // 50 tokens ≈ 200 chars
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain("[diff truncated]");
    expect(out).toContain("a.ts");
  });
});

describe("generateQuiz", () => {
  it("returns a validated quiz from the model", async () => {
    const client = stubClient([goodQuizJson]);
    const r = await generateQuiz(client as any, "claude-sonnet-5", "diff", "title", "body", ["a.ts"], null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.quiz.questions).toHaveLength(4);
  });

  it("retries once on invalid output, then succeeds", async () => {
    const client = stubClient(["not json at all", goodQuizJson]);
    const r = await generateQuiz(client as any, "claude-sonnet-5", "diff", "t", null, [], null);
    expect(r.ok).toBe(true);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("fails after two invalid outputs", async () => {
    const client = stubClient(['{"questions": []}']);
    const r = await generateQuiz(client as any, "claude-sonnet-5", "diff", "t", null, [], null);
    expect(r.ok).toBe(false);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("fails gracefully when the API throws", async () => {
    const client = { messages: { create: vi.fn(async () => { throw new Error("529"); }) } };
    const r = await generateQuiz(client as any, "claude-sonnet-5", "diff", "t", null, [], null);
    expect(r.ok).toBe(false);
  });
});

describe("buildGenerationPrompt", () => {
  it("includes diff, title, and question-type instructions", () => {
    const p = buildGenerationPrompt("THE_DIFF", "My title", "My body", ["a.ts"], null);
    expect(p).toContain("THE_DIFF");
    expect(p).toContain("My title");
    expect(p).toContain("blast_radius_multi");
  });
});
