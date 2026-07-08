export function normalizeGitHubLogin(login: string): string {
  return login.trim().toLowerCase();
}

export function sameGitHubLogin(a: string, b: string): boolean {
  return normalizeGitHubLogin(a) === normalizeGitHubLogin(b);
}
