---
description: "Deep PR review: navigate the change, fan out specialist reviewers, synthesise one ranked plan"
argument-hint: "[aspects: code tests errors types security prod | all]"
allowed-tools: ["Bash", "Glob", "Grep", "Read", "Task"]
---

# Deep PR Review

Run a thorough review of the current change using specialist subagents. The orchestrator
snapshots the diff ONCE into filtered scope files; a navigator produces a reading guide;
the applicable reviewers run in parallel, each given only the slice of the change it can
act on; a synthesiser ranks everything into one action plan.

**Requested aspects (optional):** "$ARGUMENTS"

## Workflow

### 1. Snapshot the change (once)

- Identify the diff source: `gh pr diff` if a PR exists (also `gh pr view` for
  title/description), otherwise the staged/working `git diff`.
- Create a scope dir: `SCOPE=$(mktemp -d /tmp/sr-review-XXXXXX)`.
- Classify every changed file into one of:
  - **source** — application/library code
  - **tests** — test/spec files, fixtures, snapshots-as-tests
  - **config** — manifests, schemas, migrations, CI, IaC, Dockerfiles
  - **docs** — `*.md`/`*.mdx`/`*.rst`, `docs/`, READMEs, ADRs
  - **generated** — lockfiles, build output, codegen, vendored assets
- Write filtered snapshots (use `git diff -- <pathspecs>` / `gh pr diff` filtered):
  - `$SCOPE/source.diff`, `$SCOPE/tests.diff`, `$SCOPE/config.diff`
  - `$SCOPE/files.txt` — every changed file with its class and +/− counts.
    **Docs and generated files appear here by name only — their hunks are never
    written to any snapshot.** Reviewers reason about their existence, not content.
- Subagents never run git/gh themselves. The snapshot is the single source of truth,
  so every reviewer sees the same change even if the working tree moves mid-review.

### 2. Route by size and content

- **Docs/generated-only change** → no fan-out. Read it, sanity-check inline, report
  in a few lines. Done.
- **Small change** — under ~150 changed lines across source+tests+config → no
  fan-out. Review it inline yourself, applying every lens (correctness & comment
  accuracy, silent failures, test gaps/tautology/domain-meaning/human-verification,
  type & API design incl. SOLID and Vogels' rules, security, production safety) and
  present a ranked summary in the synthesis format. The full pipeline is not worth
  8 cold contexts for a small diff.
- **Otherwise** → full pipeline (steps 3–6).

### 3. Navigate (always first)

Launch **sr-change-navigator** via the Task tool. Give it `$SCOPE/files.txt` and all
three snapshot paths, plus the PR title/description. Capture its reading guide (real
intent, business domain, entry points, read order, risk hotspots).

### 4. Select applicable reviewers

From the changed files (intersected with `$ARGUMENTS` if a subset was given):
- **Always:** `sr-code-reviewer`, `sr-security-reviewer`, `sr-production-safety`.
- **If test files changed or logic was added:** `sr-test-analyzer`.
- **If error handling / catch / fallback logic changed:** `sr-silent-failure-hunter`.
- **If types, data models, or interfaces were added/modified:** `sr-type-design-analyzer`.

Aspect → agent mapping for `$ARGUMENTS`: `code`→code-reviewer, `tests`→test-analyzer,
`errors`→silent-failure-hunter, `types`→type-design-analyzer, `security`→security-reviewer,
`prod`→production-safety.

### 5. Fan out (parallel, per-agent scope views)

Each reviewer is given ONLY the snapshots it can act on:

| Agent | Snapshot paths to pass |
| ----- | ---------------------- |
| sr-code-reviewer | source.diff, tests.diff, config.diff |
| sr-test-analyzer | source.diff, tests.diff |
| sr-silent-failure-hunter | source.diff |
| sr-type-design-analyzer | source.diff |
| sr-security-reviewer | source.diff, config.diff |
| sr-production-safety | source.diff, config.diff |

Every Task prompt contains: the navigator's reading guide, the agent's snapshot paths,
`files.txt`, and this scope rule:

> Your primary scope is the snapshot file(s) listed — do not run git or gh to
> rediscover the change. You may Read surrounding repo files for context. If your
> view excludes test files, you may read tests only when needed to confirm or
> dismiss a specific finding.

### 6. Synthesise (always last)

Launch **sr-synthesis** with the reading guide and every reviewer's findings — no
diff, no snapshots; it judges findings, not code. It applies scope discipline, dedupes,
cross-correlates, and returns one ranked action plan with a merge verdict. Present that
as the result, leading with the verdict line. Clean up `$SCOPE` afterwards.

## Usage

```
/sugendran-reviews:review                 # everything applicable
/sugendran-reviews:review security tests  # only those aspects
/sugendran-reviews:review types           # only type/interface design
```

## Notes

- Reviewers stay scoped to the change — pre-existing issues nearby are out of scope.
- Docs and generated hunks are never sent to reviewers; small diffs never fan out.
- All agents are prefixed `sr-` and coexist with any other review plugins installed.
- This toolkit reports; it does not edit code.
