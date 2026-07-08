import { describe, expect, it } from "vitest";
import {
  HONEYPOT_FIELD_NAME,
  errorPage,
  homePage,
  questionPage,
  resultPage,
  startPage,
  verificationPage,
} from "../src/ui/pages";

const question = {
  type: "consequence_mcq" as const,
  prompt: "What does this PR change?",
  options: ["One", "Two", "Three", "Four"],
  multiSelect: false,
};

describe("challenge pages", () => {
  it("renders the public website with install and product framing", () => {
    const html = homePage("https://clawptcha.example.com");

    expect(html).toContain("<h1 id=\"home-title\">Merge work<br>people can explain.</h1>");
    expect(html).toContain("GitHub PR comprehension checks for maintainers.");
    expect(html).toContain("Challenge help is not.");
    expect(html).toContain("complements code review, CI, tests, and branch protection");
    expect(html).toContain("Deploy to Cloudflare");
    expect(html).toContain("Deploy from GitHub");
    expect(html).toContain("CLI setup");
    expect(html).toContain("Deploy to Cloudflare");
    expect(html).toContain("Policy stays in the repo");
    expect(html).toContain("Challenge required");
    expect(html).toContain("Evaluate PR");
    expect(html).toContain("Post evidence");
    expect(html).toContain("Need the details?");
    expect(html).toContain("rollout, policy configuration, deployment, passive signals, privacy, and verification");
    expect(html).toContain("Open docs");
    expect(html).toContain('href="/docs/"');
    expect(html).toContain('href="/docs/getting-started/"');
    expect(html).toContain("Node 22.22.1+");
    expect(html).not.toContain("Open the Starlight docs");
    expect(html).not.toContain('href="/docs/why-clawptcha/"');
    expect(html).toContain("Ask author");
    expect(html).toContain("short quiz scoped to the diff");
    expect(html).not.toContain("Team exemptions require GitHub Members read permission");
    expect(html).not.toContain("contributor-accepted answers");
    expect(html).not.toContain("npx wrangler login &amp;&amp; npm run setup");
    expect(html).not.toContain("clawptcha.example.com");
    expect(html).toContain("Policy stays in the repo.");
  });

  it("renders the honeypot field when the signal is enabled", () => {
    const start = startPage("o/r#1", "site-key", "challenge-id", true);
    const questionHtml = questionPage("challenge-id", 0, 4, question, 60_000, true);

    expect(start).toContain(`name="${HONEYPOT_FIELD_NAME}"`);
    expect(start).toContain('name="terms_acceptance"');
    expect(start).toContain("Stand behind this PR.");
    expect(start).toContain("I understand what will be posted.");
    expect(start).toContain("post the result to the PR");
    expect(start).toContain("/docs/privacy-data/");
    expect(questionHtml).toContain(`name="${HONEYPOT_FIELD_NAME}"`);
    expect(questionHtml).toContain('tabindex="-1"');
    expect(start).toContain("Bot verification failures stop the challenge");
    expect(start).not.toContain("Privacy posture");
    expect(start).toContain("@media (prefers-color-scheme:dark)");
    expect(start).toContain("color-scheme:dark");
  });

  it("renders GitHub comment verification without delegated account access", () => {
    const html = verificationPage("o/r#1", "alice", "challenge-id", "abc123", "https://github.com/o/r/pull/1#issuecomment-new");

    expect(html).toContain("Verify from the PR.");
    expect(html).toContain("/clawptcha verify abc123");
    expect(html).toContain("Copy and open PR");
    expect(html).toContain('id="openPrLink"');
    expect(html).toContain("Open PR");
    expect(html).toContain("Waiting for your GitHub comment.");
    expect(html).toContain("https://github.com/o/r/pull/1#issuecomment-new");
    expect(html).toContain("/challenge/challenge-id/verify/status");
    expect(html).toContain("never receives a GitHub user token");
    expect(html).toContain("cannot comment, approve, or answer on your behalf");
    expect(html).toContain('action="/challenge/challenge-id/verify"');
    expect(html).toContain("Copy failed. Select the command above, then use Open PR");
  });

  it("renders terminal page actions back to the PR and challenge", () => {
    const actions = [
      { label: "Back to PR", href: "https://github.com/o/r/pull/1", primary: true, external: true },
      { label: "Refresh challenge", href: "/challenge/challenge-id" },
    ];
    const result = resultPage(true, 4, 4, "Done.", actions);
    const error = errorPage("Challenge no longer active", "Check the PR.", actions);

    for (const html of [result, error]) {
      expect(html).toContain("Back to PR");
      expect(html).toContain('href="https://github.com/o/r/pull/1"');
      expect(html).toContain('target="_blank" rel="noopener noreferrer"');
      expect(html).toContain("Refresh challenge");
      expect(html).toContain('href="/challenge/challenge-id"');
    }
  });

  it("omits the honeypot field when signals are disabled", () => {
    const start = startPage("o/r#1", "site-key", "challenge-id", false);
    const questionHtml = questionPage("challenge-id", 0, 4, question, 60_000, false);

    expect(start).not.toContain(`name="${HONEYPOT_FIELD_NAME}"`);
    expect(questionHtml).not.toContain(`name="${HONEYPOT_FIELD_NAME}"`);
  });
});
