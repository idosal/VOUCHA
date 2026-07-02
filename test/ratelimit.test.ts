import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { checkAndRecordRate, RATE_LIMITS } from "../src/policy/ratelimit";
import type { Env } from "../src/types";

const testEnv = env as unknown as Env;

describe("checkAndRecordRate", () => {
  it("allows generations up to the per-user cap, then blocks", async () => {
    const scopes = { user: "user:alice", repo: "repo:o/r", installation: "inst:1" };
    for (let i = 0; i < RATE_LIMITS.user; i++) {
      const r = await checkAndRecordRate(testEnv.DB, scopes, new Date());
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkAndRecordRate(testEnv.DB, scopes, new Date());
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.scope).toBe("user");
  });

  it("does not record an event when blocked", async () => {
    const scopes = { user: "user:bob", repo: "repo:o/r2", installation: "inst:2" };
    for (let i = 0; i < RATE_LIMITS.user + 3; i++) {
      await checkAndRecordRate(testEnv.DB, scopes, new Date());
    }
    const { results } = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM rate_events WHERE scope = ?"
    ).bind("user:bob").all<{ n: number }>();
    expect(results[0].n).toBe(RATE_LIMITS.user);
  });
});
