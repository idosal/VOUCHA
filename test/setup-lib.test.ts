import { describe, it, expect } from "vitest";
import { buildManifest, manifestFormHtml } from "../scripts/setup-lib.mts";

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
