// test/config.test.ts
import { describe, it, expect } from "vitest";
import { parseConfig, DEFAULT_CONFIG } from "../src/config";

describe("parseConfig", () => {
  it("returns defaults for null/empty input", () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(parseConfig("")).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial YAML over defaults", () => {
    const cfg = parseConfig("pass_threshold: 4\nmax_attempts: 5\n");
    expect(cfg.pass_threshold).toBe(4);
    expect(cfg.max_attempts).toBe(5);
    expect(cfg.cooldown_minutes).toBe(15); // default preserved
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
    const b = parseConfig(null);
    expect(b.pass_threshold).toBe(3);
    expect(b.skip_paths).toEqual(["docs/**", "*.md"]);
    expect(b.skip_authors).toEqual([]);
    expect(DEFAULT_CONFIG.pass_threshold).toBe(3);
  });

  it("gives fresh arrays even when other fields are set", () => {
    const a = parseConfig("pass_threshold: 4");
    a.skip_paths.push("mutated/**");
    expect(parseConfig("pass_threshold: 4").skip_paths).toEqual(["docs/**", "*.md"]);
  });
});
