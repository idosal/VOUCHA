import { describe, expect, it, vi } from "vitest";
import {
  earlyAccessNotice,
  notifyEarlyAccess,
  shouldNotifyEarlyAccess,
} from "../src/github/early-access";

describe("early-access notice", () => {
  it("explains the access state and how to contact the operator", () => {
    const notice = earlyAccessNotice();
    expect(notice).toContain("currently in early access");
    expect(notice).toContain("not enabled for this repository yet");
    expect(notice).toContain("contact @idosal");
    expect(notice).toContain("has not added a comprehension check to this PR");
  });

  it("upserts one managed notice for supported PR activity", async () => {
    const upsertPrComment = vi.fn(async () => {});
    const posted = await notifyEarlyAccess(
      { upsertPrComment },
      {
        action: "opened",
        repository: { full_name: "someone/repo" },
        pull_request: { number: 42 },
      }
    );

    expect(posted).toBe(true);
    expect(upsertPrComment).toHaveBeenCalledOnce();
    expect(upsertPrComment).toHaveBeenCalledWith("someone/repo", 42, earlyAccessNotice());
  });

  it("does not post for unrelated pull-request actions", async () => {
    const upsertPrComment = vi.fn(async () => {});
    const posted = await notifyEarlyAccess(
      { upsertPrComment },
      {
        action: "closed",
        repository: { full_name: "someone/repo" },
        pull_request: { number: 42 },
      }
    );

    expect(posted).toBe(false);
    expect(shouldNotifyEarlyAccess({ action: "closed" })).toBe(false);
    expect(upsertPrComment).not.toHaveBeenCalled();
  });
});
