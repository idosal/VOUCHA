# Product

## Register

product

## Users

VOUCHA serves two connected groups in GitHub pull request workflows.

PR authors use it when a repository asks them to confirm that a submitted PR was intentional and that they stand behind it. Their context is high-friction and time-sensitive: they are trying to get a PR reviewed or merged, often after using AI assistance, and they need a challenge that feels fair, specific, and understandable.

Maintainers use VOUCHA indirectly through GitHub checks, comments, attestation posts, and risk reports. Their job is not to judge whether code was AI-written; it is to confirm that the PR was intentional and that the author stands behind it, while flagging suspicious passes for closer review.

## Product Purpose

VOUCHA is an intent and accountability gate for GitHub contributions. It creates a short quiz from the PR itself, gives the author a concrete way to confirm the PR was intentional and that they stand behind its effects, and posts that attestation on the record when they pass.

The product does not claim to prove humanness or defeat adversarial agents with browser control. Its value is forcing genuine engagement from careless contributors, turning dishonest bypasses into deliberate visible deception, and giving maintainers a behavioral risk report instead of a silent green check.

Success means the challenge feels legitimate to authors, useful to maintainers, and proportional to the risk: easy enough to complete when a PR is intentional and its author can explain it, hard enough to expose shallow submissions, and honest about its own limits.

## Brand Personality

Sharp, fair, accountable.

The voice should be direct without being punitive. VOUCHA can be memorable because the name is distinctive, but the interface should not make the gate feel like an inside joke, mascot brand, or tool for one source project. It should read as a precise maintainer tool with a clear ethical line: AI-written code is fine; not understanding it is not.

## Anti-references

Do not imply that VOUCHA proves a user is human, defeats all AI agents, or provides unbeatable security.

Avoid invasive proctoring patterns: webcam checks, keystroke capture, clipboard policing, fake biometric presence, dark-pattern countdown pressure, or security theater that adds surveillance without improving comprehension.

Avoid mascot-heavy, joke-first, or project-specific UI that makes a repository gate feel unserious or tied to one community. Also avoid enterprise compliance theater: dense legalistic copy, fear-based warnings, or dashboards that obscure the simple question of whether the PR was intentional and its author stands behind it.

Avoid locking future design work to the current server-rendered card flow. A richer frontend is acceptable when it materially improves comprehension, pacing, accessibility, error recovery, or maintainer trust.

## Design Principles

Make the trade explicit: VOUCHA is about PR intent, accountability, and risk visibility, not proof of humanness.

Respect the contributor's flow: the challenge should feel focused, bounded, and recoverable rather than hostile or surprising.

Keep the maintainer signal useful: risk reporting should make suspicious behavior visible without pretending telemetry is a verdict by itself.

Earn trust through specificity: questions, status messages, and explanations should refer to the PR and the actual workflow, not generic security boilerplate.

Use complexity only when it improves the task: richer frontend behavior is welcome for better UX, but every added state, animation, or panel must make the challenge clearer, fairer, or easier to recover from.

## Accessibility & Inclusion

Target WCAG AA for user-facing surfaces. Preserve readable contrast, visible focus states, keyboard navigation, color-independent success/error/warning states, and reduced-motion alternatives for any animation.

The quiz should remain usable under time pressure without becoming hostile. Timers must be visible, server-authoritative, and understandable. Contributors can select a 10x extended-timing mode before starting without explaining or justifying the choice. The interface should avoid panic-inducing effects or inaccessible motion.

Telemetry disclosure should stay plain and privacy-respecting: VOUCHA records server-measured timing and summary interaction statistics for risk reporting, plus whether decoy fields were submitted or maintainer-configured code canaries appeared in added diff lines. It does not record keystrokes, written content, webcam data, or invasive surveillance. Failed browser verification and repeated server-measured sub-two-second answers can fail an otherwise correct quiz. Faster-than-average answers, pointer absence, focus loss, honeypots, and other inconclusive signals remain report-only.
