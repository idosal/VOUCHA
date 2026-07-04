// Pure helpers for scripts/setup.mts — no I/O, no prompts, unit-tested in
// test/setup-lib.test.ts. Keep side effects in setup.mts.

export interface ManifestInput {
  appName: string;
  baseUrl: string;      // deployed Worker origin, no trailing slash
  redirectUrl: string;  // localhost callback that receives ?code=
}

export function buildManifest(i: ManifestInput) {
  return {
    name: i.appName,
    url: i.baseUrl,
    hook_attributes: { url: `${i.baseUrl}/webhook` },
    redirect_url: i.redirectUrl,
    callback_urls: [`${i.baseUrl}/oauth/callback`],
    public: false,
    default_permissions: {
      checks: "write",
      pull_requests: "write",
      contents: "read",
      metadata: "read",
    },
    default_events: ["pull_request", "issue_comment", "installation"],
  };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Auto-submitting form: the GitHub manifest flow requires POSTing a `manifest`
// form field to github.com/settings/apps/new (a plain link can't do it).
export function manifestFormHtml(manifest: object, state: string): string {
  const json = escapeAttr(JSON.stringify(manifest));
  return `<!doctype html>
<html><body>
  <p>Redirecting to GitHub to create the Clawptcha app…</p>
  <form id="f" action="https://github.com/settings/apps/new?state=${encodeURIComponent(state)}" method="post">
    <input type="hidden" name="manifest" value="${json}">
    <noscript><button type="submit">Continue to GitHub</button></noscript>
  </form>
  <script>document.getElementById("f").submit()</script>
</body></html>`;
}

export function parseDeployedUrl(wranglerOutput: string): string | null {
  const m = wranglerOutput.match(/https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev/i);
  return m ? m[0] : null;
}

// Targeted string edit so JSONC comments and formatting survive (a JSON
// parse/re-stringify would destroy them).
export function patchAppBaseUrl(jsonc: string, newUrl: string): { text: string; changed: boolean } {
  const re = /("APP_BASE_URL"\s*:\s*")([^"]*)(")/;
  const m = jsonc.match(re);
  if (!m) throw new Error("APP_BASE_URL not found in wrangler.jsonc");
  if (m[2] === newUrl) return { text: jsonc, changed: false };
  return { text: jsonc.replace(re, `$1${newUrl}$3`), changed: true };
}
