import { describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_ACTION,
  createTurnstileCData,
  verifyTurnstileToken,
} from "../src/turnstile";

const productionEnv = {
  APP_BASE_URL: "https://voucha.dev",
  TURNSTILE_SITE_KEY: "0x4AAAA-production-site-key",
  TURNSTILE_SECRET_KEY: "production-secret",
};

describe("Turnstile challenge binding", () => {
  it("creates deterministic challenge-specific signed cData", async () => {
    const first = await createTurnstileCData("s".repeat(32), "challenge-one");
    expect(first).toMatch(/^v1_[A-Za-z0-9_-]{43}$/);
    expect(await createTurnstileCData("s".repeat(32), "challenge-one")).toBe(first);
    expect(await createTurnstileCData("s".repeat(32), "challenge-two")).not.toBe(first);
  });

  it("validates hostname, action, cData, and forwards the remote IP", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        secret: "production-secret",
        response: "browser-token",
        remoteip: "203.0.113.7",
      });
      return Response.json({
        success: true,
        hostname: "voucha.dev",
        action: TURNSTILE_ACTION,
        cdata: "v1_expected",
      });
    });

    await expect(verifyTurnstileToken(
      productionEnv,
      "browser-token",
      { expectedCData: "v1_expected", remoteIp: "203.0.113.7" },
      fetchMock
    )).resolves.toBe("passed");
  });

  it.each([
    ["hostname", { hostname: "attacker.example", action: TURNSTILE_ACTION, cdata: "v1_expected" }],
    ["action", { hostname: "voucha.dev", action: "other_action", cdata: "v1_expected" }],
    ["cData", { hostname: "voucha.dev", action: TURNSTILE_ACTION, cdata: "v1_other" }],
  ])("rejects a successful token with mismatched %s", async (_field, responseFields) => {
    const fetchMock = vi.fn(async () => Response.json({ success: true, ...responseFields }));
    await expect(verifyTurnstileToken(
      productionEnv,
      "browser-token",
      { expectedCData: "v1_expected" },
      fetchMock
    )).resolves.toBe("failed");
  });

  it("allows Cloudflare's documented dummy-key response fields in tests", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      success: true,
      hostname: "dummy-key-response.invalid",
      action: "dummy",
      cdata: "dummy",
    }));
    await expect(verifyTurnstileToken(
      { ...productionEnv, TURNSTILE_SITE_KEY: "1x00000000000000000000AA" },
      "browser-token",
      { expectedCData: "v1_expected" },
      fetchMock
    )).resolves.toBe("passed");
  });
});
