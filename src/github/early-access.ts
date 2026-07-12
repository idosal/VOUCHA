import type { GitHubApi } from "./api";

const NOTICE_ACTIONS = new Set(["opened", "reopened", "ready_for_review", "synchronize"]);

export function earlyAccessNotice(): string {
  return [
    "## VOUCHA",
    "",
    "VOUCHA is currently in early access and is not enabled for this repository yet.",
    "",
    "To request access, contact @idosal.",
    "",
    "_VOUCHA has not added a comprehension check to this PR._",
  ].join("\n");
}

export function shouldNotifyEarlyAccess(payload: any): boolean {
  if (!NOTICE_ACTIONS.has(String(payload.action ?? ""))) return false;
  return typeof payload.repository?.full_name === "string"
    && typeof payload.pull_request?.number === "number";
}

export async function notifyEarlyAccess(
  api: Pick<GitHubApi, "upsertPrComment">,
  payload: any
): Promise<boolean> {
  if (!shouldNotifyEarlyAccess(payload)) return false;

  await api.upsertPrComment(
    payload.repository.full_name as string,
    payload.pull_request.number as number,
    earlyAccessNotice()
  );
  return true;
}
