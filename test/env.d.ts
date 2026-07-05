import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
      GITHUB_APP_ID: string;
      GITHUB_PRIVATE_KEY: string;
      GITHUB_WEBHOOK_SECRET: string;
      GITHUB_OAUTH_CLIENT_ID: string;
      GITHUB_OAUTH_CLIENT_SECRET: string;
      LLM_PROVIDER: string;
      LLM_MODEL: string;
      LLM_API_KEY: string;
      TURNSTILE_SITE_KEY: string;
      TURNSTILE_SECRET_KEY: string;
      SESSION_SIGNING_KEY: string;
      APP_BASE_URL: string;
    }
  }
}

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
    GITHUB_APP_ID: string;
    GITHUB_PRIVATE_KEY: string;
    GITHUB_WEBHOOK_SECRET: string;
    GITHUB_OAUTH_CLIENT_ID: string;
    GITHUB_OAUTH_CLIENT_SECRET: string;
    LLM_PROVIDER: string;
    LLM_MODEL: string;
    LLM_API_KEY: string;
    TURNSTILE_SITE_KEY: string;
    TURNSTILE_SECRET_KEY: string;
    SESSION_SIGNING_KEY: string;
    APP_BASE_URL: string;
  }
}

export {};
