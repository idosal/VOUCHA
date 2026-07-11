import type { VouchaConfig } from "../config";

export type VouchStatus = "vouched" | "denounced" | "unknown";

export interface VouchTrustFacts {
  repo: string;
  authorLogin: string;
  baseRef: string;
}

export interface VouchTrustDeps {
  getFileContent(repo: string, path: string, ref: string): Promise<string | null>;
}

export type VouchTrustResult =
  | { status: "unknown" }
  | { status: "vouched" | "denounced"; file: string };

export function parseVouchStatus(content: string, authorLogin: string): VouchStatus {
  const target = authorLogin.trim().toLowerCase();
  if (!target) return "unknown";

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const denounced = line.startsWith("-");
    const entry = denounced ? line.slice(1).trimStart() : line;
    const handle = entry.split(/\s+/, 1)[0]?.toLowerCase();
    if (!handle) continue;

    const separator = handle.indexOf(":");
    const platform = separator === -1 ? "github" : handle.slice(0, separator);
    const username = separator === -1 ? handle : handle.slice(separator + 1);
    if (platform !== "github" || username !== target) continue;

    return denounced ? "denounced" : "vouched";
  }

  return "unknown";
}

export async function evaluateVouchTrust(
  facts: VouchTrustFacts,
  cfg: VouchaConfig,
  deps: VouchTrustDeps
): Promise<VouchTrustResult> {
  const policy = cfg.trust.vouch;
  if (!policy.enabled) return { status: "unknown" };

  try {
    const content = await deps.getFileContent(facts.repo, policy.file, facts.baseRef);
    if (content === null) return { status: "unknown" };
    const status = parseVouchStatus(content, facts.authorLogin);
    return status === "unknown" ? { status } : { status, file: policy.file };
  } catch {
    return { status: "unknown" };
  }
}
