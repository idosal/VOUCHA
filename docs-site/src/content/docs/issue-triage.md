---
title: Issue-backed triage
description: How linked issues can exempt planned work without requiring a new maintainer-only workflow.
---

`linked_issue_match` lets maintainers reuse normal GitHub issue workflow. A PR
can be exempted when it links to maintainer-approved planned work and the
configured LLM scores the PR as a strong semantic match.

The intent is conservative: VOUCHA should recognize a PR that implements a
trusted issue, but it should not turn a weak issue reference into a blanket
pass.

## Link discovery

VOUCHA looks for standard closing references:

- `Fixes #123`
- `Closes owner/repo#123`
- GitHub issue URLs

By default, linked issues must be in the same repository. Cross-repo issue
references are ignored unless `require_same_repo: false` is configured.

Missing, untrusted, cross-repo, or weakly related issues fall through to the
configured gate. They do not create a failure state.

## Approved-issue bypass policy

Use this policy when maintainers want to accept implementations of work they
already approved in GitHub Issues, while asking every other contributor to
complete the VOUCHA quiz:

```yaml
require_approval: never

exemptions:
  - type: linked_issue_match
    require_same_repo: true
    require_trusted_signal: true
    min_match_score: 0.7
    max_issues: 5
    trusted_labels: [approved]
```

With this configuration:

1. A PR that closes a trusted, semantically matching issue receives an
   explanatory success check without a quiz.
2. A PR with no issue reference, an unapproved issue, or a weak issue match
   proceeds directly to the configured VOUCHA gate.
3. No additional `/voucha approve` step is required before the contributor can
   start the quiz.

The `approved` label is only an example. Reuse the repository's existing
maintainer-owned label, maintainer-authored issue workflow, or contributor
assignment workflow. A configured label counts only when it is currently
present and GitHub's issue-event history shows that a user with `write`,
`maintain`, or `admin` access applied it. A current assignment of the PR author
also counts when the assignment event shows that such a maintainer performed
it.

Other exemptions still apply. If the repository literally wants every
non-approved-issue PR to take the quiz, also review
`trust.default_author_associations`, `bot_policy`, `min_changed_lines`, and
`skip_paths` so those policies do not independently exempt the author or diff.

## Trusted issue signals

An issue has maintainer approval evidence through any of these GitHub
signals:

- maintainer or collaborator issue author;
- the PR author is currently assigned to the issue, and the assignment event
  shows a user with `write`, `maintain`, or `admin` access assigned them;
- a configured `trusted_labels` value applied by a user whose current
  repository access is `write`, `maintain`, or `admin`.

```yaml
exemptions:
  - type: linked_issue_match
    require_same_repo: true
    require_trusted_signal: true
    min_match_score: 0.7
    max_issues: 5
    trusted_labels: [accepted]
```

`require_trusted_signal: true` keeps a random issue link, contributor-applied
label, or self-assignment from becoming an automatic exemption. Set it to
`false` only when issue references are already a trusted planning artifact in
the repository.

## Semantic match

The configured LLM compares the PR title, body, and file list against the
requested outcome in the linked issue. It returns a score from 0 to 1, and the
exemption applies only when that score meets `min_match_score`. If the provider
fails or returns invalid output, VOUCHA does not grant the exemption and the PR
continues to the normal quiz.

This keeps the workflow practical: maintainers can keep using issues for
planning, and VOUCHA can avoid challenging implementation PRs that already
have reviewed context.

## Common operating pattern

Use issue triage for work that maintainers have already shaped:

1. A maintainer opens the issue, assigns the contributor, or applies an
   approval/planning label.
2. Contributor links the issue in the PR body with a normal closing reference.
3. VOUCHA checks trust and semantic match.
4. If both pass, the PR receives an exempt success check with the reason.
5. If either is weak, the PR follows the normal challenge path.

This avoids a VOUCHA-specific ceremony. The policy reuses GitHub state that
maintainers already understand.

## Tuning advice

Keep `min_match_score` conservative. `0.7` is a reasonable default for planned
work: the LLM should find that the PR clearly implements the requested outcome
without requiring exact wording. This is a semantic threshold, not lexical
token overlap.

Use `trusted_labels` for labels that already mean accepted or ready to
implement. VOUCHA validates who applied the label; a contributor cannot approve
their own issue by adding the label. Do not add a label that means only "skip
VOUCHA" unless the repository explicitly wants that process.

Keep `max_issues` small. A PR that links many issues can become ambiguous; it
is the maximum number of closing references evaluated, in PR-body order
(default 5, maximum 10). It is usually better for VOUCHA to challenge the
author than to infer scope from a broad issue list.
