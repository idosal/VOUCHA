// test/config.test.ts
import { describe, it, expect } from "vitest";
import {
  getLinkedIssueMatchExemption,
  getCodeHoneypotSignals,
  getMultipleChoiceGate,
  hasHoneypotSignal,
  parseConfig,
  DEFAULT_CONFIG,
} from "../src/config";

describe("parseConfig", () => {
  it("returns defaults for null/empty input", () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(parseConfig("")).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial YAML over defaults", () => {
    const cfg = parseConfig("pass_threshold: 4\nmax_attempts: 5\n");
    expect(cfg.pass_threshold).toBe(4);
    expect(getMultipleChoiceGate(cfg)).toEqual({ type: "multiple_choice", questions: 4, pass_threshold: 4 });
    expect(cfg.max_attempts).toBe(5);
    expect(cfg.cooldown_minutes).toBe(15); // default preserved
  });

  it("parses configurable gates", () => {
    const cfg = parseConfig(
      "gates:\n  - type: multiple_choice\n    questions: 6\n    pass_threshold: 5\n"
    );
    expect(getMultipleChoiceGate(cfg)).toEqual({ type: "multiple_choice", questions: 6, pass_threshold: 5 });
    expect(cfg.pass_threshold).toBe(5); // legacy compatibility mirror
  });

  it("caps a multiple-choice threshold at its question count", () => {
    const cfg = parseConfig(
      "gates:\n  - type: multiple_choice\n    questions: 3\n    pass_threshold: 9\n"
    );
    expect(getMultipleChoiceGate(cfg)).toEqual({ type: "multiple_choice", questions: 3, pass_threshold: 3 });
  });

  it("parses linked issue match exemptions", () => {
    const cfg = parseConfig(
      "exemptions:\n  - type: linked_issue_match\n    min_match_score: 0.8\n    trusted_labels: [accepted]\n"
    );
    expect(getLinkedIssueMatchExemption(cfg)).toEqual({
      type: "linked_issue_match",
      require_same_repo: true,
      require_trusted_signal: true,
      min_match_score: 0.8,
      max_issues: 5,
      trusted_labels: ["accepted"],
    });
  });

  it("enables report-only honeypot signals by default and supports opt-out", () => {
    expect(hasHoneypotSignal(parseConfig(null))).toBe(true);
    expect(parseConfig(null).signals).toEqual([{ type: "honeypot", report_only: true }]);
    expect(hasHoneypotSignal(parseConfig("signals: []\n"))).toBe(false);
  });

  it("parses honeypot signals as report-only even if a config tries to make them blocking", () => {
    const cfg = parseConfig(
      "signals:\n  - type: honeypot\n    report_only: false\n"
    );
    expect(cfg.signals).toEqual([{ type: "honeypot", report_only: true }]);
  });

  it("parses code honeypot signals with literal patterns and path filters", () => {
    const cfg = parseConfig([
      "signals:",
      "  - type: code_honeypot",
      "    report_only: false",
      "    patterns: [CLAWPTCHA_DO_NOT_ADD_THIS, CLAWPTCHA_DO_NOT_ADD_THIS]",
      "    paths: ['src/**', '*.md', 'src/**']",
      "",
    ].join("\n"));

    expect(getCodeHoneypotSignals(cfg)).toEqual([{
      type: "code_honeypot",
      report_only: true,
      patterns: ["CLAWPTCHA_DO_NOT_ADD_THIS"],
      paths: ["src/**", "*.md"],
    }]);
  });

  it("keeps invalid code honeypot patterns inert", () => {
    const cfg = parseConfig([
      "signals:",
      "  - type: code_honeypot",
      "    patterns: []",
      "",
    ].join("\n"));

    expect(getCodeHoneypotSignals(cfg)).toEqual([{
      type: "code_honeypot",
      report_only: true,
      patterns: [],
      paths: ["**"],
    }]);
  });

  it("parses require_approval enum and rejects bad values", () => {
    expect(parseConfig("require_approval: always").require_approval).toBe("always");
    // invalid value falls back to default rather than crashing webhook handling
    expect(parseConfig("require_approval: sometimes").require_approval).toBe("first_time");
  });

  it("parses skip lists and max_context_tokens", () => {
    const cfg = parseConfig(
      "skip_authors: [octocat]\nskip_paths: ['*.md']\nmax_context_tokens: 20000\n"
    );
    expect(cfg.skip_authors).toEqual(["octocat"]);
    expect(cfg.skip_paths).toEqual(["*.md"]);
    expect(cfg.max_context_tokens).toBe(20000);
  });

  it("returns defaults on malformed YAML", () => {
    expect(parseConfig(":: not yaml ::[")).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults for top-level arrays and scalars", () => {
    expect(parseConfig("- 1\n- 2\n")).toEqual(DEFAULT_CONFIG);
    expect(parseConfig("42")).toEqual(DEFAULT_CONFIG);
    expect(parseConfig("just a string")).toEqual(DEFAULT_CONFIG);
  });

  it("degrades out-of-range numbers to their defaults", () => {
    const cfg = parseConfig("pass_threshold: 0\nmax_attempts: -3\n");
    expect(cfg.pass_threshold).toBe(3);
    expect(cfg.max_attempts).toBe(3);
  });

  it("returns a fresh object per call (no shared mutable state)", () => {
    const a = parseConfig(null);
    a.pass_threshold = 999;
    a.skip_paths.push("mutated/**");
    a.skip_authors.push("mallory");
    a.gates.push({ type: "multiple_choice", questions: 2, pass_threshold: 2 });
    a.signals.push({ type: "honeypot", report_only: true });
    a.signals.push({
      type: "code_honeypot",
      report_only: true,
      patterns: ["MUTATE_ME"],
      paths: ["src/**"],
    });
    const codeSignal = a.signals.find((signal) => signal.type === "code_honeypot");
    codeSignal?.patterns.push("changed");
    const b = parseConfig(null);
    expect(b.pass_threshold).toBe(3);
    expect(b.skip_paths).toEqual(["docs/**", "*.md"]);
    expect(b.skip_authors).toEqual([]);
    expect(b.gates).toEqual([{ type: "multiple_choice", questions: 4, pass_threshold: 3 }]);
    expect(b.signals).toEqual([{ type: "honeypot", report_only: true }]);
    expect(DEFAULT_CONFIG.pass_threshold).toBe(3);
  });

  it("gives fresh arrays even when other fields are set", () => {
    const a = parseConfig("pass_threshold: 4");
    a.skip_paths.push("mutated/**");
    expect(parseConfig("pass_threshold: 4").skip_paths).toEqual(["docs/**", "*.md"]);
  });
});
