---
title: Passive signals
description: Honeypot fields, code canaries, and challenge telemetry used to detect assisted challenge attempts and inform maintainer review.
---

Passive signals are evidence. CLAWPTCHA keeps them out of the quiz score, but
that does not make challenge assistance optional: multiple independent
challenge-taking signals can invalidate an otherwise correct quiz because the
author attestation must come from the PR author.

Code canaries are different. They are PR-risk evidence for maintainers and do
not count toward the challenge-assistance verdict.

## Form honeypot

`honeypot` adds an off-screen form field to the challenge pages. Broad automated
form fillers often populate hidden fields. Real authors and browser password
managers generally should not.

When the field is submitted, CLAWPTCHA records the hit in challenge telemetry
and surfaces it in review summaries. The hit does not change the quiz score,
but it can contribute to the non-configurable assisted-challenge verdict when
combined with other challenge-taking signals.

```yaml
signals:
  - type: honeypot
    report_only: true
```

`honeypot` is enabled by default. Set `signals: []` when a repository wants no
passive honeypot collection at all.

## Code honeypot

`code_honeypot` watches for maintainer-authored literal canaries in selected
files. A common pattern is to place a do-not-add marker in internal examples,
fixtures, or documentation that low-context code generation may copy into real
source.

```yaml
signals:
  - type: code_honeypot
    report_only: true
    patterns: ["CLAWPTCHA_DO_NOT_ADD_THIS"]
    paths: ["src/**", "infra/**"]
```

File canaries are matched only in added diff lines and scoped by `paths`. The
check-run summary describes the finding without exposing the exact marker when
that would make the canary easy to game.

Code honeypots are evaluated from the PR diff before exemption decisions finish.
That means a canary finding can still appear when the PR is exempt,
is a draft with neutral handling, or reuses a prior pass.

## Risk report signals

Challenge telemetry is stored as summary statistics:

- per-question timing;
- answer-change count;
- aggregate pointer distance and sample count;
- focus-loss count;
- Turnstile outcome;
- browser `webdriver` state;
- form honeypot state;
- code honeypot state.

Those summaries are only collected after the contributor accepts the challenge
terms on the start page. See [Privacy and data](/docs/privacy-data/) for the
full data boundary.

CLAWPTCHA treats two or more independent challenge-taking signals as
automation-likely. A single signal is intentionally not enough: keyboard
navigation, browser extensions, network issues, and accessibility setups can
look unusual without implying bad faith.

When the answers are correct but the challenge-taking report is
automation-likely, the challenge fails with `failed_assisted` and asks
maintainers to review manually.

## Why No Single Signal

Passive signals can be noisy:

- bots can avoid hidden fields once they know about them;
- humans can accidentally trip canaries while moving examples;
- Turnstile and timing signals can fail for environmental reasons;
- automation hints are useful for review but weak as standalone proof.

For that reason, CLAWPTCHA requires multiple independent challenge-taking
signals before failing an otherwise correct quiz. A config cannot opt into
allowing AI or agent help on the challenge.

## Practical canary design

Good canaries are narrow and uninteresting:

- unique strings that do not appear in normal code;
- scoped to paths where introducing the marker would matter;
- placed in examples, fixtures, prompts, or docs that a low-context generator
  might copy;
- rotated when they become too visible.

Avoid canaries that look like real secrets. The point is not to bait a secret
scanner or confuse contributors. The point is to give maintainers a quiet
signal that a diff may have copied from a source it did not understand.
