import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import type { ChallengeSession } from "./store";
import {
  consumeWebAuthnChallenge,
  getWebAuthnChallenge,
  getWebAuthnCredential,
  getWebAuthnCredentials,
  putWebAuthnChallenge,
  saveWebAuthnCredential,
  updateWebAuthnCounter,
} from "./store";

const CEREMONY_TTL_MS = 5 * 60_000;
const SUPPORTED_ALGORITHMS = [-7, -257] as const;
const VALID_TRANSPORTS = new Set<AuthenticatorTransportFuture>([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

function rpConfig(appBaseUrl: string): { rpID: string; origin: string } {
  const url = new URL(appBaseUrl);
  return { rpID: url.hostname, origin: url.origin };
}

function transports(raw: string): AuthenticatorTransportFuture[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is AuthenticatorTransportFuture =>
        typeof value === "string" && VALID_TRANSPORTS.has(value as AuthenticatorTransportFuture))
      : [];
  } catch {
    return [];
  }
}

function requireStableUser(session: ChallengeSession): number {
  if (!session.github_user_id) throw new Error("GitHub user id is not available for this session");
  return session.github_user_id;
}

export async function hasEstablishedPasskey(
  db: D1Database,
  session: ChallengeSession
): Promise<boolean> {
  if (!session.github_user_id) return false;
  return (await getWebAuthnCredentials(db, session.github_user_id)).length > 0;
}

export async function createPasskeyRegistrationOptions(
  db: D1Database,
  appBaseUrl: string,
  session: ChallengeSession,
  challengeId: string,
  now = new Date()
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const githubUserId = requireStableUser(session);
  const { rpID } = rpConfig(appBaseUrl);
  const credentials = await getWebAuthnCredentials(db, githubUserId);
  const options = await generateRegistrationOptions({
    rpName: "VOUCHA",
    rpID,
    userID: isoUint8Array.fromUTF8String(`github:${githubUserId}`),
    userName: `github-${githubUserId}`,
    userDisplayName: "GitHub contributor",
    attestationType: "none",
    supportedAlgorithmIDs: [...SUPPORTED_ALGORITHMS],
    excludeCredentials: credentials.map((credential) => ({
      id: credential.id,
      transports: transports(credential.transports_json),
    })),
    authenticatorSelection: {
      residentKey: "discouraged",
      userVerification: "required",
    },
  });
  await putWebAuthnChallenge(db, {
    session_id: session.id,
    challenge_id: challengeId,
    ceremony: "registration",
    challenge: options.challenge,
    expires_at: new Date(now.getTime() + CEREMONY_TTL_MS).toISOString(),
  });
  return options;
}

export async function verifyPasskeyRegistration(
  db: D1Database,
  appBaseUrl: string,
  session: ChallengeSession,
  challengeId: string,
  response: RegistrationResponseJSON,
  now = new Date()
): Promise<boolean> {
  const githubUserId = requireStableUser(session);
  const stored = await getWebAuthnChallenge(db, session.id, challengeId, "registration");
  if (!stored || new Date(stored.expires_at).getTime() < now.getTime()) return false;
  const { rpID, origin } = rpConfig(appBaseUrl);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: stored.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    supportedAlgorithmIDs: [...SUPPORTED_ALGORITHMS],
  });
  if (!verification.verified || !verification.registrationInfo.userVerified) return false;
  if (!(await consumeWebAuthnChallenge(db, stored))) return false;

  const credential = verification.registrationInfo.credential;
  await saveWebAuthnCredential(db, {
    id: credential.id,
    github_user_id: githubUserId,
    public_key: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports_json: JSON.stringify(response.response.transports ?? []),
  });
  return true;
}

export async function createPasskeyAuthenticationOptions(
  db: D1Database,
  appBaseUrl: string,
  session: ChallengeSession,
  challengeId: string,
  now = new Date()
): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const githubUserId = requireStableUser(session);
  const credentials = await getWebAuthnCredentials(db, githubUserId);
  if (credentials.length === 0) return null;
  const { rpID } = rpConfig(appBaseUrl);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: credentials.map((credential) => ({
      id: credential.id,
      transports: transports(credential.transports_json),
    })),
  });
  await putWebAuthnChallenge(db, {
    session_id: session.id,
    challenge_id: challengeId,
    ceremony: "authentication",
    challenge: options.challenge,
    expires_at: new Date(now.getTime() + CEREMONY_TTL_MS).toISOString(),
  });
  return options;
}

export async function verifyPasskeyAuthentication(
  db: D1Database,
  appBaseUrl: string,
  session: ChallengeSession,
  challengeId: string,
  response: AuthenticationResponseJSON,
  now = new Date()
): Promise<boolean> {
  const githubUserId = requireStableUser(session);
  const [stored, credential] = await Promise.all([
    getWebAuthnChallenge(db, session.id, challengeId, "authentication"),
    getWebAuthnCredential(db, githubUserId, response.id),
  ]);
  if (!stored || !credential || new Date(stored.expires_at).getTime() < now.getTime()) return false;
  const { rpID, origin } = rpConfig(appBaseUrl);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: stored.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: credential.id,
      publicKey: isoBase64URL.toBuffer(credential.public_key),
      counter: credential.counter,
      transports: transports(credential.transports_json),
    },
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.authenticationInfo.userVerified) return false;
  if (!(await consumeWebAuthnChallenge(db, stored))) return false;
  await updateWebAuthnCounter(
    db,
    githubUserId,
    credential.id,
    verification.authenticationInfo.newCounter
  );
  return true;
}
