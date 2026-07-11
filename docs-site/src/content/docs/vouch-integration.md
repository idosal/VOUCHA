---
title: Vouch integration
description: Use Vouch for durable community trust and VOUCHA for per-change comprehension evidence.
---

[Vouch](https://github.com/mitchellh/vouch) and VOUCHA answer different trust
questions:

- **Vouch:** has this project community explicitly trusted this contributor to
  participate?
- **VOUCHA:** does this author understand this particular pull request?

The integration makes Vouch an upstream trust source without turning a VOUCHA
quiz result into durable contributor reputation.

## Enable the integration

Keep the Vouch Trustdown file on the merge target, then enable it in
`.github/voucha.yml`:

```yaml
trust:
  vouch:
    enabled: true
    file: .github/VOUCHED.td
```

The integration is disabled by default. `file` can point to another Trustdown
path in the same repository, such as `VOUCHED.td`.

VOUCHA reads both its policy and the configured Vouch file from the PR's merge
target. A contributor cannot add themselves to `VOUCHED.td` in the feature
branch to bypass the gate.

## Status behavior

| Vouch status | VOUCHA result |
| --- | --- |
| `vouched` | Successful **Trusted by Vouch** check; no comprehension challenge. |
| `unknown` | Continue through the repository's normal VOUCHA exemptions and gates. |
| `denounced` | Failed **Blocked by Vouch** check; later size, path, or author exemptions cannot bypass it. |
| File missing or unreadable | Continue through normal VOUCHA policy. |

Draft handling and the optional PR-body `accountability` preflight run before
the Vouch lookup. A vouched author therefore does not bypass required
acknowledgement or AI-disclosure fields.

## Trustdown compatibility

VOUCHA recognizes unprefixed GitHub handles and explicit `github:` handles,
case-insensitively:

```text
# Trusted contributor
alice
github:bob Maintainer-vouched after prior contributions

# Explicitly blocked contributor
-github:mallory Private maintainer reason
```

Other platform prefixes do not match GitHub PR authors. VOUCHA uses the first
matching contributor entry, matching Vouch's lookup behavior for a normally
managed file.

Denouncement details stay in `VOUCHED.td`; VOUCHA reports only that the author
is denounced. It does not copy private moderation reasons into the public check
run.

## Ownership boundary

Vouch remains the source of truth for community trust. VOUCHA only reads the
file and never:

- adds, removes, vouches, unvouches, or denounces a contributor;
- runs the Vouch CLI or its management actions;
- promotes a passed challenge into a Vouch entry; or
- interprets a vouch as approval of a particular code change.

A VOUCHA pass is evidence that the author understood one exact PR head. A
Vouch entry is a maintainer or community decision about the contributor. Keep
those claims separate.

## Rollout check

After enabling the integration, open test PRs from accounts representing each
state:

1. A vouched author should receive `Trusted by Vouch` without a challenge row.
2. An unknown author should continue into the configured VOUCHA flow.
3. A denounced author should receive `Blocked by Vouch`, even on a docs-only or
   otherwise exempt change.
4. Temporarily configure a missing file path; the author should fall back to
   normal policy rather than being trusted or blocked.

Vouch's own GitHub Actions can continue managing or enforcing the trust list.
VOUCHA consumes the resulting merge-target status as one input in its PR
policy.
