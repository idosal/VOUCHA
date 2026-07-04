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
