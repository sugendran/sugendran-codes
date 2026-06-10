---
description: "Deep PR review: navigate the change, fan out specialist reviewers, synthesise one ranked plan"
argument-hint: "[aspects: code tests errors types security prod | all]"
allowed-tools: ["Bash", "Glob", "Grep", "Read", "Task"]
---

# Deep PR Review

Run a thorough review of the current change using specialist subagents. A navigator
reads the change first and produces a reading guide; the applicable reviewers run in
parallel with that guide as shared context; a synthesiser ranks everything into one
action plan.

**Requested aspects (optional):** "$ARGUMENTS"

## Workflow

### 1. Scope the change
- `git status` and `git diff --name-only` to list changed files.
- If a PR exists, also read it: `gh pr view` and `gh pr diff` (for title/description and
  the full diff). Fall back to the working/staged diff if there's no PR.
- Parse `$ARGUMENTS`: a subset of `code tests errors types security prod`, or `all`
  (default) to run everything applicable.

### 2. Navigate (always first)
Launch **sr-change-navigator** via the Task tool over the diff + PR description. Capture
its reading guide (real intent, business domain, entry points, read order, risk
hotspots). You will pass this guide verbatim to every reviewer.

### 3. Select applicable reviewers
From the changed files (intersected with `$ARGUMENTS` if a subset was given):
- **Always:** `sr-code-reviewer`, `sr-security-reviewer`, `sr-production-safety`.
- **If test files changed or logic was added:** `sr-test-analyzer`.
- **If error handling / catch / fallback logic changed:** `sr-silent-failure-hunter`.
- **If types, data models, or interfaces were added/modified:** `sr-type-design-analyzer`.

Aspect → agent mapping for `$ARGUMENTS`: `code`→code-reviewer, `tests`→test-analyzer,
`errors`→silent-failure-hunter, `types`→type-design-analyzer, `security`→security-reviewer,
`prod`→production-safety.

### 4. Fan out (parallel)
Launch the selected reviewers in parallel via the Task tool. Give each the same context:
the diff scope and the navigator's reading guide. Each returns findings on the shared
severity scale (Critical / High / Medium / Low + confidence) using the finding contract.

### 5. Synthesise (always last)
Launch **sr-synthesis** with the reading guide and every reviewer's findings. It applies
scope discipline (drops findings not caused by the change), dedupes, cross-correlates,
and returns one ranked action plan with a merge verdict.

### 6. Present
Show the synthesiser's report as the result. Lead with its verdict line.

## Usage

```
/sugendran-reviews:review                 # everything applicable
/sugendran-reviews:review security tests  # only those aspects
/sugendran-reviews:review types           # only type/interface design
```

## Notes

- Reviewers stay scoped to the change — pre-existing issues nearby are out of scope.
- All agents are prefixed `sr-` and coexist with any other review plugins installed.
- This toolkit reports; it does not edit code.
