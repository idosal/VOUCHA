import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  createPasskeyAuthenticationOptions,
  createPasskeyRegistrationOptions,
  hasEstablishedPasskey,
} from "../src/webauthn";
import { getWebAuthnChallenge, saveWebAuthnCredential, type ChallengeSession } from "../src/store";
import type { Env } from "../src/types";

const testEnv = env as unknown as Env;

async function session(githubUserId: number | null): Promise<ChallengeSession> {
  const challengeId = `webauthn-ch-${githubUserId ?? "missing"}`;
  const sessionId = `webauthn-session-${githubUserId ?? "missing"}`;
  await testEnv.DB.prepare(
    `INSERT INTO challenges (id, installation_id, repo_full_name, pr_number, head_sha,
      author_login, status, config_json)
     VALUES (?, 1, 'o/r', 1, 'sha', 'alice', 'passed', '{}')`
  ).bind(challengeId).run();
  await testEnv.DB.prepare(
    `INSERT INTO sessions (id, challenge_id, gh_login, github_user_id)
     VALUES (?, ?, 'alice', ?)`
  ).bind(sessionId, challengeId, githubUserId).run();
  return {
    id: sessionId,
    challenge_id: challengeId,
    gh_login: "alice",
    github_user_id: githubUserId,
    verify_code: null,
    created_at: "2026-07-14T00:00:00.000Z",
  };
}

describe("privacy-preserving passkey fallback", () => {
  it("offers enrollment only to a session with a stable GitHub user id", async () => {
    const unstable = await session(null);
    await expect(createPasskeyRegistrationOptions(
      testEnv.DB,
      "https://voucha.dev",
      unstable,
      unstable.challenge_id
    )).rejects.toThrow("GitHub user id is not available");
  });

  it("creates user-verifying, no-attestation registration options and a short-lived challenge", async () => {
    const verified = await session(4242);
    const now = new Date("2026-07-14T10:00:00.000Z");
    const options = await createPasskeyRegistrationOptions(
      testEnv.DB,
      "https://voucha.dev",
      verified,
      verified.challenge_id,
      now
    );

    expect(options.rp).toEqual({ name: "VOUCHA", id: "voucha.dev" });
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "discouraged",
      userVerification: "required",
    });
    expect(options.pubKeyCredParams.map((parameter) => parameter.alg)).toEqual([-7, -257]);
    const stored = await getWebAuthnChallenge(
      testEnv.DB,
      verified.id,
      verified.challenge_id,
      "registration"
    );
    expect(stored?.challenge).toBe(options.challenge);
    expect(stored?.expires_at).toBe("2026-07-14T10:05:00.000Z");
  });

  it("does not offer confirmation without a previously enrolled credential", async () => {
    const verified = await session(4343);
    expect(await hasEstablishedPasskey(testEnv.DB, verified)).toBe(false);
    await expect(createPasskeyAuthenticationOptions(
      testEnv.DB,
      "https://voucha.dev",
      verified,
      verified.challenge_id
    )).resolves.toBeNull();
    expect(await getWebAuthnChallenge(
      testEnv.DB,
      verified.id,
      verified.challenge_id,
      "authentication"
    )).toBeNull();
  });

  it("scopes an authentication challenge to the established credential owner", async () => {
    const verified = await session(4444);
    await saveWebAuthnCredential(testEnv.DB, {
      id: "credential-id",
      github_user_id: 4444,
      public_key: "AA",
      counter: 0,
      transports_json: '["internal"]',
    });

    expect(await hasEstablishedPasskey(testEnv.DB, verified)).toBe(true);
    const options = await createPasskeyAuthenticationOptions(
      testEnv.DB,
      "https://voucha.dev",
      verified,
      verified.challenge_id,
      new Date("2026-07-14T11:00:00.000Z")
    );
    expect(options).not.toBeNull();
    expect(options?.rpId).toBe("voucha.dev");
    expect(options?.userVerification).toBe("required");
    expect(options?.allowCredentials).toEqual([
      { id: "credential-id", type: "public-key", transports: ["internal"] },
    ]);
    expect((await getWebAuthnChallenge(
      testEnv.DB,
      verified.id,
      verified.challenge_id,
      "authentication"
    ))?.expires_at).toBe("2026-07-14T11:05:00.000Z");
  });
});
