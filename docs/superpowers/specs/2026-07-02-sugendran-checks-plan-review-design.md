# sugendran-checks: plan review — design

**Add a `review-plan` skill to `sugendran-checks` so that, before Claude presents a plan or design for the user's approval, it runs the plan through the opencode skeptic (a different model) and revises for material assumptions, gaps, and risks first.**

Extends the merged `sugendran-checks` plugin (which reviews code *diffs* via a Stop hook). This adds a review of *plans*. Both share the same philosophy — challenge unverified assumptions — and the same opencode/config/fail-open machinery.

## Why a skill, not a hook

Claude Code plan-mode transitions bypass the hooks system today: `ExitPlanMode` does **not** fire `PreToolUse`, and `PermissionRequest[ExitPlanMode]` can only auto-approve/deny the dialog — it cannot feed feedback back to Claude to revise. (Open feature requests exist for `PrePlanMode`/`PostPlanMode`.) So plan review can't be force-run by a hook; it is a **skill** Claude invokes as planning discipline, relying on the skill-check convention already in use here.

---

## Decisions locked

| Decision | Choice |
| --- | --- |
| Mechanism | A plugin **skill** (`sugendran-checks:review-plan`), not a hook |
| Trigger | Skill `description` fires it before presenting a plan/design for approval (plan mode *and* brainstorming/writing-plans designs) |
| Posture | **Advisory** — Claude incorporates material feedback by judgement; no forced loop (a skill can't loop); at most one or two rounds |
| Input | The plan/design text, piped to the script via **stdin** |
| Model | The user's opencode default (no `-m`) — same as the code path |
| Reused | `lib/opencode.mjs`, `lib/config.mjs`, `lib/decision.mjs` (`coerceJson`, `filterItems`, `SEVERITY_RANK`), breadcrumb log |
| New | `skills/review-plan/SKILL.md`, `scripts/plan-review.mjs`, `scripts/lib/plan.mjs`, `prompts/plan.md`, `schemas/plan-output.schema.json` |
| Config | Reuses `./.sugendran-checks.json` (`enabled`/`CHECKS_DISABLE`, `timeoutMs`, `minSeverity`, `minConfidence`) |
| Version | bump plugin `0.1.0 → 0.2.0` (new feature, released) |

---

## How it runs

```
Claude has a plan ready (plan mode, or a brainstorming/writing-plans design)
   │  review-plan skill description triggers before asking for approval
   ▼
Claude runs:  node "${CLAUDE_PLUGIN_ROOT}/scripts/plan-review.mjs"   (plan via stdin)
   │  loadConfig → disabled/empty? → print note, exit 0
   │  buildPlanPrompt(template, plan) → opencode run --format json (user's default; timeout)
   │  parse NDJSON → validatePlanOutput → filterItems(threshold)
   ▼
prints ONE of:
   • "Plan review — no material concerns."            (approve / all filtered)
   • a findings list (assumptions / gaps / risks)      (needs-attention)
   • "Plan review unavailable (<reason>) — proceeding." (opencode error/timeout/disabled → FAIL OPEN)
   ▼
Claude reads it → resolves / revises for material findings (or judges them acceptable) → presents plan to user
```

The script **always exits 0** and only ever prints advice; it can never stall planning.

---

## File layout

```
plugins/sugendran-checks/
  skills/review-plan/SKILL.md          # NEW — triggers + tells Claude the steps
  scripts/plan-review.mjs              # NEW — runPlanReview(plan, deps) + stdin CLI
  scripts/plan-review.test.mjs         # NEW
  scripts/lib/plan.mjs                 # NEW — validatePlanOutput, buildPlanPrompt, formatPlanFindings
  scripts/lib/plan.test.mjs            # NEW
  scripts/lib/log.mjs                  # NEW — extracted breadcrumb log (fileLog/logFilePath)
  scripts/lib/log.test.mjs             # NEW
  prompts/plan.md                      # NEW — plan-review prompt template
  schemas/plan-output.schema.json      # NEW
  scripts/checks-gate.mjs              # MODIFIED — import fileLog from lib/log.mjs (was inline)
  .claude-plugin/plugin.json           # MODIFIED — version 0.2.0
  README.md                            # MODIFIED — add a "Plan review" section (new section, not the Install block)
  scripts/lib/{opencode,config,decision}.mjs   # REUSED unchanged
```

---

## The `review-plan` skill (`skills/review-plan/SKILL.md`)

Frontmatter `description` (drives auto-invocation):

> Use this skill before presenting a plan or design to the user for approval — e.g. before calling `ExitPlanMode`, or before asking the user to approve a brainstorming/writing-plans design. It sends the plan to the sugendran-checks opencode skeptic (a different model) for a critique of unverified assumptions, gaps, and risks, so the plan can be revised before approval.

Body instructs Claude to:
1. Write the full plan text to a temp file and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/plan-review.mjs" < <tempfile>` (stdin).
2. Read the output. If it lists material findings, resolve each — verify the assumption, close the gap, or explicitly judge it acceptable — and revise the plan.
3. If it says "no material concerns" or "proceeding without plan review", continue.
4. Then present the (revised) plan for approval.
5. Advisory: incorporate by judgement; do not loop more than once or twice.

---

## `plan-review.mjs`

- `export async function runPlanReview(planText, deps) → string` (the text to show Claude). Dependency-injected (`loadConfig`, `readTemplate`, `runOpencode`, `coerceJson`, `validatePlanOutput`, `filterItems`, `formatPlanFindings`, `log`) so it is unit-testable with no real opencode.
- Logic (all wrapped; any throw → return the fail-open note):
  1. `config = loadConfig()`. If `!config.enabled` → return `"sugendran-checks plan review is disabled."`.
  2. If `planText` is empty/whitespace → return `"No plan text provided."`.
  3. `prompt = buildPlanPrompt(readTemplate(), planText)`.
  4. `result = await runOpencode({ prompt, cwd, timeoutMs: config.timeoutMs })`. If `!result.ok` → log + return `"Plan review unavailable (${result.error}) — proceeding without it."`.
  5. `parsed = validatePlanOutput(coerceJson(result.text))`. If `!parsed.ok` → log + return `"Plan review unavailable (unparseable) — proceeding without it."`.
  6. `kept = filterItems(parsed.value.items, config)`. If empty → return `"Plan review — no material concerns."`.
  7. return `formatPlanFindings(kept)`.
- CLI wrapper: read all of stdin → `runPlanReview(stdin, realDeps())` → `process.stdout.write(text)` → `process.exit(0)`. Reuses the same stdin-read safety timeout pattern as the gate. `realDeps()` reads `prompts/plan.md` and logs via `lib/log.mjs`.

---

## Plan-review prompt (`prompts/plan.md`)

Skeptic lens for a **plan**, not a diff:

- **Role:** "You are a skeptic reviewing a plan an AI wrote, before it is shown to a human for approval. Challenge it; do not validate it."
- **Lenses:** (1) *Unverified assumptions* — what the plan assumes about the domain, the requirement, existing code/APIs/data that isn't confirmed; (2) *Gaps* — unhandled edge cases, error paths, migration/rollback, tests, and missing verification steps; (3) *Risks* — ordering/dependency hazards, or where the plan may not actually achieve its stated goal.
- **Bar:** material only; no style/wording nits. If the plan is sound, return `verdict:"approve"` with empty `items`.
- **Grounding/calibration:** defensible from the plan text; invent nothing; one strong finding over many weak.
- **Output:** return ONLY JSON matching the schema — no prose, no fence. Placeholder `{{PLAN}}` holds the plan text.

---

## Output schema (`schemas/plan-output.schema.json`)

```json
{
  "verdict": "approve | needs-attention",
  "summary": "string",
  "items": [
    {
      "kind": "assumption | gap | risk",
      "severity": "critical | high | medium | low",
      "confidence": "number 0..1",
      "assumption": "the unverified assumption (when kind=assumption)",
      "problem": "the concern / what's missing or risky",
      "verify": "the concrete thing to check, add, or decide"
    }
  ]
}
```

Note: plan items have **no `file`/`line`** (a plan isn't a diff).

---

## `plan.mjs`

- `buildPlanPrompt(template, planText) → string` — replaces `{{PLAN}}`.
- `validatePlanOutput(obj) → { ok, value?, error? }` — like `decision.validateOutput` but `kind ∈ {assumption, gap, risk}`, **no `file` requirement**, coerces `confidence`/`assumption`/`problem`/`verify` to safe defaults. Rejects bad verdict / non-array items; drops malformed items.
- `formatPlanFindings(items) → string` — a preamble plus one line per item, e.g. `- [high] (assumption) <assumption or problem> → address: <verify>`. No file:line.
- Reuses `SEVERITY_RANK` and `filterItems` from the existing modules (plan items carry `severity`, `confidence`, and `assumption`/`problem`, which is what `filterItems` needs — no `file` dependency in the filter).

---

## Config

Reuses `./.sugendran-checks.json` and `CHECKS_DISABLE` — no new keys. Disabling checks disables plan review too. `minSeverity`/`minConfidence` filter plan findings the same way they filter code findings.

---

## Fail-open matrix (all print a note + exit 0)

| Situation | Output |
| --- | --- |
| `enabled:false` / `CHECKS_DISABLE=1` | "sugendran-checks plan review is disabled." |
| empty plan on stdin | "No plan text provided." |
| opencode unavailable / timeout | "Plan review unavailable (<reason>) — proceeding without it." |
| output not valid JSON / schema | "Plan review unavailable (unparseable) — proceeding without it." |
| verdict approve / all items sub-threshold | "Plan review — no material concerns." |
| material findings | the findings list |

---

## Shared breadcrumb log

The `fileLog`/`logFilePath` helper currently inline in `checks-gate.mjs` moves to `scripts/lib/log.mjs` (same behaviour, same `~/.cache/sugendran-checks/checks.log` path). `checks-gate.mjs` imports it (no behaviour change; its tests inject their own `log`, so they still pass). `plan-review.mjs` uses it to record `plan-review invoked` and the outcome, so plan reviews are as diagnosable as the hook.

---

## Testing & QA

**Unit (fast, no network):**
- `plan.mjs`: `buildPlanPrompt` interpolation; `validatePlanOutput` keeps valid `{assumption,gap,risk}` items, rejects bad verdict, coerces missing fields, requires no `file`; `formatPlanFindings` renders a readable list.
- `plan-review.mjs`: with stubbed deps — findings path, no-concerns path, opencode-unavailable → fail-open note + no throw, disabled → note, empty plan → note. Every path returns a string and never throws.
- `log.mjs`: writes a stamped line; caps at the size limit; never throws.
- Re-run the full suite — `checks-gate` tests still green after the `log.mjs` extraction.

**Manual QA:**
- [ ] `claude plugin validate ./plugins/sugendran-checks` passes and reports the new skill.
- [ ] Pipe a deliberately assumption-heavy plan into `plan-review.mjs` (real opencode) → get assumption/gap findings; a sound plan → "no material concerns".
- [ ] Bogus model / `CHECKS_DISABLE=1` → fail-open note, exit 0.
- [ ] In a plan-mode session with the plugin installed, confirm Claude invokes `review-plan` before presenting a plan and revises for material findings.

---

## Out of scope (future)

- **Enforced plan gate** — when Claude Code ships `PrePlanMode`/`PostPlanMode` hooks (or `PreToolUse[ExitPlanMode]` with feedback), move this to a hook so it's automatic and can loop until clean. The engine here is reusable.
- Any change to the code Stop-hook behaviour.
