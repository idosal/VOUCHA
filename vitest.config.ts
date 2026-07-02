import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            GITHUB_APP_ID: "12345",
            GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
            GITHUB_OAUTH_CLIENT_ID: "test-client-id",
            GITHUB_OAUTH_CLIENT_SECRET: "test-client-secret",
            ANTHROPIC_API_KEY: "test-anthropic-key",
            TURNSTILE_SITE_KEY: "test-site-key",
            TURNSTILE_SECRET_KEY: "test-turnstile-secret",
            SESSION_SIGNING_KEY: "0123456789abcdef0123456789abcdef",
            GITHUB_PRIVATE_KEY: ""
          }
        }
      }
    }
  }
});
