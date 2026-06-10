# sugendran-reviews — design spec

**Date:** 2026-06-10
**Status:** Approved (design), pending implementation plan

## Summary

A personal PR-review toolkit, shipped as a single bundled plugin in the
`sugendran-codes` marketplace. It is built from **8 specialist subagents** — a
navigator, six reviewers, and a synthesiser — driven by **1 orchestrator command**
(`/sugendran-reviews:review`).

Two ideas shape the design:

1. A **change-navigator** runs *first* and produces a "reading guide" — what the
   change really does, the business domain it touches, and the optimal order to read
   the diff. This guide is passed as shared context into every other reviewer so they
   review with intent, not cold.
2. A **synthesis** agent runs *last* to dedupe and cross-correlate every finding into
   a single ranked action plan.

All agents are prefixed `sr-` so they are clearly namespaced under this plugin and
never clash with any other review agents the user has installed.

## Architecture

```
/sugendran-reviews:review   (orchestrator command; scopes the diff via git/gh)
     │
     ▼
sr-change-navigator  → reading guide (real intent vs. churn, domain, entry
     │                  points, recommended read order)
     │  guide passed as shared context to every reviewer below
     ▼
┌──── parallel reviewers, each fed the reading guide ────┐
│  sr-code-reviewer          sr-silent-failure-hunter    │
│  sr-test-analyzer          sr-type-design-analyzer     │
│  sr-security-reviewer      sr-production-safety         │
└─────────────────────────────────────────────────────────┘
     │  all findings, one shared severity scale
     ▼
sr-synthesis  → deduped, ranked action plan (Critical → Low)
```

### Plugin layout

```
plugins/sugendran-reviews/
  .claude-plugin/plugin.json
  agents/
    sr-change-navigator.md
    sr-code-reviewer.md
    sr-silent-failure-hunter.md
    sr-test-analyzer.md
    sr-type-design-analyzer.md
    sr-security-reviewer.md
    sr-production-safety.md
    sr-synthesis.md
  commands/review.md
  README.md
```

Registered in `.claude-plugin/marketplace.json` `plugins[]` with
`{ "name": "sugendran-reviews", "source": "sugendran-reviews", "description": "..." }`.

## Shared conventions

These apply to every reviewer agent.

### Scope discipline

A finding must be **caused by, or directly endangered by, this change**. Pre-existing
issues in code the diff merely touches or sits near are out of scope. Reviewers must
not drift into reviewing the wider codebase. `sr-synthesis` drops any finding that
fails this bar. This keeps the ranked plan about *this PR*, not the whole repository.

### Severity scale (all reviewers)

Every finding uses ONE scale so synthesis can rank across agents:

- **Critical** — must fix before merge (data loss, security hole, breaks prod).
- **High** — should fix before merge (user-facing bug, missing critical test).
- **Medium** — fix soon; not a merge blocker on its own.
- **Low** — optional / nice-to-have.

Each finding also carries a **confidence**: High / Medium / Low.

`sr-type-design-analyzer` additionally emits its 1–10 *quality ratings* — those are
scores describing the type, not findings, and sit alongside (not inside) the scale above.

### Finding output contract

Each reviewer returns Markdown with a findings list where every finding has:

```
- [SEVERITY · confidence] <title>  (file:line)
  Why it matters: <one or two sentences>
  Suggested fix: <concrete, actionable>
```

…plus a short **Summary** line and a **Positive observations** section. This shared
shape is what lets `sr-synthesis` parse, dedupe, and rank.

### Agent frontmatter

Each agent file uses: `name` (the `sr-` prefixed name), `description` (with worked
"when to invoke" scenarios), `model: inherit`, and a `color`.

## The agents

### sr-change-navigator (runs first)

Reads the diff and the PR description/title. Produces a **reading guide**:

- **What the change really does** — intent and behaviour change, separated from
  incidental churn (renames, formatting, generated files).
- **Business domain** — what part of the product/domain this touches, in plain terms.
- **Entry points** — where to start reading.
- **Recommended read order** — the path through the files that makes the change
  easiest to understand.
- **Risk hotspots** — files/areas the human and the other reviewers should scrutinise.

Output is structured Markdown. The orchestrator passes it verbatim as context to the
other reviewers.

### sr-code-reviewer

General code quality + project-guideline compliance (reads CLAUDE.md if present) +
bug detection. **Comment accuracy / rot is handled here** — flags comments that
contradict the code, are stale, or are misleading. Uses the shared severity scale.

### sr-silent-failure-hunter

Hunts swallowed and masked failures: empty or over-broad catch blocks, exceptions
caught and ignored, inappropriate fallbacks that hide a real failure, missing error
logging, and errors quietly converted to nil/null/default without justification.
Shared severity scale.

### sr-test-analyzer

Behavioural (not line) coverage and critical gaps — plus three judgement checks:

1. **Tautology detection.** Flags tests that prove nothing: asserting a mock returns
   what it was told to return, asserting `x == x`, asserting against the implementation
   restated, tests with no meaningful assertion, snapshot tests that lock in current
   behaviour without judgement, tests that pass regardless of the code under test.
2. **Business-domain explanation.** Tests should teach what the system does *for the
   business*, not just exercise code paths. Flags test names/structure that describe
   mechanics ("returns 200") instead of domain meaning ("rejects an order below the
   supplier's minimum"). Recommends domain-framed naming and arrange/act/assert clarity.
3. **Human-verification coverage.** Derives how a person would manually verify this
   change — the steps a reviewer or QA would take and the observable behaviour they'd
   check (using `sr-change-navigator`'s reading guide for intent). Then checks whether
   the automated tests cover those same paths. Flags: critical manual checks with no
   automated backing, verification steps that *could* be automated but aren't, and the
   gap between "what a human would confirm" and "what the suite confirms".

Each suggested test carries a 1–10 criticality rating so the user can tell
must-have coverage from nice-to-have; coverage gaps are also reported as findings on
the shared severity scale.

### sr-type-design-analyzer

Analyses the design of **types and interfaces** the change adds or modifies, and
enforces two named rule sets:

- **SOLID** — Single-responsibility, Open/closed, Liskov substitution, Interface
  segregation, Dependency inversion. Flags violations with the specific principle named.
- **Werner Vogels' 6 Rules for Good API Design** (applied to any
  interface/public surface the change adds or modifies):
  1. APIs are forever.
  2. Never break backward compatibility.
  3. Work backwards from customer use cases.
  4. Keep APIs as simple as possible (but no simpler).
  5. Self-describing, with a clear and obvious purpose.
  6. Don't leak implementation details.

Core philosophy it applies: make illegal states unrepresentable, validate at
construction time, prefer immutability, and avoid anaemic models. It emits four 1–10
quality ratings — encapsulation, invariant expression, usefulness, enforcement — and
stays pragmatic: a simpler type with fewer guarantees can beat a complex,
over-engineered one. Recommendations must not overcomplicate the codebase.

### sr-security-reviewer

Threat-models the *change* (not the whole codebase) for security defects: injection
(SQL/command/template), authentication & authorisation gaps, secrets in code or logs,
missing/weak input validation, unsafe deserialization, SSRF, path traversal, crypto
misuse, insecure defaults, and leaking sensitive data in errors/responses. Shared
severity scale, with exploitability reflected in confidence.

### sr-production-safety

Asks: **would this change deploy safely in a distributed-systems environment?**

- **Rolling-deploy compatibility** — old and new code running simultaneously; no
  big-bang assumptions.
- **Backward/forward compatibility** — API/event/message-schema changes are additive;
  consumers won't break.
- **Schema/data migrations** — expand-contract pattern; no destructive change coupled
  to code that still reads the old shape; backfills are safe and resumable.
- **Idempotency & retries** — operations safe to retry; timeouts, backoff, and
  circuit-breaking where calls cross a network.
- **Partial failure & blast radius** — what happens if a downstream is down; is failure
  contained.
- **Rollback & feature-flagging** — can this be turned off / rolled back without a
  data trap.
- **Concurrency** — races, ordering assumptions, shared-state hazards.
- **Observability** — new code paths emit logs/metrics/traces sufficient to debug them
  in production.

Shared severity scale.

### sr-synthesis (runs last)

Takes every reviewer's output. Applies scope discipline (drops findings not caused by
the change), dedupes findings that multiple reviewers raised, cross-correlates related
issues, and produces ONE ranked action plan:

```
# PR Review Summary
## Critical (n)
## High (n)
## Medium (n)
## Low (n)
## Strengths
## Recommended action
```

Each line attributes the source agent and keeps the file:line reference.

## Orchestrator: /sugendran-reviews:review

1. **Scope** — `git diff --name-only` (and `gh pr view` / `gh pr diff` if a PR
   exists) to find changed files; parse `$ARGUMENTS` for an optional subset of aspects.
2. **Navigate** — run `sr-change-navigator`; capture the reading guide.
3. **Select** — choose applicable reviewers from the changed files:
   - always: code-reviewer, security-reviewer, production-safety, synthesis
   - if tests changed / logic added: test-analyzer
   - if error handling touched: silent-failure-hunter
   - if types/interfaces added or modified: type-design-analyzer
4. **Fan out** — launch the selected reviewers in parallel via the Task tool, passing
   each the reading guide as context.
5. **Synthesise** — run `sr-synthesis` over all findings; present the ranked plan.

`$ARGUMENTS` lets the user request a subset, e.g. `/sugendran-reviews:review security tests`.
`all` (default) runs everything applicable.

## Out of scope (for now)

- **Dependency / supply-chain review** — left to dedicated CI tooling (npm audit,
  Dependabot, Snyk), which checks known vulnerabilities deterministically against a
  live advisory feed. An LLM has a knowledge cutoff and would be stale or guess, giving
  false confidence.
- **Observability** as a separate agent — handled inside production-safety.
- **Comment accuracy** as a separate agent — handled inside code-reviewer.
- **Auto-applying fixes** — this toolkit reports; it does not edit.

## Verification

Manual QA (no runtime to unit-test agent prose):

- `claude plugin validate ./plugins/sugendran-reviews` passes.
- `claude plugin validate .` (marketplace) still passes with the new plugin registered.
- `/plugin marketplace add ./` then `/plugin install sugendran-reviews@sugendran-codes`
  installs cleanly; `/sugendran-reviews:review` and all eight `sr-*` agents appear in
  the agents list.
- Run `/sugendran-reviews:review` against a small sample diff and confirm: navigator
  runs first, reviewers run in parallel, synthesis produces a single ranked plan, and
  findings are scoped to the change.

## Delivery

Build all at once, as small atomic commits (one logical unit each): scaffold +
manifest registration; then agents in related batches; then the orchestrator; then the
README. Each commit message includes the prompt and plan per repo convention.
