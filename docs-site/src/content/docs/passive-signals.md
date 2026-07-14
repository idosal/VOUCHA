---
title: Passive signals
description: Honeypot fields, code canaries, and review signals used to inform maintainer review.
---

Passive signals are usually evidence, not verdicts. They are collected so
maintainers can notice suspicious automation patterns without letting a brittle
signal silently block a contributor.

VOUCHA keeps passive signals out of challenge scoring. They can appear in
check-run summaries, risk reports, comments, and flagged labels, but they do
not turn a correct quiz into a failure. One ambiguous clue remains report-only.
Two independent interaction clues can pause a correct result for explicit
confirmation, which is visible to the author and maintainers.

Three bot-verification checks are stricter: Turnstile must validate the browser
session before a quiz is generated, a browser `webdriver` automation flag fails
the challenge if it appears during the quiz, and repeated server-measured
answers under two seconds fail a correct quiz. Every hard failure states its
reason.

## Form honeypot

`honeypot` adds an off-screen form field to the challenge pages. Broad automated
form fillers often populate hidden fields. Real authors and browser password
managers generally should not.

When the field is submitted, VOUCHA records the hit in challenge telemetry
and surfaces it in review summaries. The hit does not change the quiz score.

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
    patterns: ["VOUCHA_DO_NOT_ADD_THIS"]
    paths: ["src/**", "infra/**"]
```

File canaries are matched only in added diff lines and scoped by `paths`. The
check-run summary describes the finding without exposing the exact marker when
that would make the canary easy to game.

Code honeypots are evaluated from the PR diff before exemption decisions finish.
That means a report-only canary finding can still appear when the PR is exempt,
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

VOUCHA separates strong evidence from inconclusive context. Failed Turnstile,
an explicit browser `webdriver` flag, or repeated server-measured answers under
two seconds are strong challenge-taking evidence. Fast answers, pointer
absence, focus loss, form honeypots, and code canaries are inconclusive on their
own: keyboard navigation, touch input, browser extensions, network issues, and
accessibility setups can all look unusual without implying bad faith.

When strong evidence is present, the challenge is not accepted as author
attestation and the result states the reason. A single inconclusive signal stays
in the maintainer-facing risk report without changing the score or result.

VOUCHA requests additional confirmation only when at least two independent
interaction clues agree:

- the hidden start-form field was submitted;
- every answer arrived in under ten seconds, but not under the hard two-second
  threshold;
- the challenge repeatedly lost browser focus.

Pointer absence and code honeypots never count toward this threshold. The pause
does not alter the score. When repository policy enables WebAuthn, the author
uses a passkey enrolled after an earlier clean pass. Otherwise, an independent
write-capable maintainer comments `/voucha confirm`.

## Why report-only

Passive signals can be noisy:

- bots can avoid hidden fields once they know about them;
- humans can accidentally trip canaries while moving examples;
- faster-than-average timing and pointer signals can reflect normal input;
- most automation hints are useful for review but weak as standalone proof.

For that reason, each ambiguous signal is report-only by itself. The small,
documented multi-signal threshold requests confirmation rather than producing a
hidden failure. A config that sets `report_only: false` for honeypots is
normalized back to this behavior.

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
