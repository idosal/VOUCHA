import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              GITHUB_APP_ID: "12345",
              GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
              GITHUB_OAUTH_CLIENT_ID: "test-client-id",
              GITHUB_OAUTH_CLIENT_SECRET: "test-client-secret",
              LLM_PROVIDER: "anthropic",
              LLM_MODEL: "test-model",
              LLM_API_KEY: "test-llm-key",
              TURNSTILE_SITE_KEY: "test-site-key",
              TURNSTILE_SECRET_KEY: "test-turnstile-secret",
              SESSION_SIGNING_KEY: "0123456789abcdef0123456789abcdef",
              GITHUB_PRIVATE_KEY: ""
            }
          }
        }
      }
    }
  };
});
