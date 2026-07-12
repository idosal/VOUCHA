import { describe, it, expect, vi } from "vitest";
import type { LinkedIssueMatchExemption } from "../src/config";
import type { QuizProvider } from "../src/quiz/providers";
import {
  evaluateLinkedIssueExemption,
  extractLinkedIssueReferences,
  scoreLinkedIssueMatch,
  type IssueFacts,
  type LinkedIssueDeps,
} from "../src/policy/linked-issue";

const cfg: LinkedIssueMatchExemption = {
  type: "linked_issue_match",
  require_same_repo: true,
  require_trusted_signal: true,
  min_match_score: 0.7,
  max_issues: 5,
  trusted_labels: [],
};

const issue: IssueFacts = {
  repo: "o/r",
  number: 12,
  title: "Add dark mode to the dashboard",
  body: "Users need the dashboard to switch to a dark theme.",
  authorLogin: "maintainer",
  authorAssociation: "MEMBER",
  assignees: [],
  labels: [],
  isPullRequest: false,
};

const pr = {
  repo: "o/r",
  title: "Implement dashboard dark mode",
  body: "Fixes #12",
  changedFiles: ["src/dashboard/theme.ts"],
};

function providerResult(result: unknown): QuizProvider {
  return {
    complete: vi.fn(async () => ({ ok: true as const, text: JSON.stringify(result) })),
  };
}

function deps(overrides: Partial<LinkedIssueDeps> = {}): LinkedIssueDeps {
  return {
    getIssue: vi.fn(async () => issue),
    getIssueEvents: vi.fn(async () => []),
    getUserPermission: vi.fn(async () => "none"),
    provider: providerResult({ score: 0.86, rationale: "The PR implements the requested theme." }),
    ...overrides,
  };
}

describe("extractLinkedIssueReferences", () => {
  it("extracts closing-keyword issue references", () => {
    expect(extractLinkedIssueReferences("Fixes #12", "o/r", true)).toEqual([{ repo: "o/r", number: 12 }]);
    expect(extractLinkedIssueReferences("Resolves o/r#13", "o/r", true)).toEqual([{ repo: "o/r", number: 13 }]);
    expect(extractLinkedIssueReferences("Closes https://github.com/o/r/issues/14", "o/r", true))
      .toEqual([{ repo: "o/r", number: 14 }]);
  });

  it("ignores cross-repo references by default", () => {
    expect(extractLinkedIssueReferences("Fixes other/repo#12", "o/r", true)).toEqual([]);
  });
});

describe("scoreLinkedIssueMatch", () => {
  it("asks the LLM for a structured semantic score", async () => {
    const provider = providerResult({ score: 0.84, rationale: "Same requested outcome." });

    await expect(scoreLinkedIssueMatch(provider, issue, pr)).resolves.toEqual({
      ok: true,
      score: 0.84,
    });

    expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining("semantic match"),
      prompt: expect.stringContaining("Add dark mode to the dashboard"),
      schema: expect.objectContaining({
        required: ["score", "rationale"],
      }),
    }));
  });

  it("rejects malformed or out-of-range model output", async () => {
    await expect(scoreLinkedIssueMatch(
      providerResult({ score: 1.4, rationale: "Impossible confidence." }),
      issue,
      pr
    )).resolves.toEqual({ ok: false });
  });

  it("fails closed when the model provider fails", async () => {
    const provider: QuizProvider = {
      complete: vi.fn(async () => ({ ok: false as const, error: "provider unavailable" })),
    };
    await expect(scoreLinkedIssueMatch(provider, issue, pr)).resolves.toEqual({ ok: false });
  });
});

describe("evaluateLinkedIssueExemption", () => {
  it("exempts when a maintainer-authored linked issue has a high model score", async () => {
    const result = await evaluateLinkedIssueExemption(pr, cfg, deps());
    expect(result).toEqual({
      exempt: true,
      reason: "linked issue o/r#12 was approved and semantically matches this PR (LLM score 0.86)",
    });
  });

  it("falls through when the model score is below the configured threshold", async () => {
    const result = await evaluateLinkedIssueExemption(pr, cfg, deps({
      provider: providerResult({ score: 0.69, rationale: "Only tangentially related." }),
    }));
    expect(result).toEqual({ exempt: false });
  });

  it("falls through when the linked issue has no maintainer approval evidence", async () => {
    const provider = providerResult({ score: 0.95, rationale: "Same work." });
    const result = await evaluateLinkedIssueExemption(pr, cfg, deps({
      getIssue: vi.fn(async () => ({ ...issue, authorAssociation: "NONE" })),
      provider,
    }));
    expect(result).toEqual({ exempt: false });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it("accepts a configured approval label only when a maintainer applied it", async () => {
    const result = await evaluateLinkedIssueExemption(pr, {
      ...cfg,
      trusted_labels: ["approved"],
    }, deps({
      getIssue: vi.fn(async () => ({
        ...issue,
        authorAssociation: "NONE",
        labels: ["approved"],
      })),
      getIssueEvents: vi.fn(async () => [{
        event: "labeled",
        label: "approved",
        actorLogin: "maintainer",
      }]),
      getUserPermission: vi.fn(async () => "maintain"),
    }));
    expect(result.exempt).toBe(true);
  });

  it("rejects an approval label applied by a non-maintainer", async () => {
    const provider = providerResult({ score: 0.95, rationale: "Same work." });
    const result = await evaluateLinkedIssueExemption(pr, {
      ...cfg,
      trusted_labels: ["approved"],
    }, deps({
      getIssue: vi.fn(async () => ({
        ...issue,
        authorAssociation: "NONE",
        labels: ["approved"],
      })),
      getIssueEvents: vi.fn(async () => [{
        event: "labeled",
        label: "approved",
        actorLogin: "contributor",
      }]),
      getUserPermission: vi.fn(async () => "read"),
      provider,
    }));
    expect(result).toEqual({ exempt: false });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it("does not treat assignment as maintainer approval", async () => {
    const provider = providerResult({ score: 0.95, rationale: "Same work." });
    const result = await evaluateLinkedIssueExemption(pr, cfg, deps({
      getIssue: vi.fn(async () => ({
        ...issue,
        authorAssociation: "NONE",
        assignees: ["maintainer"],
      })),
      getUserPermission: vi.fn(async () => "write"),
      provider,
    }));
    expect(result).toEqual({ exempt: false });
    expect(provider.complete).not.toHaveBeenCalled();
  });
});
