const TURNSTILE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
]);

export const TURNSTILE_ACTION = "challenge_start";

export type TurnstileVerificationResult = "passed" | "failed" | "unavailable";

export interface TurnstileBinding {
  expectedCData: string;
  remoteIp?: string;
}

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export async function createTurnstileCData(
  signingKey: string,
  challengeId: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const value = `${TURNSTILE_ACTION}:${challengeId}`;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return `v1_${base64Url(new Uint8Array(signature))}`;
}

export function isTurnstileTestSiteKey(siteKey: string): boolean {
  return TURNSTILE_TEST_SITE_KEYS.has(siteKey.trim());
}

function isLocalUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function turnstileProductionConfigError(
  siteKey: string,
  requestUrl: string,
  appBaseUrl: string
): string | null {
  if (!isTurnstileTestSiteKey(siteKey)) return null;
  if (isLocalUrl(requestUrl) || isLocalUrl(appBaseUrl)) return null;
  return "Browser verification is configured with a Cloudflare testing site key. The operator needs to replace the production Turnstile widget credentials before this challenge can be taken.";
}

export async function verifyTurnstileToken(
  env: {
    APP_BASE_URL: string;
    TURNSTILE_SITE_KEY: string;
    TURNSTILE_SECRET_KEY: string;
  },
  token: string,
  binding: TurnstileBinding,
  fetchImpl: typeof fetch = fetch
): Promise<TurnstileVerificationResult> {
  if (!token.trim()) return "failed";
  try {
    const body: Record<string, string> = {
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
    };
    if (binding.remoteIp) body.remoteip = binding.remoteIp;
    const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return "unavailable";

    const result = await response.json() as {
      success?: boolean;
      hostname?: string;
      action?: string;
      cdata?: string;
      "error-codes"?: string[];
    };
    if (!result.success) {
      const invalidTokenCodes = new Set([
        "invalid-input-response",
        "missing-input-response",
        "timeout-or-duplicate",
      ]);
      return result["error-codes"]?.some((code) => invalidTokenCodes.has(code))
        ? "failed"
        : "unavailable";
    }

    // Cloudflare's dummy keys return synthetic hostname/action/cData values.
    // Production tokens must be bound to this exact app and challenge.
    if (!isTurnstileTestSiteKey(env.TURNSTILE_SITE_KEY)) {
      const expectedHostname = new URL(env.APP_BASE_URL).hostname;
      if (
        result.hostname !== expectedHostname ||
        result.action !== TURNSTILE_ACTION ||
        result.cdata !== binding.expectedCData
      ) return "failed";
    }
    return "passed";
  } catch (err) {
    console.error("Turnstile Siteverify request failed", err);
    return "unavailable";
  }
}
