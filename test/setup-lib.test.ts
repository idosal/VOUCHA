import { describe, it, expect } from "vitest";
import { buildManifest, manifestFormHtml, parseDeployedUrl, patchAppBaseUrl } from "../scripts/setup-lib.mts";

describe("buildManifest", () => {
  const m = buildManifest({
    appName: "clawptcha-test",
    baseUrl: "https://clawptcha.example.workers.dev",
    redirectUrl: "http://localhost:8976/callback",
  });

  it("sets urls derived from the base url", () => {
    expect(m.url).toBe("https://clawptcha.example.workers.dev");
    expect(m.hook_attributes).toEqual({ url: "https://clawptcha.example.workers.dev/webhook" });
    expect(m.callback_urls).toEqual(["https://clawptcha.example.workers.dev/oauth/callback"]);
    expect(m.redirect_url).toBe("http://localhost:8976/callback");
  });

  it("requests exactly the permissions and events the Worker needs", () => {
    expect(m.default_permissions).toEqual({
      checks: "write",
      pull_requests: "write",
      contents: "read",
      metadata: "read",
    });
    expect(m.default_events).toEqual(["pull_request", "issue_comment", "installation"]);
    expect(m.public).toBe(false);
  });
});

describe("manifestFormHtml", () => {
  it("embeds the manifest JSON escaped and posts to github with the state", () => {
    const html = manifestFormHtml({ name: 'a"b<c&d' }, "state-123");
    expect(html).toContain('action="https://github.com/settings/apps/new?state=state-123"');
    expect(html).toContain('name="manifest"');
    // JSON is attribute-escaped: no raw quotes/angle brackets from values
    expect(html).toContain("&quot;a\\&quot;b&lt;c&amp;d&quot;");
    expect(html).toContain("method=\"post\"");
    expect(html).toContain("submit()");
  });
});

describe("parseDeployedUrl", () => {
  it("finds the workers.dev url in wrangler deploy output", () => {
    const out = "Uploaded clawptcha (3.2 sec)\nDeployed clawptcha triggers (1.1 sec)\n  https://clawptcha.someone.workers.dev\nCurrent Version ID: abc";
    expect(parseDeployedUrl(out)).toBe("https://clawptcha.someone.workers.dev");
  });
  it("returns null when absent", () => {
    expect(parseDeployedUrl("nothing here")).toBeNull();
  });
});

describe("patchAppBaseUrl", () => {
  const jsonc = `{
  // comment survives
  "vars": {
    "APP_BASE_URL": "https://clawptcha.example.workers.dev",
    "LLM_PROVIDER": "workers-ai"
  }
}`;
  it("replaces only the APP_BASE_URL value, preserving formatting", () => {
    const r = patchAppBaseUrl(jsonc, "https://real.workers.dev");
    expect(r.changed).toBe(true);
    expect(r.text).toContain('"APP_BASE_URL": "https://real.workers.dev"');
    expect(r.text).toContain("// comment survives");
    expect(r.text).toContain('"LLM_PROVIDER": "workers-ai"');
  });
  it("reports unchanged when the value already matches", () => {
    const r = patchAppBaseUrl(jsonc, "https://clawptcha.example.workers.dev");
    expect(r.changed).toBe(false);
    expect(r.text).toBe(jsonc);
  });
  it("throws when the key is missing", () => {
    expect(() => patchAppBaseUrl("{}", "https://x")).toThrow(/APP_BASE_URL/);
  });
});
