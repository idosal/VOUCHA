import type { ClawptchaConfig } from "../config";

export interface PrFacts {
  authorLogin: string;
  authorType: "User" | "Bot";
  authorAssociation: string; // GitHub author_association enum
  changedLines: number;      // additions + deletions
  changedFiles: string[];
}

export type ExemptionResult = { exempt: false } | { exempt: true; reason: string };

const MAINTAINER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

// Minimal glob subset: '**' matches zero or more whole path segments,
// '*' matches within a single segment. Everything else — including '?',
// '.', '(' — is a literal character. Implemented without regexes so
// maintainer-authored patterns can never trigger catastrophic backtracking.
export function matchesGlob(pattern: string, path: string): boolean {
  const pSegs = pattern.split("/");
  const fSegs = path.split("/");
  const memo = new Map<string, boolean>();
  const seg = (i: number, j: number): boolean => {
    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let res: boolean;
    if (i === pSegs.length) {
      res = j === fSegs.length;
    } else if (pSegs[i] === "**") {
      res = seg(i + 1, j) || (j < fSegs.length && seg(i, j + 1));
    } else {
      res = j < fSegs.length && segmentMatch(pSegs[i], fSegs[j]) && seg(i + 1, j + 1);
    }
    memo.set(key, res);
    return res;
  };
  return seg(0, 0);
}

// '*' wildcard within one segment; iterative two-pointer, linear time.
function segmentMatch(pat: string, s: string): boolean {
  let p = 0, i = 0, star = -1, mark = 0;
  while (i < s.length) {
    if (p < pat.length && pat[p] === s[i]) { p++; i++; }
    else if (p < pat.length && pat[p] === "*") { star = p; p++; mark = i; }
    else if (star >= 0) { p = star + 1; mark++; i = mark; }
    else return false;
  }
  while (p < pat.length && pat[p] === "*") p++;
  return p === pat.length;
}

export function evaluateExemption(pr: PrFacts, cfg: ClawptchaConfig): ExemptionResult {
  if (cfg.skip_bots && pr.authorType === "Bot") {
    return { exempt: true, reason: "bot author" };
  }
  // GitHub logins are case-insensitive, so compare without regard to case.
  if (cfg.skip_authors.some((a) => a.toLowerCase() === pr.authorLogin.toLowerCase())) {
    return { exempt: true, reason: "author in skip_authors" };
  }
  if (MAINTAINER_ASSOCIATIONS.has(pr.authorAssociation)) {
    return { exempt: true, reason: `maintainer (${pr.authorAssociation})` };
  }
  if (pr.changedLines < cfg.min_changed_lines) {
    return { exempt: true, reason: "diff below min_changed_lines" };
  }
  // Guard changedFiles.length > 0: .every() on an empty array is vacuously
  // true, which would otherwise auto-exempt PRs with no reported files.
  if (
    pr.changedFiles.length > 0 &&
    pr.changedFiles.every((f) => cfg.skip_paths.some((p) => matchesGlob(p, f)))
  ) {
    return { exempt: true, reason: "all changed files match skip_paths" };
  }
  return { exempt: false };
}
