import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Env, Challenge } from "./types";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyWebhookSignature } from "./github/webhook";
import { isRepoAllowed } from "./github/allowlist";
import { notifyEarlyAccess, shouldNotifyEarlyAccess } from "./github/early-access";
import { handlePullRequestEvent, handleIssueCommentEvent } from "./github/events";
import { apiForInstallation, onChallengeResolved, sweepStaleChallenges } from "./resolve";
import {
  getChallenge,
  getInvestigationByPr,
  getSession,
  insertVerificationSession,
  randomToken,
  setSessionVerifyCode,
  upsertInvestigation,
  type ChallengeSession,
} from "./store";
import { signSessionCookie, verifySessionCookie } from "./ui/session";
import {
  verificationPage,
  startPage,
  questionPage,
  resultPage,
  confirmationPage,
  errorPage,
  homePage,
  HONEYPOT_FIELD_NAME,
  type PageAction,
} from "./ui/pages";
import {
  confirmPendingChallenge,
  prepareQuizForChallenge,
  startQuizAttempt,
  submitAnswer,
  type ChallengeDeps,
  type PrContext,
} from "./challenge";
import { generateQuiz, generateQuizFromInvestigation } from "./quiz/generate";
import { redactForClient, type Quiz } from "./quiz/schema";
import {
  QUESTION_TIME_LIMIT_MS,
  questionRemainingMs,
} from "./quiz/grade";
import { getMultipleChoiceGate, hasHoneypotSignal, resolveConfig, type VouchaConfig } from "./config";
import { providerFromEnv, type QuizProvider } from "./quiz/providers";
import { matchesGlob } from "./policy/exemptions";
import { allowSessionCreation } from "./policy/ratelimit";
import { sameGitHubLogin } from "./github/login";
import { fetchPrContextForChallenge } from "./github/pr-context";
import { chooseInvestigatorSource, investigatePrWithFlue, type InvestigationSource } from "./flue/investigator";
import {
  createTurnstileCData,
  TURNSTILE_ACTION,
  turnstileProductionConfigError,
  verifyTurnstileToken,
} from "./turnstile";
import {
  createPasskeyAuthenticationOptions,
  createPasskeyRegistrationOptions,
  hasEstablishedPasskey,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "./webauthn";
import {
  investigatePr,
  investigationMode,
  validateInvestigationArtifact,
  type InvestigationArtifact,
} from "./quiz/investigate";

const app = new Hono<{ Bindings: Env }>();

async function docsAsset(c: Context<{ Bindings: Env }>): Promise<Response> {
  if (new URL(c.req.url).pathname === "/docs") return c.redirect("/docs/");
  if (!c.env.ASSETS) {
    return c.html(errorPage("Docs unavailable", "The Starlight documentation bundle is not available in this environment."), 503);
  }
  return c.env.ASSETS.fetch(c.req.raw);
}

async function staticAsset(c: Context<{ Bindings: Env }>): Promise<Response> {
  if (!c.env.ASSETS) return c.text("Asset unavailable", 503);
  return c.env.ASSETS.fetch(c.req.raw);
}

app.onError((err, c) => {
  console.error("unhandled route error", c.req.path, err);
  return c.html(
    errorPage(
      "Something went wrong",
      "Temporary problem on our side. Please try again in a minute. Your PR is not blocked by this error.",
      challengePathActions(c.req.path)
    ),
    500
  );
});

async function latestQuizResult(
  env: Env,
  challenge: Challenge,
  cfg: VouchaConfig
): Promise<{ score: number; total: number; finishedAt: string | null; failureReason?: string } | null> {
  const row = await env.DB.prepare(
    `SELECT score, questions_json, answers_json, telemetry_json, finished_at
     FROM quizzes
     WHERE challenge_id=? AND score IS NOT NULL
     ORDER BY retry_cycle DESC, attempt_number DESC
     LIMIT 1`
  ).bind(challenge.id).first<{
    score: number;
    questions_json: string;
    answers_json: string;
    telemetry_json: string;
    finished_at: string | null;
  }>();
  if (!row) return null;

  const gate = getMultipleChoiceGate(cfg);
  let total = gate.questions;
  try {
    const questions = (JSON.parse(row.questions_json) as Quiz).questions;
    if (questions.length > 0) total = questions.length;
  } catch { /* use policy default */ }

  try {
    const answers = JSON.parse(row.answers_json) as unknown[];
    if (answers.length > 0) total = answers.length;
  } catch { /* use question count */ }

  let failureReason: string | undefined;
  try {
    const telemetry = JSON.parse(row.telemetry_json || "{}") as { botFailureReason?: unknown };
    if (typeof telemetry.botFailureReason === "string") failureReason = telemetry.botFailureReason;
  } catch { /* no stored failure reason */ }

  return failureReason
    ? { score: row.score, total, finishedAt: row.finished_at, failureReason }
    : { score: row.score, total, finishedAt: row.finished_at };
}

function cooldownMessage(until: string): string {
  const retryAt = new Date(until);
  if (Number.isNaN(retryAt.getTime())) {
    return "Cooldown is active. Return to this link in a few minutes to retry with a fresh quiz.";
  }
  return `Cooldown is active until ${retryAt.toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })}. Return to this link to retry with a fresh quiz.`;
}

function githubPrUrl(challenge: Pick<Challenge, "repo_full_name" | "pr_number">): string {
  return `https://github.com/${challenge.repo_full_name}/pull/${challenge.pr_number}`;
}

function challengePageActions(challenge: Pick<Challenge, "id" | "repo_full_name" | "pr_number">): PageAction[] {
  return [
    { label: "Back to PR", href: githubPrUrl(challenge), primary: true, external: true },
    { label: "Refresh challenge", href: `/challenge/${challenge.id}` },
  ];
}

function retryChallengeActions(
  challenge: Pick<Challenge, "id" | "repo_full_name" | "pr_number">
): PageAction[] {
  return [
    { label: "Try again", href: `/challenge/${challenge.id}`, primary: true },
    { label: "Back to PR", href: githubPrUrl(challenge), external: true },
  ];
}

function terminalChallengeActions(
  challenge: Pick<Challenge, "repo_full_name" | "pr_number">,
  passed: boolean
): PageAction[] {
  return [{
    label: passed ? "View PR record" : "Back to PR",
    href: githubPrUrl(challenge),
    primary: true,
    external: true,
  }];
}

async function renderStartPage(
  c: Context<{ Bindings: Env }>,
  challenge: Challenge,
  cfg: VouchaConfig,
  startError = "",
  status: 200 | 400 = 200
): Promise<Response> {
  const turnstileError = turnstileProductionConfigError(
    c.env.TURNSTILE_SITE_KEY,
    c.req.url,
    c.env.APP_BASE_URL
  );
  if (turnstileError) {
    return c.html(errorPage(
      "VOUCHA unavailable",
      turnstileError,
      challengePageActions(challenge)
    ), 503);
  }
  const turnstileCData = await createTurnstileCData(c.env.SESSION_SIGNING_KEY, challenge.id);
  return c.html(startPage(
    `${challenge.repo_full_name}#${challenge.pr_number}`, c.env.TURNSTILE_SITE_KEY, challenge.id,
    hasHoneypotSignal(cfg), startError, {
      questions: getMultipleChoiceGate(cfg).questions,
      passThreshold: getMultipleChoiceGate(cfg).pass_threshold,
      secondsPerQuestion: QUESTION_TIME_LIMIT_MS / 1000,
      maxAttempts: cfg.max_attempts,
      attemptsUsed: challenge.attempts_used,
      cooldownMinutes: cfg.cooldown_minutes,
    },
    { action: TURNSTILE_ACTION, cData: turnstileCData }
  ), status);
}

function failedChallengeMessage(latest: { failureReason?: string } | null): string {
  const retry = "A maintainer can comment `/voucha retry` on the PR to start a fresh challenge for this commit.";
  if (latest?.failureReason) return `The challenge could not be verified: ${latest.failureReason} ${retry}`;
  return `Your attempts are exhausted. Repository policy controls whether maintainers review manually or VOUCHA closes the PR. ${retry}`;
}

function challengePathActions(path: string): PageAction[] {
  const match = /^\/challenge\/([^/]+)/.exec(path);
  if (!match) return [];
  return [{ label: "Return to challenge", href: `/challenge/${match[1]}`, primary: true }];
}

// ---------- webhooks ----------
app.post("/webhook", async (c) => {
  const body = await c.req.text();
  const ok = await verifyWebhookSignature(
    c.env.GITHUB_WEBHOOK_SECRET, body, c.req.header("x-hub-signature-256") ?? null
  );
  if (!ok) return c.text("bad signature", 401);

  const event = c.req.header("x-github-event");
  const payload = JSON.parse(body);
  // Respond 200 fast; do the work via waitUntil so GitHub doesn't time out.
  c.executionCtx.waitUntil((async () => {
    try {
      // Probe/ping payloads carry no installation — nothing to do.
      if (!payload.installation?.id) return;
      if (event === "installation" && payload.action === "created") {
        await c.env.DB.prepare("INSERT OR IGNORE INTO installations (id, account_login) VALUES (?, ?)")
          .bind(payload.installation.id, payload.installation.account.login).run();
        return;
      }
      // Temporary access gate. The installation.created record above is left
      // intact so the app can act immediately if the repo is later allowlisted.
      // For PR activity, leave one managed comment explaining the early-access
      // state instead of failing silently. Other event types remain no-ops.
      const repoFullName = payload.repository?.full_name as string | undefined;
      if (repoFullName && !isRepoAllowed(c.env.REPO_ALLOWLIST, repoFullName)) {
        if (event === "pull_request" && shouldNotifyEarlyAccess(payload)) {
          const api = await apiForInstallation(c.env, payload.installation.id);
          await notifyEarlyAccess(api, payload);
        }
        return;
      }

      const api = await apiForInstallation(c.env, payload.installation.id);
      if (event === "pull_request") await handlePullRequestEvent(c.env, api, payload);
      else if (event === "issue_comment") {
        await handleIssueCommentEvent(c.env, api, payload, {
          prepareQuiz: (challenge) => prepareQuizForChallenge(c.env, challengeDeps(c.env), challenge.id),
          confirmChallenge: (challenge, confirmer) => confirmPendingChallenge(
            c.env,
            challengeDeps(c.env),
            challenge.id,
            { method: "maintainer", by: confirmer }
          ),
        });
      }
    } catch (e) {
      console.error("webhook handling failed", event, e);
    }
  })());
  return c.text("ok");
});

// ---------- session helpers ----------
const SESSION_MAX_AGE_MS = 60 * 60_000;

function hasSubmittedHoneypot(form: Record<string, unknown>): boolean {
  const raw = form[HONEYPOT_FIELD_NAME];
  if (Array.isArray(raw)) return raw.some((value) => String(value ?? "").trim().length > 0);
  if (typeof raw === "string") return raw.trim().length > 0;
  return raw !== undefined && raw !== null;
}

function hasAcceptedChallengeTerms(form: Record<string, unknown>): boolean {
  const raw = form.terms_acceptance;
  if (Array.isArray(raw)) return raw.some((value) => value === "accepted");
  return raw === "accepted";
}

function pathIgnored(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(pattern, path));
}

function filterDiffByIgnoredPaths(diff: string, ignoredPaths: string[]): string {
  if (ignoredPaths.length === 0 || !diff.includes("diff --git ")) return diff;
  const blocks = diff.split(/(?=^diff --git )/m);
  return blocks.filter((block) => {
    const firstLine = block.split("\n", 1)[0] ?? "";
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(firstLine);
    const path = match?.[2] ?? match?.[1];
    return !path || !pathIgnored(path, ignoredPaths);
  }).join("");
}

function filterContextForGeneration(ctx: PrContext, cfg: VouchaConfig): PrContext {
  const ignoredPaths = cfg.context.ignore_paths;
  if (ignoredPaths.length === 0) return ctx;
  const filePatches = ctx.filePatches?.filter((file) => !pathIgnored(file.filename, ignoredPaths));
  const files = ctx.files.filter((file) => !pathIgnored(file, ignoredPaths));
  const changedLines = filePatches
    ? filePatches.reduce((sum, file) => sum + file.additions + file.deletions, 0)
    : ctx.changedLines;
  return {
    ...ctx,
    diff: filterDiffByIgnoredPaths(ctx.diff, ignoredPaths),
    files,
    filePatches,
    changedLines,
  };
}

async function currentSession(c: Context<{ Bindings: Env }>): Promise<ChallengeSession | null> {
  const cookie = getCookie(c, "voucha_session");
  if (!cookie) return null;
  const sessionId = await verifySessionCookie(c.env.SESSION_SIGNING_KEY, cookie);
  if (!sessionId) return null;
  const row = await getSession(c.env.DB, sessionId);
  if (!row) return null;
  // Sessions expire after 1 hour (matches the cookie max-age, enforced server-side).
  if (Date.now() - new Date(row.created_at).getTime() > SESSION_MAX_AGE_MS) return null;
  return row;
}

function newVerificationCode(): string {
  return randomToken(6);
}

async function createVerificationSession(
  c: Context<{ Bindings: Env }>,
  challengeId: string
): Promise<ChallengeSession> {
  const sessionId = randomToken();
  const verifyCode = newVerificationCode();
  await insertVerificationSession(c.env.DB, sessionId, challengeId, verifyCode);
  setCookie(c, "voucha_session", await signSessionCookie(c.env.SESSION_SIGNING_KEY, sessionId), {
    httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 3600,
  });
  return {
    id: sessionId,
    challenge_id: challengeId,
    gh_login: null,
    github_user_id: null,
    verify_code: verifyCode,
    created_at: new Date().toISOString(),
  };
}

async function ensureVerificationCode(
  env: Env,
  session: ChallengeSession
): Promise<string> {
  if (session.verify_code) return session.verify_code;
  const verifyCode = newVerificationCode();
  await setSessionVerifyCode(env.DB, session.id, verifyCode);
  return verifyCode;
}

export function challengeDeps(env: Env): ChallengeDeps {
  async function getOrCreateInvestigation(
    ctx: PrContext,
    cfg: VouchaConfig,
    provider: QuizProvider
  ): Promise<
    { ok: true; artifact: InvestigationArtifact; source: InvestigationSource; callsUsed: number }
    | { ok: false; error: string; source?: InvestigationSource; mode: InvestigationArtifact["mode"]; callsUsed: number }
  > {
    const mode = investigationMode(ctx, cfg);
    if (!ctx.repoFullName || !ctx.prNumber || !ctx.headSha) {
      return { ok: false, error: "missing PR cache key", mode, callsUsed: 0 };
    }
    const cached = await getInvestigationByPr(env.DB, ctx.repoFullName, ctx.prNumber, ctx.headSha);
    if (cached?.status === "ready") {
      try {
        const parsed = validateInvestigationArtifact(JSON.parse(cached.artifact_json), mode);
        if (parsed.ok) return { ok: true, artifact: parsed.artifact, source: cached.source, callsUsed: 0 };
      } catch { /* invalid cache, regenerate below */ }
    }

    const selected = chooseInvestigatorSource(env, cfg, ctx);
    if (!selected.ok) return { ...selected, callsUsed: 0 };

    const investigationAttempts = selected.source === "flue"
      ? 1
      : Math.max(1, Math.min(2, cfg.context.max_model_calls - 1));
    let result;
    if (selected.source === "flue") {
      result = await investigatePrWithFlue(env, ctx, cfg);
    } else {
      result = await investigatePr(provider, ctx, cfg, investigationAttempts);
    }

    await upsertInvestigation(env.DB, {
      id: cached?.id ?? randomToken(),
      repo_full_name: ctx.repoFullName,
      pr_number: ctx.prNumber,
      head_sha: ctx.headSha,
      source: selected.source,
      status: result.ok ? "ready" : "failed",
      artifact_json: result.ok ? JSON.stringify(result.artifact) : "{}",
      error: result.ok ? null : result.error,
    });
    return result.ok
      ? { ok: true, artifact: result.artifact, source: selected.source, callsUsed: investigationAttempts }
      : { ok: false, error: result.error, source: selected.source, mode, callsUsed: investigationAttempts };
  }

  return {
    now: () => new Date(),
    async fetchPrContext(ch: Challenge) {
      const api = await apiForInstallation(env, ch.installation_id);
      return fetchPrContextForChallenge(api, ch);
    },
    async generateQuiz(ctx, cfg) {
      ctx = filterContextForGeneration(ctx, cfg);
      const quizGate = getMultipleChoiceGate(cfg);
      const selected = providerFromEnv(env);
      if (!selected.ok) {
        // Misconfiguration degrades exactly like an LLM outage: failed
        // generation -> neutral check. Log loudly for the operator.
        console.error("LLM provider misconfigured:", selected.error);
        return { ok: false as const, error: selected.error };
      }
      if (cfg.context.strategy === "adaptive" && cfg.context.max_model_calls > 1) {
        const investigation = await getOrCreateInvestigation(ctx, cfg, selected.provider);
        if (investigation.ok) {
          const generationAttempts = Math.max(1, cfg.context.max_model_calls - investigation.callsUsed);
          return generateQuizFromInvestigation(
            selected.provider,
            investigation.artifact,
            ctx.title,
            ctx.body,
            ctx.files,
            quizGate.questions,
            generationAttempts,
            ctx.deltaBaseSha
          );
        }
        if (investigation.mode === "large_pr" || investigation.source === "flue") {
          console.error("PR investigation failed; not falling back for large/Flue investigation:", investigation.error);
          return { ok: false as const, error: investigation.error };
        }
        console.error("PR investigation failed; falling back to bounded direct quiz generation:", investigation.error);
        const fallbackAttempts = Math.max(1, cfg.context.max_model_calls - investigation.callsUsed);
        return generateQuiz(
          selected.provider,
          ctx.diff, ctx.title, ctx.body, ctx.files, cfg.max_context_tokens ?? cfg.context.detail_tokens,
          quizGate.questions,
          fallbackAttempts,
          ctx.deltaBaseSha
        );
      }
      return generateQuiz(
        selected.provider,
        ctx.diff, ctx.title, ctx.body, ctx.files, cfg.max_context_tokens,
        quizGate.questions,
        cfg.context.max_model_calls,
        ctx.deltaBaseSha
      );
    },
    async verifyTurnstile(token, binding) {
      return verifyTurnstileToken(env, token, binding);
    },
    async onChallengeResolved(r) {
      await onChallengeResolved(env, r);
    },
  };
}

// Challenge pages are personal attestations, not content for AI retrieval,
// search indexing, or agentic use. These are policy signals for compliant
// clients; the challenge still enforces its own author and browser checks.
app.use("/challenge/*", async (c, next) => {
  c.header("Content-Signal", "ai-train=yes, search=no, ai-input=no");
  c.header("X-Robots-Tag", "noindex, nofollow, nosnippet");
  await next();
});

// ---------- challenge pages ----------
app.get("/challenge/:id", async (c) => {
  const challenge = await getChallenge(c.env.DB, c.req.param("id"));
  if (!challenge) return c.html(errorPage("Not found", "This challenge link is invalid or expired."), 404);

  const cfg = resolveConfig(challenge.config_json);
  const gate = getMultipleChoiceGate(cfg);
  const latest = await latestQuizResult(c.env, challenge, cfg);

  if (challenge.status === "awaiting_approval") {
    return c.html(errorPage("Awaiting approval",
      "A maintainer must approve this challenge first (`/voucha approve` on the PR).",
      challengePageActions(challenge)));
  }
  if (challenge.status === "neutral") {
    return c.html(errorPage("VOUCHA unavailable",
      "The challenge could not be completed because of a VOUCHA-side problem. The PR should not be blocked. A maintainer can comment `/voucha retry` on the PR after the service recovers.",
      challengePageActions(challenge)));
  }
  if (challenge.status === "superseded") {
    return c.html(errorPage("Challenge no longer active",
      "This challenge is no longer active. A newer commit or outcome has replaced it. Check the PR for the current status.",
      challengePageActions(challenge)));
  }
  if (challenge.status === "passed") {
    const session = await currentSession(c);
    const offerPasskeyEnrollment = Boolean(
      cfg.confirmation.webauthn &&
      session?.gh_login &&
      session.challenge_id === challenge.id &&
      sameGitHubLogin(session.gh_login, challenge.author_login) &&
      session.github_user_id &&
      !(await hasEstablishedPasskey(c.env.DB, session))
    );
    return c.html(resultPage(
      true,
      latest?.score ?? gate.pass_threshold,
      latest?.total ?? gate.questions,
      "This challenge already passed. The PR check should be green and the attestation comment is on the PR.",
      terminalChallengeActions(challenge, true),
      {
        prRef: `${challenge.repo_full_name}#${challenge.pr_number}`,
        passThreshold: gate.pass_threshold,
        recordedAt: latest?.finishedAt ?? undefined,
        passkeyEnrollmentChallengeId: offerPasskeyEnrollment ? challenge.id : undefined,
      }
    ));
  }
  if (challenge.status === "awaiting_confirmation") {
    const session = await currentSession(c);
    const canUsePasskey = Boolean(
      cfg.confirmation.webauthn &&
      session?.gh_login &&
      sameGitHubLogin(session.gh_login, challenge.author_login) &&
      await hasEstablishedPasskey(c.env.DB, session)
    );
    return c.html(confirmationPage(
      challenge.id,
      `${challenge.repo_full_name}#${challenge.pr_number}`,
      latest?.score ?? gate.pass_threshold,
      latest?.total ?? gate.questions,
      canUsePasskey,
      cfg.confirmation.webauthn
    ));
  }
  if (challenge.status === "failed_assisted" || challenge.status === "failed_final") {
    return c.html(resultPage(
      false,
      latest?.score ?? 0,
      latest?.total ?? gate.questions,
      failedChallengeMessage(latest),
      terminalChallengeActions(challenge, false),
      {
        prRef: `${challenge.repo_full_name}#${challenge.pr_number}`,
        passThreshold: gate.pass_threshold,
        recordedAt: latest?.finishedAt ?? undefined,
        verificationFailure: challenge.status === "failed_assisted",
      }
    ));
  }
  if (challenge.status === "ready" && challenge.cooldown_until && new Date(challenge.cooldown_until).getTime() > Date.now()) {
    return c.html(resultPage(
      false,
      latest?.score ?? 0,
      latest?.total ?? gate.questions,
      cooldownMessage(challenge.cooldown_until),
      retryChallengeActions(challenge),
      {
        prRef: `${challenge.repo_full_name}#${challenge.pr_number}`,
        passThreshold: gate.pass_threshold,
        recordedAt: latest?.finishedAt ?? undefined,
        retryState: "cooldown",
      }
    ));
  }

  let session = await currentSession(c);
  if (!session || (!session.gh_login && session.challenge_id !== challenge.id)) {
    // Cookie-less visits mint a session row. Behind Cloudflare (cf-connecting-ip
    // present) cap this per IP so a public challenge URL can't be looped to grow
    // the sessions table; local/dev requests (no header) are not throttled.
    const clientIp = c.req.header("cf-connecting-ip");
    if (clientIp && !(await allowSessionCreation(c.env.DB, clientIp, new Date()))) {
      return c.html(errorPage("Too many requests",
        "Too many challenge sessions from your network right now. Wait a minute, then refresh this link.",
        challengePageActions(challenge)), 429);
    }
    session = await createVerificationSession(c, challenge.id);
  }
  if (!session.gh_login) {
    const verifyCode = await ensureVerificationCode(c.env, session);
    return c.html(verificationPage(
      `${challenge.repo_full_name}#${challenge.pr_number}`,
      challenge.author_login,
      challenge.id,
      verifyCode,
      `https://github.com/${challenge.repo_full_name}/pull/${challenge.pr_number}#issuecomment-new`
    ));
  }

  if (!sameGitHubLogin(session.gh_login, challenge.author_login)) {
    return c.html(errorPage("Not your challenge",
      `This challenge belongs to @${challenge.author_login}. You are signed in as @${session.gh_login}.`,
      challengePageActions(challenge)), 403);
  }
  // Only a `ready` challenge is takeable. Stale/closed states get an explanation
  // instead of the start page, so an author on an old link doesn't complete
  // Turnstile only to be rejected at submit time.
  if (challenge.status !== "ready") {
    return c.html(errorPage("Challenge no longer active",
      "This challenge is no longer active. A newer commit or outcome has replaced it. Check the PR for the current status.",
      challengePageActions(challenge)));
  }
  return renderStartPage(c, challenge, cfg);
});

app.post("/challenge/:id/verify", async (c) => {
  const challenge = await getChallenge(c.env.DB, c.req.param("id"));
  if (!challenge) return c.html(errorPage("Not found", "This challenge link is invalid or expired."), 404);
  // The "Check again" button lands here. Session creation happens only on
  // GET /challenge/:id, which gates on challenge state and rate-limits per IP —
  // so this just bounces back there instead of minting a session unconditionally
  // for any challenge id.
  return c.redirect(`/challenge/${challenge.id}`);
});

app.get("/challenge/:id/verify/status", async (c) => {
  const challenge = await getChallenge(c.env.DB, c.req.param("id"));
  const session = await currentSession(c);
  const verified = !!challenge &&
    !!session?.gh_login &&
    session.challenge_id === challenge.id &&
    sameGitHubLogin(session.gh_login, challenge.author_login);
  return c.json({ verified });
});

app.post("/challenge/:id/start", async (c) => {
  const session = await currentSession(c);
  if (!session?.gh_login) return c.redirect(`/challenge/${c.req.param("id")}`);
  const form = await c.req.parseBody();
  if (!hasAcceptedChallengeTerms(form)) {
    const challenge = await getChallenge(c.env.DB, c.req.param("id"));
    if (!challenge) return c.html(errorPage("Cannot start", "Challenge not found."), 404);
    if (!sameGitHubLogin(challenge.author_login, session.gh_login)) {
      return c.html(errorPage("Not your challenge",
        `This challenge belongs to @${challenge.author_login}. You are signed in as @${session.gh_login}.`,
        challengePageActions(challenge)), 403);
    }
    if (challenge.status !== "ready") {
      return c.html(errorPage("Challenge no longer active",
        "This challenge is not currently ready. Check the PR for the current gate state.",
        challengePageActions(challenge)), 409);
    }
    const cfg = resolveConfig(challenge.config_json);
    return renderStartPage(c, challenge, cfg, "Accept the challenge terms to begin.", 400);
  }
  const result = await startQuizAttempt(
    c.env, challengeDeps(c.env), c.req.param("id"),
    session.gh_login, String(form["cf-turnstile-response"] ?? ""),
    hasSubmittedHoneypot(form),
    c.req.header("cf-connecting-ip")
  );
  if (!result.ok) {
    if (result.error === "turnstile_missing") {
      const challenge = await getChallenge(c.env.DB, c.req.param("id"));
      if (!challenge) return c.html(errorPage("Cannot start", "Challenge not found."), 404);
      return renderStartPage(
        c, challenge, resolveConfig(challenge.config_json),
        "Complete browser verification before starting the challenge.", 400
      );
    }
    if (result.error === "bot_detected") return c.redirect(`/challenge/${c.req.param("id")}`);
    const messages: Record<string, string> = {
      not_ready: "This challenge isn't ready (awaiting approval or already resolved).",
      cooldown: "Cooldown in effect. Try again in a few minutes. You'll get a fresh quiz.",
      attempts_exhausted: "No attempts remain. The PR check is failed; repository policy controls manual review or auto-close.",
      attempt_preparing: "This attempt is already being prepared. Wait a moment, then return to the challenge.",
      rate_limited: "Rate limit reached. Try again later.",
      generation_failed: "We couldn't generate the quiz from this PR right now. This is a VOUCHA-side generation problem, so the check has been marked neutral and you're not blocked.",
      turnstile_unavailable: "Browser verification is misconfigured or unavailable. This is a VOUCHA-side problem, so the check has been marked neutral and you're not blocked.",
      not_author: "Only the PR author can take this challenge.",
      not_found: "Challenge not found.",
    };
    return c.html(errorPage("Cannot start", messages[result.error] ?? result.error),
      result.error === "not_found" ? 404 : 409);
  }
  // Store active quiz id on the session row to route question/answer requests.
  await c.env.DB.prepare("UPDATE sessions SET challenge_id=? WHERE id=?")
    .bind(c.req.param("id"), session.id).run();
  setCookie(c, "voucha_quiz", result.quizId, {
    httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 3600,
  });
  return c.redirect(`/challenge/${c.req.param("id")}/question`);
});

app.get("/challenge/:id/question", async (c) => {
  const session = await currentSession(c);
  const quizId = getCookie(c, "voucha_quiz");
  if (!session?.gh_login || !quizId) return c.redirect(`/challenge/${c.req.param("id")}`);
  const quiz = await c.env.DB.prepare(
    `SELECT q.challenge_id, q.state, q.questions_json, q.current_question, q.finished_at, q.question_served_at,
       q.time_limit_ms, ch.status, ch.author_login, ch.config_json, ch.repo_full_name, ch.pr_number
     FROM quizzes q JOIN challenges ch ON ch.id = q.challenge_id WHERE q.id=?`
  ).bind(quizId).first<{
    challenge_id: string; state: string; status: Challenge["status"];
    questions_json: string; current_question: number; finished_at: string | null;
    question_served_at: string | null; time_limit_ms: number;
    author_login: string; config_json: string; repo_full_name: string; pr_number: number;
  }>();
  // The quiz cookie is a capability token, but still bind it to the signed-in
  // author — a leaked/transplanted cookie must not expose questions to others.
  if (
    !quiz ||
    quiz.challenge_id !== c.req.param("id") ||
    quiz.state !== "active" ||
    quiz.status !== "ready" ||
    quiz.finished_at ||
    !sameGitHubLogin(quiz.author_login, session.gh_login)
  ) {
    return c.redirect(`/challenge/${c.req.param("id")}`);
  }
  const questions = (JSON.parse(quiz.questions_json) as Quiz).questions;
  const q = questions[quiz.current_question];
  if (!q) return c.redirect(`/challenge/${c.req.param("id")}`);
  // Stamp served_at on first render, then read it back so refreshes and parallel
  // tabs share one server-authoritative deadline.
  const now = new Date();
  await c.env.DB.prepare(
    "UPDATE quizzes SET question_served_at=COALESCE(question_served_at, ?) WHERE id=? AND state='active'"
  ).bind(now.toISOString(), quizId).run();
  const timing = await c.env.DB.prepare(
    "SELECT question_served_at, time_limit_ms FROM quizzes WHERE id=?"
  ).bind(quizId).first<{ question_served_at: string | null; time_limit_ms: number }>();
  if (!timing?.question_served_at) return c.redirect(`/challenge/${c.req.param("id")}`);
  const remainingTimeMs = questionRemainingMs(
    timing.question_served_at,
    now,
    timing.time_limit_ms
  );
  return c.html(questionPage(
    c.req.param("id"), quiz.current_question, questions.length,
    redactForClient(q), remainingTimeMs,
    hasHoneypotSignal(resolveConfig(quiz.config_json)), {
      totalTimeMs: timing.time_limit_ms,
      prRef: `${quiz.repo_full_name}#${quiz.pr_number}`,
      prUrl: `${githubPrUrl(quiz)}/files`,
    }
  ));
});

app.post("/challenge/:id/answer", async (c) => {
  const session = await currentSession(c);
  const quizId = getCookie(c, "voucha_quiz");
  if (!session?.gh_login || !quizId) return c.redirect(`/challenge/${c.req.param("id")}`);
  // Same author binding as the question route: only the challenge author's
  // session may submit answers for this quiz.
  const owner = await c.env.DB.prepare(
    `SELECT q.challenge_id, q.state, ch.status, ch.author_login
     FROM quizzes q JOIN challenges ch ON ch.id = q.challenge_id WHERE q.id=?`
  ).bind(quizId).first<{
    challenge_id: string;
    state: string;
    status: Challenge["status"];
    author_login: string;
  }>();
  if (
    !owner ||
    owner.challenge_id !== c.req.param("id") ||
    owner.state !== "active" ||
    owner.status !== "ready" ||
    !sameGitHubLogin(owner.author_login, session.gh_login)
  ) {
    return c.redirect(`/challenge/${c.req.param("id")}`);
  }
  const form = await c.req.parseBody({ all: true });
  const raw = form["answer"];
  const answer = (Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [])
    .map((v) => parseInt(String(v), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 3);
  // Hidden `qi` field says which question this answer targets; a stale or
  // missing index makes submitAnswer re-render the current question.
  const qiRaw = form["qi"];
  const qi = parseInt(String(Array.isArray(qiRaw) ? qiRaw[0] : qiRaw ?? ""), 10);
  const questionIndex = Number.isNaN(qi) ? -1 : qi;
  const telemetryRaw = form["telemetry"];
  const result = await submitAnswer(
    c.env, challengeDeps(c.env), quizId, questionIndex, answer,
    String((Array.isArray(telemetryRaw) ? telemetryRaw[0] : telemetryRaw) ?? ""),
    hasSubmittedHoneypot(form)
  );
  if ("error" in result) return c.redirect(`/challenge/${c.req.param("id")}`);
  if (!result.done) return c.redirect(`/challenge/${c.req.param("id")}/question`);
  if ("confirmationRequired" in result) {
    const challenge = await getChallenge(c.env.DB, c.req.param("id"));
    const webauthnEnabled = Boolean(
      challenge && resolveConfig(challenge.config_json).confirmation.webauthn
    );
    const canUsePasskey = webauthnEnabled && await hasEstablishedPasskey(c.env.DB, session);
    return c.html(confirmationPage(
      c.req.param("id"),
      challenge ? `${challenge.repo_full_name}#${challenge.pr_number}` : "this pull request",
      result.score,
      result.total,
      canUsePasskey,
      webauthnEnabled
    ));
  }
  const challenge = await getChallenge(c.env.DB, c.req.param("id"));
  const cfg = challenge ? resolveConfig(challenge.config_json) : null;
  const retryable = Boolean(
    challenge && cfg && !result.passed && !result.failureReason && challenge.status === "ready"
  );
  const retryState = retryable
    ? challenge?.cooldown_until && new Date(challenge.cooldown_until).getTime() > Date.now()
      ? "cooldown" as const
      : "immediate" as const
    : undefined;
  const offerPasskeyEnrollment = result.passed &&
    Boolean(cfg?.confirmation.webauthn) &&
    Boolean(session.github_user_id) &&
    !(await hasEstablishedPasskey(c.env.DB, session));
  const resultOptions = challenge && cfg ? {
    prRef: `${challenge.repo_full_name}#${challenge.pr_number}`,
    passThreshold: getMultipleChoiceGate(cfg).pass_threshold,
    recordedAt: new Date().toISOString(),
    verificationFailure: !result.passed && Boolean(result.failureReason),
    retryState,
    passkeyEnrollmentChallengeId: offerPasskeyEnrollment ? challenge.id : undefined,
  } : undefined;
  return c.html(resultPage(
    result.passed, result.score, result.total,
    result.passed
      ? "The check is now green and an attestation was posted to the PR."
      : result.failureReason
        ? `The challenge could not be verified: ${result.failureReason} Repository policy controls manual review or auto-close.`
        : retryState === "immediate"
          ? "You can retry immediately with a fresh quiz."
          : retryState === "cooldown" && challenge?.cooldown_until
            ? cooldownMessage(challenge.cooldown_until)
            : "Your attempts are exhausted. A maintainer can review or reset the challenge from the PR.",
    challenge
      ? retryable
        ? retryChallengeActions(challenge)
        : terminalChallengeActions(challenge, result.passed)
      : challengePathActions(c.req.path),
    resultOptions
  ));
});

async function passkeyRouteContext(
  c: Context<{ Bindings: Env }>,
  allowedStatus: "passed" | "awaiting_confirmation"
): Promise<{ challenge: Challenge; session: ChallengeSession } | null> {
  const challengeId = c.req.param("id");
  if (!challengeId) return null;
  const [challenge, session] = await Promise.all([
    getChallenge(c.env.DB, challengeId),
    currentSession(c),
  ]);
  if (
    !challenge ||
    challenge.status !== allowedStatus ||
    !resolveConfig(challenge.config_json).confirmation.webauthn ||
    !session?.gh_login ||
    session.challenge_id !== challenge.id ||
    !sameGitHubLogin(session.gh_login, challenge.author_login)
  ) return null;
  const requestOrigin = c.req.header("origin");
  if (requestOrigin !== new URL(c.env.APP_BASE_URL).origin) return null;
  return { challenge, session };
}

app.post("/challenge/:id/passkey/register/options", async (c) => {
  const context = await passkeyRouteContext(c, "passed");
  if (!context?.session.github_user_id) return c.json({ error: "not_available" }, 403);
  try {
    const options = await createPasskeyRegistrationOptions(
      c.env.DB,
      c.env.APP_BASE_URL,
      context.session,
      context.challenge.id
    );
    c.header("Cache-Control", "no-store");
    return c.json(options);
  } catch {
    return c.json({ error: "not_available" }, 400);
  }
});

app.post("/challenge/:id/passkey/register/verify", async (c) => {
  const context = await passkeyRouteContext(c, "passed");
  if (!context?.session.github_user_id) return c.json({ verified: false }, 403);
  try {
    const verified = await verifyPasskeyRegistration(
      c.env.DB,
      c.env.APP_BASE_URL,
      context.session,
      context.challenge.id,
      await c.req.json<RegistrationResponseJSON>()
    );
    c.header("Cache-Control", "no-store");
    return c.json({ verified }, verified ? 200 : 400);
  } catch {
    return c.json({ verified: false }, 400);
  }
});

app.post("/challenge/:id/passkey/authenticate/options", async (c) => {
  const context = await passkeyRouteContext(c, "awaiting_confirmation");
  if (!context?.session.github_user_id) return c.json({ error: "not_available" }, 403);
  const options = await createPasskeyAuthenticationOptions(
    c.env.DB,
    c.env.APP_BASE_URL,
    context.session,
    context.challenge.id
  );
  if (!options) return c.json({ error: "no_established_passkey" }, 409);
  c.header("Cache-Control", "no-store");
  return c.json(options);
});

app.post("/challenge/:id/passkey/authenticate/verify", async (c) => {
  const context = await passkeyRouteContext(c, "awaiting_confirmation");
  if (!context?.session.github_user_id) return c.json({ verified: false }, 403);
  try {
    const verified = await verifyPasskeyAuthentication(
      c.env.DB,
      c.env.APP_BASE_URL,
      context.session,
      context.challenge.id,
      await c.req.json<AuthenticationResponseJSON>()
    );
    if (!verified) return c.json({ verified: false }, 400);
    const confirmed = await confirmPendingChallenge(
      c.env,
      challengeDeps(c.env),
      context.challenge.id,
      { method: "passkey", by: context.session.gh_login! }
    );
    c.header("Cache-Control", "no-store");
    return c.json({ verified: confirmed }, confirmed ? 200 : 409);
  } catch {
    return c.json({ verified: false }, 400);
  }
});

app.get("/", (c) => c.html(homePage(new URL(c.req.url).origin)));
app.get("/apple-touch-icon.png", staticAsset);
app.get("/apple-touch-icon-dark.png", staticAsset);
app.get("/voucha-logo-dark.svg", staticAsset);
app.get("/voucha-logo-imagegen-v5.png", staticAsset);
app.get("/voucha-logo.svg", staticAsset);
app.get("/voucha-social-card.png", staticAsset);
app.get("/favicon-32x32.png", staticAsset);
app.get("/favicon-dark-32x32.png", staticAsset);
app.get("/favicon-dark.svg", staticAsset);
app.get("/favicon.svg", staticAsset);
app.get("/docs", docsAsset);
app.get("/docs/*", docsAsset);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sweepStaleChallenges(env, new Date()));
  },
};
