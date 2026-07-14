---
title: VOUCHA operating model
description: How VOUCHA decides when to trust context, record signals, or ask for an explicit pull request attestation.
hero:
  title: Maintainer operating model
  tagline: VOUCHA is free open-source repository policy for pull requests. It resolves trust first, records passive evidence, and asks for explicit PR intent and accountability only when policy still needs it.
  actions:
    - text: Get started
      link: /docs/getting-started/
    - text: Why use it
      link: /docs/why-voucha/
      variant: secondary
---

VOUCHA is a free open-source project that sits in the pull request review
path as a fail-open governance layer. It complements code review, CI, tests,
branch protection, and existing maintainer workflows. It does not decide
whether a change is good. It decides whether a PR already has enough trusted
context, or whether the repository should ask for a short challenge that
records its intent and ownership before maintainer review.

## Decision order

| Stage | What VOUCHA checks | Result |
| --- | --- | --- |
| Repository policy | `.github/voucha.yml` from the merge target | PRs cannot relax their own gate by editing config on the feature branch. |
| Path-specific policy | first matching `path_rules` entry | Sensitive paths can override gates, approval, attempts, cooldown, and scope. |
| Accountability | optional PR-body acknowledgement and AI disclosure fields | Missing required policy fields fail before a quiz is created. |
| Vouch trust | optional merge-target `VOUCHED.td` lookup | Vouched authors skip the challenge, unknown authors continue, and denounced authors receive a failed check. |
| Exemptions | configurable default author trust, author rules, teams, repository roles, prior merged PRs, paths, size, issue context | Trusted or out-of-scope work gets an explanatory success check. |
| Agent boundary, bot verification, and signals | Visible and machine-readable no-use policy for agents, challenge-bound Managed Turnstile, browser automation flags, hidden form fields, code canaries, timing, pointer summaries | The policy warns compliant agents away from the attestation. Strong verification evidence can stop the gate; one ambiguous clue stays report-only and two independent interaction clues request explicit confirmation through a maintainer, plus an established passkey when enabled. |
| Challenge | generated questions about intent, behavior, affected surfaces, and blast radius | A pass records that the PR was intentional and its author stands behind it. |

## What maintainers get

- A check-run summary that explains why a PR passed, was exempt, needs approval,
  or degraded to neutral.
- A policy vocabulary centered on `gates`, `exemptions`, and report-only
  `signals`.
- Accountability templates for repositories that want AI-assisted work allowed
  but explicitly owned by the submitter.
- Linked-issue triage that can reuse existing GitHub workflow instead of
  adding a VOUCHA-specific label ceremony.
- Team, role, and prior-merged-PR trust tiers for repositories that do not want
  to treat every outside contributor the same way.
- Passive canary reporting for suspicious diffs without turning a canary into
  an automatic block.
- Adaptive PR investigation for normal and large PRs, with optional Flue-backed
  investigation when configured.
- Output controls for quiet, normal, or detailed PR comments and optional
  `VOUCHA:passed`, `VOUCHA:failed`, and `VOUCHA:flagged` labels.

## Start here

| Page | Use it for |
| --- | --- |
| [Why use VOUCHA](/docs/why-voucha/) | Decide whether this belongs in the repository's review path. |
| [Getting started](/docs/getting-started/) | Add the first policy file and verify the first scenarios. |
| [Deployment](/docs/deployment/) | Install the hosted app or self-host the Worker, GitHub App, Turnstile, model provider, and Flue. |
| [Vouch integration](/docs/vouch-integration/) | Compose durable community trust with per-PR comprehension evidence. |
| [Common practices](/docs/common-practices/) | Start from quiz-backed contributor, Vouch, team, issue-triage, or sensitive-path recipes, then tune operations. |
| [Verification checklist](/docs/verification/) | Smoke-test a real repository, drill failure modes, and record rollout evidence. |
| [Privacy and data](/docs/privacy-data/) | Explain hosted and self-hosted data boundaries and contributor challenge acceptance. |
| [Configuration](/docs/configuration/) | Check the full current policy surface and defaults. |

## Default failure posture

VOUCHA should not become an outage-prone merge lock. Service-side failures,
model failures, malformed config fields, and unavailable signal providers
degrade narrowly and visibly. Optional trust lookups fail closed into the
normal gate, while service failures report neutral. Maintainers still see the
reason, but the product is built as review evidence rather than an infallible
gatekeeper.
