import { describe, it, expect } from "vitest";
import {
  buildRiskReport,
  renderRiskReportMarkdown,
  telemetrySchema,
  type Telemetry,
} from "../src/risk/report";

const humanTelemetry: Telemetry = {
  perQuestionMs: [42000, 61000, 35000, 55000],
  answerChanges: 3,
  pointerDistancePx: 8400,
  pointerSamples: 412,
  focusLossCount: 1,
  webdriver: false,
  turnstileOk: true,
  honeypotTriggered: false,
  codeHoneypotTriggered: false,
};

const botTelemetry: Telemetry = {
  perQuestionMs: [4000, 5000, 3500, 4200],
  answerChanges: 0,
  pointerDistancePx: 30,
  pointerSamples: 4,
  focusLossCount: 0,
  webdriver: true,
  turnstileOk: false,
  honeypotTriggered: true,
  codeHoneypotTriggered: true,
};

describe("buildRiskReport", () => {
  it("scores a human-looking pass as low risk", () => {
    const r = buildRiskReport(humanTelemetry);
    expect(r.automationLikely).toBe(false);
    expect(r.signals).toEqual([]);
  });

  it("flags automation fingerprints and fast uniform answers, in plain language", () => {
    const r = buildRiskReport(botTelemetry);
    expect(r.automationLikely).toBe(true);
    expect(r.signals).toContain("the browser identified itself as automated software");
    expect(r.signals).toContain("the bot check (Turnstile) did not pass");
    expect(r.signals).toContain("every answer took under 10 seconds");
    expect(r.signals).toContain("almost no mouse movement");
    expect(r.signals).toContain("a hidden form field was submitted");
    expect(r.signals).toContain("the PR introduced a configured code honeypot marker");
  });

  it("handles missing telemetry gracefully (reports unknown, not low-risk)", () => {
    const r = buildRiskReport(null);
    expect(r.automationLikely).toBe(false);
    expect(r.signals).toContain("no interaction data was received");
  });

  it("treats honeypot alone as a signal, not a verdict", () => {
    const r = buildRiskReport({ ...humanTelemetry, honeypotTriggered: true });
    expect(r.automationLikely).toBe(false);
    expect(r.signals).toEqual(["a hidden form field was submitted"]);
  });

  it("keeps combined inconclusive interaction signals report-only", () => {
    const r = buildRiskReport({
      ...humanTelemetry,
      pointerDistancePx: 0,
      pointerSamples: 0,
      honeypotTriggered: true,
    });
    expect(r.automationLikely).toBe(false);
    expect(r.strongTimingEvidence).toBe(false);
    expect(r.signals).toContain("a hidden form field was submitted");
    expect(r.signals).toContain("almost no mouse movement");
  });

  it("treats code honeypot alone as a signal, not a verdict", () => {
    const r = buildRiskReport({ ...humanTelemetry, codeHoneypotTriggered: true });
    expect(r.automationLikely).toBe(false);
    expect(r.signals).toEqual(["the PR introduced a configured code honeypot marker"]);
  });

  it("treats a failed Turnstile result as strong evidence while keeping the code canary report-only", () => {
    const r = buildRiskReport({
      ...humanTelemetry,
      turnstileOk: false,
      codeHoneypotTriggered: true,
    });
    expect(r.automationLikely).toBe(true);
    expect(r.strongTimingEvidence).toBe(false);
    expect(r.signals).toContain("the bot check (Turnstile) did not pass");
    expect(r.signals).toContain("the PR introduced a configured code honeypot marker");
  });

  it("allows repeated server-measured sub-two-second answers to invalidate", () => {
    const r = buildRiskReport({
      ...humanTelemetry,
      perQuestionMs: [1_200, 1_450, 900, 1_100],
      pointerDistancePx: 0,
      pointerSamples: 0,
    });
    expect(r.automationLikely).toBe(true);
    expect(r.strongTimingEvidence).toBe(true);
    expect(r.signals).toContain("every answer arrived in under 2 seconds");
  });

  it("keeps merely fast answers report-only", () => {
    const r = buildRiskReport({
      ...humanTelemetry,
      perQuestionMs: [4_000, 5_000, 3_500, 4_200],
      pointerDistancePx: 0,
      pointerSamples: 0,
    });
    expect(r.automationLikely).toBe(false);
    expect(r.strongTimingEvidence).toBe(false);
    expect(r.signals).toContain("every answer took under 10 seconds");
    expect(r.signals).toContain("almost no mouse movement");
  });
});

describe("renderRiskReportMarkdown", () => {
  it("describes an assisted challenge in human terms, with timings and signals", () => {
    const md = renderRiskReportMarkdown(buildRiskReport(botTelemetry), botTelemetry);
    expect(md).toContain("completed by a script");
    expect(md).not.toContain("automation-likely");
    expect(md).toContain("Q1: 4s");
    expect(md).toContain("Turnstile");
    expect(md).toContain("Hidden field: submitted");
    expect(md).toContain("Code honeypot: matched");
  });

  it("describes a clean pass as nothing unusual", () => {
    const md = renderRiskReportMarkdown(buildRiskReport(humanTelemetry), humanTelemetry);
    expect(md).toContain("Nothing unusual");
  });
});

describe("telemetrySchema hardening", () => {
  it("degrades non-finite numbers to field defaults instead of rendering them", () => {
    const t = telemetrySchema.parse({
      perQuestionMs: [Infinity, 100],
      answerChanges: Infinity,
      pointerDistancePx: 900,
      pointerSamples: 50,
      focusLossCount: 0,
      webdriver: false,
      turnstileOk: true,
      honeypotTriggered: false,
      codeHoneypotTriggered: false,
    });
    expect(t.perQuestionMs).toEqual([]);
    expect(t.answerChanges).toBe(0);
    const md = renderRiskReportMarkdown(buildRiskReport(t), t);
    expect(md).not.toContain("Infinity");
  });

  it("renders the null-telemetry report without crashing", () => {
    const md = renderRiskReportMarkdown(buildRiskReport(null), null);
    expect(md).toContain("Mixed signals");
    expect(md).toContain("no interaction data was received");
    expect(md).not.toContain("Total time");
  });
});
