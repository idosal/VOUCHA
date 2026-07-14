---
title: Challenge lifecycle
description: How VOUCHA creates, serves, scores, and reports PR intent and accountability challenges.
---

When no exemption applies, VOUCHA creates a short, diff-specific challenge for
the pull request. It gives the author a concrete way to attest to the PR's
intent and take responsibility for the change.

It is not a humanity test or a test of the author. It records that the PR was
intentional and that its author stands behind it.

## Approval gate

Some PRs wait for maintainer approval before the author can open the quiz.
`require_approval: first_time` applies this to first-time or unknown GitHub
authors. `always` applies it to every challenged PR. Maintainers approve with:

```text
/voucha approve
```

Approvers must have write/push, maintain, or admin access on the repository.

## Investigation

Before quiz generation, VOUCHA builds a cached investigation from PR
metadata, changed files, and selected patch evidence. The quiz is generated from
that artifact instead of a blind prefix of a large diff.

The investigation should identify:

- the apparent intent of the change;
- important files and subsystems touched;
- externally visible behavior changes;
- compatibility or migration risks;
- likely blast radius.

It also records evidence paths, unknowns, quiz anchors, confidence, and whether
the PR is in normal or large-PR mode. For large PRs, the artifact should name
unknowns instead of pretending every changed line was inspected.

`context.investigator` controls where that work happens:

| Value | Behavior |
| --- | --- |
| `auto` | Use the Worker for normal PRs; use the Flue investigator for large PRs when configured. |
| `worker` | Keep investigation in the main Worker. |
| `flue` | Require the Flue investigator service. If missing or failing, report neutral. |

## Challenge serving

The author verifies from GitHub before answering by commenting a one-time
`/voucha verify <code>` command on the PR. The challenge page copies the
command, opens the PR, and polls until GitHub's signed webhook binds that
browser session to the PR author without granting VOUCHA delegated account
access.

Before quiz generation starts, the author accepts the challenge terms on the
start page. If they do not accept, VOUCHA does not create a quiz attempt or
collect answer telemetry. The acknowledgement is intentionally small: it tells
contributors that VOUCHA uses the public PR context to generate the quiz and
stores their answer selections plus summary signals for maintainer review.

Pressing **Begin challenge** executes Cloudflare Turnstile. VOUCHA binds the
token to the challenge with an action and signed custom-data value, then checks
the expected hostname and sends the request IP to Siteverify. The widget stays
in Cloudflare's Managed mode, so Cloudflare decides whether an interaction is
needed. A visible checkbox is not forced for every person.

Admitting the quiz consumes the attempt. Only one unfinished quiz can exist for
a challenge, and reopening or double-submitting the start page resumes that
quiz instead of generating another one. Each retry gets fresh questions.

Each question has 30 seconds. The server allows 5 additional seconds for
network and submission latency, but does not display that grace as answer time.
Refreshing the page does not reset the timer. There is no minimum dwell time,
so a person who knows an answer can submit it immediately.

An active attempt also has an overall server deadline derived from its question
count and timer. Leaving it unfinished past that deadline consumes and closes
the attempt, preventing free question harvesting by repeatedly abandoning
quizzes.

The shipped gate is `multiple_choice`. The repository controls question count
and pass threshold:

```yaml
gates:
  - type: multiple_choice
    questions: 4
    pass_threshold: 3
```

Questions should focus on the PR's intent, behavior changes, affected surfaces,
compatibility, and blast radius. They should not test code trivia.

## Retry behavior

A failed non-final attempt can retry immediately by default. VOUCHA generates a
fresh quiz from the cached investigation for every retry. Repositories can add
a wait by setting a positive base cooldown. Repeated failed or abandoned
attempts use 1x, 2x, 4x, then at most 8x that value. The result page keeps the
contributor in VOUCHA with a **Try again** action on the same challenge link;
returning to the GitHub PR is optional.

```yaml
max_attempts: 3
cooldown_minutes: 0
```

Once attempts are exhausted, the check becomes failed and maintainers should
review manually. Repositories can optionally auto-close terminal hard failures
with `enforcement.auto_close`.

## Outcomes

| Outcome | Check behavior |
| --- | --- |
| Passed | Green check with an attestation summary. |
| Passed with inconclusive signals | Green check; signals remain report-only in the check details. |
| Correct, confirmation required | Check stays in progress. An independent write-capable maintainer can confirm it; an established passkey is also available when repository policy enables WebAuthn. |
| Failed attempt | Cooldown and retry policy apply; detailed signal feedback is withheld until final outcome. |
| Challenge assistance detected | Failed check; optional PR auto-close when configured for `failed_assisted`; a maintainer can start a fresh cycle with `/voucha retry`. |
| Attempts exhausted | Failed check; optional PR auto-close when configured for `failed_final`; a maintainer can start a fresh cycle with `/voucha retry`. |
| Generation or service failure | Neutral check; the PR is not blocked, and a maintainer can retry after recovery. |
| Superseded commit | Old challenge becomes inactive and the PR receives a current result. |
| Expired setup | Scheduled sweep neutralizes stale awaiting or ready challenges. |

## Additional confirmation

A single ambiguous interaction clue never changes a correct result. If two
independent clues agree, from a submitted form honeypot, every answer under ten
seconds, or repeated focus loss, VOUCHA pauses instead of guessing. Pointer
absence and code canaries never trigger this pause.

When `confirmation.webauthn` is enabled, the author can confirm with a passkey
that was enrolled after an earlier clean pass. VOUCHA does not accept a newly
created credential at the suspicious moment as proof. If WebAuthn is disabled
or there is no established passkey, a write-capable maintainer other than the
PR author comments:

```text
/voucha confirm
```

Passkeys are optional. The maintainer path covers unsupported browsers,
devices without user verification, contributors who declined enrollment, and
accessibility or account-recovery cases. A pending confirmation expires after
48 hours and can then be restarted with `/voucha retry`.

The durable record is the check-run summary on the PR. It should show enough
context for maintainers to understand what VOUCHA did without making them
open the service database.

## Data kept after resolution

Quiz questions and correct answers are needed while a challenge is active. Once
the challenge reaches a terminal result, stored question text is purged while
score, answers, status, and summary telemetry remain as the audit trail.

See [Privacy and data](/docs/privacy-data/) for the hosted and self-hosted data
boundaries and the contributor acceptance flow.
