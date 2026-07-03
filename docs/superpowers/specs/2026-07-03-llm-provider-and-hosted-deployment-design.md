# Clawptcha — Pluggable LLM Provider & Cloudflare-Native Hosted Deployment

**Date:** 2026-07-03
**Status:** Approved

## Summary

Quiz generation is currently hardcoded to the Anthropic SDK
(`@anthropic-ai/sdk` constructed in `src/index.ts`, Anthropic-shaped
`LlmClient` interface in `src/quiz/generate.ts`). This spec replaces that with
a thin provider abstraction supporting three backends — Workers AI (binding),
Anthropic (direct HTTP), and any OpenAI-compatible endpoint — and defines the
hosted-instance deployment: an entirely-Cloudflare stack (Workers + D1 +
Turnstile + Workers AI running Kimi K2.7 Code), free for public repos, positioned for
end-to-end Cloudflare sponsorship (Project Alexandria for infra, a Workers AI
credit pitch on top).

**No backwards compatibility.** `CLAUDE_MODEL` and `ANTHROPIC_API_KEY` are
removed, not shimmed. This is v0.1.0 with one known deployment.

## Why

- **Adoption:** the ecosystem barbell is hosted-free-for-OSS (CodeRabbit) or
  self-hosted-BYO-endpoint (PR-Agent). This design serves both with one
  codebase: the hosted instance picks the model; self-hosters point
  `LLM_BASE_URL` anywhere.
- **Sponsorship:** a 100% Cloudflare stack is a single coherent pitch.
  Project Alexandria covers Workers/D1/Turnstile for OSS projects today;
  Workers AI credits are the ask once there are usage numbers. Meanwhile,
  Kimi K2.7 Code on Workers AI ($0.95/M in, $4.00/M out as of 2026-06, ~30%
  cheaper than GLM-5.2 on the input-heavy quiz workload) costs fractions of
  a cent per quiz — the unsponsored interim is coffee money.
- **Quality:** Workers AI now hosts near-frontier open coding models —
  Kimi K2.7 Code (added 2026-06-12, 256k context) and GLM-5.2 (added
  2026-06-16, 262k context; within ~1 point of Claude Opus 4.8 on
  FrontierSWE). Near-frontier diff comprehension no longer requires a
  frontier-lab API key. This is validated, not assumed — see Quality gate.
- **Default selection rule:** among models that pass the quality gate, the
  cheapest wins. As of writing that ordering is Kimi K2.7 Code → GLM-5.2 →
  claude-sonnet-5 (via `anthropic` provider).

## Design

### 1. Provider abstraction — `src/quiz/providers.ts` (new)

One neutral interface replaces `LlmClient`:

```ts
export interface QuizProvider {
  complete(params: {
    system: string;
    prompt: string;
    schema: object;      // QUIZ_JSON_SCHEMA
    maxTokens: number;
  }): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
}
```

Three implementations, all plain `fetch` or the `AI` binding. The
`@anthropic-ai/sdk` dependency is **removed** from package.json.

| Provider | Transport | Structured output | Auth |
|---|---|---|---|
| `workers-ai` | `env.AI.run(model, { messages, response_format }, { gateway })` | `response_format: { type: "json_schema", json_schema: QUIZ_JSON_SCHEMA }` | none (binding) |
| `anthropic` | `POST https://api.anthropic.com/v1/messages` | existing `output_config.format` json_schema | `x-api-key: LLM_API_KEY` |
| `openai-compat` | `POST ${LLM_BASE_URL}/chat/completions` | `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }` | `Authorization: Bearer LLM_API_KEY` |

Notes:

- Each provider maps its response to `{ ok, text }`; all error paths
  (non-2xx, missing content, network) map to `{ ok: false, error }` with a
  short human-readable reason. Provider errors must never throw out of
  `complete` — `generateQuiz` treats them as a failed attempt.
- `generateQuiz` in `src/quiz/generate.ts` keeps its exact current contract
  and logic (build prompt → call provider → `JSON.parse` → `validateQuiz` →
  retry once on any failure → `{ ok: false }` after 2 attempts). Only the
  client parameter type changes from `LlmClient` to `QuizProvider`. The
  Zod validation layer is the safety net for providers with loose
  json_schema enforcement.
- `workers-ai` passes an AI Gateway reference when `AI_GATEWAY_ID` is set
  (spend caps, analytics, logging; response caching stays off — every quiz
  prompt is unique).
- Reasoning effort: for models with thinking modes (Kimi K2.7 Code,
  GLM-5.2), use the fast/balanced setting, never the extended/"max" mode.
  Generation happens while the contributor waits on the challenge page;
  latency is part of quiz UX. Exact Workers AI model IDs and parameter
  names for reasoning effort and structured output are verified against
  the model docs during implementation (both models are June-2026 fresh).

### 2. Configuration & Env

`Env` in `src/types.ts`:

```ts
// removed
CLAUDE_MODEL: string;
ANTHROPIC_API_KEY: string;

// added
AI?: Ai;                                  // Workers AI binding (hosted path)
LLM_PROVIDER: "workers-ai" | "anthropic" | "openai-compat";
LLM_MODEL: string;                        // e.g. "@cf/moonshotai/kimi-k2.7-code", "claude-sonnet-5"
LLM_API_KEY?: string;                     // secret; unused for workers-ai
LLM_BASE_URL?: string;                    // openai-compat only
AI_GATEWAY_ID?: string;                   // optional, workers-ai only
```

- Provider selection happens once in `src/index.ts` where the Anthropic
  client is constructed today; misconfiguration (e.g. `workers-ai` without
  an `AI` binding, `openai-compat` without `LLM_BASE_URL`) produces a
  `{ ok: false }` generation result at challenge time — which resolves the
  check `neutral` per existing fail-open behavior — plus a clear log line.
  Startup cannot hard-fail a Worker; fail-open is already the product's
  documented posture for LLM outages.
- `wrangler.jsonc`: add `"ai": { "binding": "AI" }`; `vars` become
  `LLM_PROVIDER: "workers-ai"`, `LLM_MODEL: "@cf/moonshotai/kimi-k2.7-code"`
  (exact ID confirmed against the Workers AI catalog during implementation).
  Hosted secret count drops from 9 to 8 (no LLM key).
- README deploy runbook updated: hosted/default path needs no LLM secret;
  self-host BYO section documents all three providers with one example each.

### 3. Hosted deployment & sponsorship sequence

1. **Deploy hosted instance** on Workers with the `workers-ai` provider and
   Kimi K2.7 Code default (after the quality gate below passes). AI Gateway
   in front with a monthly spend cap.
2. **Policy, stated in README:** hosted instance is free for public repos.
   Private/commercial use self-hosts (BYO endpoint) — revisit if demand
   appears.
3. **Apply to Project Alexandria** (Cloudflare OSS program) for
   Workers/D1/plan credits. Prereqs from the adoption review must land
   first: LICENSE, public repo, CI.
4. **Pitch Workers AI inclusion** separately once there are usage numbers
   and a public "Clawptcha runs 100% on Cloudflare" write-up. Until then
   Workers AI runs at cost (sub-cent per quiz; negligible at any plausible
   early volume).

### 4. Quality gate (blocks flipping the hosted default)

Extend `scripts/localdev/local-quizgen.mts` with `--provider` / `--model`
(and the env vars above). Run ~10 real PR diffs of varied size/type through
Kimi K2.7 Code, GLM-5.2, and claude-sonnet-5 side by side; judge by hand
against three criteria per question: **grounded** (answerable from the
diff's purpose/effect), **unambiguous** (exactly one defensible correct
answer), **fair** (no implementation-detail trivia).

The hosted default is the **cheapest model indistinguishable from
claude-sonnet-5 on fairness**, evaluated in cost order:

1. Kimi K2.7 Code passes → default.
2. Else GLM-5.2 passes → default.
3. Else hosted default is `anthropic`/claude-sonnet-5 and the economics
   revert to "Alexandria for infra, eat ~1–5¢/quiz". Nothing else in this
   design changes — that is the point of the abstraction.

### 5. Testing

- `test/generate.test.ts`: existing logic tests (retry, validation,
  truncation) keep working against a mock `QuizProvider` — mechanical
  interface rename only.
- New `test/providers.test.ts`: per-provider request-shape tests with a
  mocked `fetch` / mocked `AI` binding. Assert per provider: URL, auth
  header placement, schema placement in the body, happy-path text
  extraction, and error mapping (non-2xx → `{ ok: false }`, never a throw).
- Config wiring test: each `LLM_PROVIDER` value selects the right provider;
  misconfiguration yields `{ ok: false }` (and thus `neutral`), not a crash.

## Out of scope

- Backwards compatibility with `CLAUDE_MODEL` / `ANTHROPIC_API_KEY` (explicit
  user decision).
- Per-diff model tiering (cheap model for small diffs, frontier for large).
- Billing/paid tiers for the hosted instance.
- Streaming, tool use, or any provider capability beyond a single structured
  completion.
