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
});
