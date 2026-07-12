import { z } from "zod";

export const telemetrySchema = z.object({
  perQuestionMs: z.array(z.number().nonnegative().finite()).catch(() => []),
  answerChanges: z.number().int().nonnegative().finite().catch(0),
  pointerDistancePx: z.number().nonnegative().finite().catch(0),
  pointerSamples: z.number().int().nonnegative().finite().catch(0),
  focusLossCount: z.number().int().nonnegative().finite().catch(0),
  webdriver: z.boolean().catch(false),
  turnstileOk: z.boolean().catch(false),
  honeypotTriggered: z.boolean().catch(false),
  codeHoneypotTriggered: z.boolean().catch(false),
});

export type Telemetry = z.infer<typeof telemetrySchema>;

export interface RiskReport {
  automationLikely: boolean;
  strongTimingEvidence: boolean;
  signals: string[];
}

export const STRONG_TIMING_THRESHOLD_MS = 2_000;
export const STRONG_TIMING_MIN_QUESTIONS = 2;
export const STRONG_TIMING_FAILURE_REASON =
  "Answers arrived too quickly across the quiz to verify a manual completion.";

// Simple heuristics only in v1. Independent challenge-taking automation
// signals can invalidate a correct quiz because the challenge must be answered
// by the PR author. Code canary hits remain PR-risk evidence in the report.
// Signal strings are maintainer-facing copy — plain language, no classifier jargon.
export function buildRiskReport(t: Telemetry | null): RiskReport {
  if (t === null) {
    return {
      automationLikely: false,
      strongTimingEvidence: false,
      signals: ["no interaction data was received"],
    };
  }
  const signals: string[] = [];
  if (t.honeypotTriggered) signals.push("a hidden form field was submitted");
  if (t.codeHoneypotTriggered) signals.push("the PR introduced a configured code honeypot marker");
  if (t.webdriver) {
    signals.push("the browser identified itself as automated software");
  }
  if (!t.turnstileOk) {
    signals.push("the bot check (Turnstile) did not pass");
  }
  const strongTimingEvidence =
    t.perQuestionMs.length >= STRONG_TIMING_MIN_QUESTIONS &&
    t.perQuestionMs.every((ms) => ms < STRONG_TIMING_THRESHOLD_MS);
  if (strongTimingEvidence) {
    signals.push("every answer arrived in under 2 seconds");
  } else if (t.perQuestionMs.length > 0 && t.perQuestionMs.every((ms) => ms < 10_000)) {
    signals.push("every answer took under 10 seconds");
  }
  if (t.pointerDistancePx < 200 || t.pointerSamples < 10) {
    signals.push("almost no mouse movement");
  }
  // Turnstile, webdriver, and repeated server-measured sub-two-second answers
  // are strong evidence. Speed under ten seconds, pointer absence, focus loss,
  // and honeypots stay report-only because each can describe a legitimate user.
  return {
    automationLikely: t.webdriver || !t.turnstileOk || strongTimingEvidence,
    strongTimingEvidence,
    signals,
  };
}

export function renderRiskReportMarkdown(report: RiskReport, t: Telemetry | null): string {
  const lines: string[] = ["### Risk report", ""];
  lines.push(
    report.automationLikely
      ? "**Strong automation evidence:** this quiz looks like it may have been completed by a script. The challenge result should not be treated as author attestation without review."
      : report.signals.length > 0
        ? "**Mixed signals:** nothing conclusive on its own; details below."
        : "**Nothing unusual:** the quiz was completed the way a person typically would."
  );
  lines.push("");
  if (t) {
    const total = t.perQuestionMs.reduce((a, b) => a + b, 0);
    lines.push(`- Total time: ${Math.round(total / 1000)}s`);
    lines.push(
      `- Per question: ${t.perQuestionMs.map((ms, i) => `Q${i + 1}: ${Math.round(ms / 1000)}s`).join(", ")}`
    );
    lines.push(`- Turnstile: ${t.turnstileOk ? "passed" : "failed/missing"}`);
    lines.push(`- Hidden field: ${t.honeypotTriggered ? "submitted" : "clear"}`);
    lines.push(`- Code honeypot: ${t.codeHoneypotTriggered ? "matched" : "clear"}`);
    lines.push(`- Answer changes: ${t.answerChanges}, focus losses: ${t.focusLossCount}`);
    lines.push(`- Pointer: ${Math.round(t.pointerDistancePx)}px over ${t.pointerSamples} samples`);
  }
  if (report.signals.length > 0) {
    lines.push("", "Signals:");
    for (const s of report.signals) lines.push(`- ${s}`);
  }
  return lines.join("\n");
}
