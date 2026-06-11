# sugendran-reviews

Deep pull-request review via specialist subagents. A **navigator** reads the change
first and writes a reading guide; **six focused reviewers** run in parallel with that
guide as shared context; a **synthesiser** ranks every finding into one action plan.

## Install

```bash
/plugin marketplace add sugendran/sugendran-codes
/plugin install sugendran-reviews@sugendran-codes
```

## Use

```bash
/sugendran-reviews:review                 # everything applicable to the diff
/sugendran-reviews:review security tests  # only those aspects
/sugendran-reviews:review types           # only type/interface design
```

The command scopes the current change (working tree, staged, or an open PR via `gh`),
runs the navigator, fans out the reviewers, and presents the synthesiser's ranked plan.

## Pipeline

```
sr-change-navigator  →  reading guide (intent vs. churn, domain, read order, hotspots)
        │  (guide fed to every reviewer)
        ▼
┌──── parallel reviewers ────┐
│  sr-code-reviewer          │  quality, CLAUDE.md compliance, bugs, comment rot
│  sr-silent-failure-hunter  │  swallowed/masked errors, bad fallbacks
│  sr-test-analyzer          │  coverage gaps, tautologies, domain meaning, human-verify gap
│  sr-type-design-analyzer   │  types + interfaces; SOLID; Vogels' 6 API rules
│  sr-security-reviewer      │  injection, authz, secrets, validation, crypto
│  sr-production-safety      │  rolling deploy, migrations, idempotency, blast radius, observability
└─────────────────────────────┘
        │  (findings, one severity scale)
        ▼
sr-synthesis  →  deduped, scope-checked, ranked plan (Critical → Low) + merge verdict
```

## Conventions

- **Scope snapshots** — the orchestrator diffs once into filtered views (source /
  tests / config); each reviewer sees only the slice it can act on. Docs and generated
  files are stripped to names. Small diffs are reviewed inline with no fan-out at all.
- **Scope discipline** — reviewers report only what *this change* causes or endangers;
  pre-existing issues nearby are out of scope. Synthesis drops the rest.
- **Severity** — every finding is Critical / High / Medium / Low + a confidence.
- **Reports, never edits** — this toolkit advises; it does not change code.
- Agents are prefixed `sr-` so they coexist with any other review plugins installed.

## Licence

MIT
