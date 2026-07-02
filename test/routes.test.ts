import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { signBody } from "../src/github/webhook";
import type { Env } from "../src/types";

const testEnv = env as unknown as Env;

describe("POST /webhook", () => {
  it("rejects unsigned payloads", async () => {
    const req = new Request("https://x/webhook", { method: "POST", body: "{}" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, testEnv, ctx);
    expect(res.status).toBe(401);
  });

  it("accepts a signed payload", async () => {
    const body = JSON.stringify({ action: "labeled", installation: { id: 1 } }); // ignored action
    const sig = await signBody(testEnv.GITHUB_WEBHOOK_SECRET, body);
    const req = new Request("https://x/webhook", {
      method: "POST", body,
      headers: { "x-hub-signature-256": sig, "x-github-event": "pull_request" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });
});

describe("GET /challenge/:id", () => {
  it("404s for unknown challenge ids", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://x/challenge/nope"), testEnv, ctx);
    expect(res.status).toBe(404);
  });

  it("redirects anonymous visitors to GitHub OAuth", async () => {
    await testEnv.DB.prepare(
      `INSERT INTO challenges (id, installation_id, repo_full_name, pr_number, head_sha,
        author_login, status, config_json) VALUES ('ch1', 1, 'o/r', 1, 's', 'alice', 'ready', '{}')`
    ).run();
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://x/challenge/ch1"), testEnv, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("github.com/login/oauth/authorize");
    expect(res.headers.get("set-cookie")).toContain("clawptcha_session");
  });
});

describe("GET /oauth/callback (login-CSRF guard)", () => {
  it("rejects a callback whose state matches a session but whose request has no matching cookie", async () => {
    // A session + state exists (created by some browser), but the request
    // completing OAuth carries no clawptcha_session cookie for that session —
    // the login-CSRF scenario. gh_login must NOT be written.
    await testEnv.DB.prepare(
      `INSERT INTO challenges (id, installation_id, repo_full_name, pr_number, head_sha,
        author_login, status, config_json) VALUES ('chCsrf', 1, 'o/r', 2, 's2', 'alice', 'ready', '{}')`
    ).run();
    await testEnv.DB.prepare(
      "INSERT INTO sessions (id, challenge_id, oauth_state) VALUES ('sessCsrf', 'chCsrf', 'stateCsrf')"
    ).run();
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://x/oauth/callback?code=abc&state=stateCsrf"),
      testEnv,
      ctx
    );
    expect(res.status).toBe(400);
    const row = await testEnv.DB.prepare("SELECT gh_login, oauth_state FROM sessions WHERE id='sessCsrf'")
      .first<{ gh_login: string | null; oauth_state: string | null }>();
    expect(row?.gh_login).toBeNull();       // identity was not bound
    expect(row?.oauth_state).toBe("stateCsrf"); // state not consumed
  });

  it("shows a canceled-sign-in page when GitHub returns error=access_denied", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://x/oauth/callback?error=access_denied&state=whatever"),
      testEnv,
      ctx
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("canceled");
  });
});
