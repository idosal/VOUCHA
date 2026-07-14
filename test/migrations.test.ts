import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

describe("D1 migrations", () => {
  it("applies all tables to the test database", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const t of [
      "installations", "challenges", "quizzes", "sessions", "rate_events",
      "pr_investigations", "prepared_quizzes", "webauthn_credentials",
      "webauthn_challenges", "challenge_confirmations",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("supports an insert/select round-trip", async () => {
    await env.DB.prepare(
      "INSERT INTO installations (id, account_login) VALUES (1, 'octocat')"
    ).run();
    const row = await env.DB.prepare("SELECT account_login FROM installations WHERE id=1")
      .first<{ account_login: string }>();
    expect(row?.account_login).toBe("octocat");
  });

  it("includes durable reconciliation markers on challenges", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(challenges)")
      .all<{ name: string }>();
    const columns = results.map((r) => r.name);
    expect(columns).toContain("auto_closed_at");
    expect(columns).toContain("terminal_reconciled_at");
    expect(columns).toContain("delta_base_sha");
  });

  it("includes active-attempt and stable GitHub identity columns", async () => {
    const quizzes = await env.DB.prepare("PRAGMA table_info(quizzes)")
      .all<{ name: string }>();
    expect(quizzes.results.map((column) => column.name)).toContain("state");

    const sessions = await env.DB.prepare("PRAGMA table_info(sessions)")
      .all<{ name: string }>();
    expect(sessions.results.map((column) => column.name)).toContain("github_user_id");
  });
});
