# sugendran-skeptics — design

**A Claude Code Stop hook that runs an opencode skeptic (the user's own opencode default model — GLM-5.2 for Sugendran) against the business logic Claude just wrote, and challenges it — *are we doing the right thing, or just assuming it's right?* Counter-views feed back Claude-actionable: advisory, once, fail-safe.**

It is **separate** from `sugendran-reviews` and deliberately **narrow**. Skeptics fires *in
the loop* while Claude codes, and engages only when **business logic** changes: it surfaces
the assumptions baked into the change and the logic bugs hiding in it. `sugendran-reviews`
stays the broad deep pass *at PR time* (deploy safety, type/API design, test design,
security threat-model). Skeptics clears the **assumption-and-bug layer** early so PR review
is left with the architectural judgement calls that genuinely need PR context.
**Complementary, not redundant.**

Inspired by `openai/codex-plugin-cc` (its adversarial prompt + diff-sizing). **Not copied** —
we need none of its broker/jobs/session machinery, because `opencode run --format json` is
a single synchronous structured call.

---

## Decisions locked

| Decision | Choice |
| --- | --- |
| Plugin name | `sugendran-skeptics` |
| Relationship to `sugendran-reviews` | 100% separate, no coupling |
| Trigger | Claude Code **Stop hook** (Claude finished its turn) |
| Posture | **Advisory** — inject findings once per change-set via non-blocking `additionalContext`, no enforced loop |
| Focus | **Unverified assumptions (primary)** + **logic bugs (secondary)**, on **business-logic changes** only |
| Out of scope | security threat-model · deploy/prod safety · type/API design · deep test analysis · style — all deferred to `sugendran-reviews` |
| Intent grounding | last user request (from the hook's `transcript_path`) fed in, so it can weigh "right thing" vs "assumed" |
| Skeptic model | **User's opencode default** — the plugin never passes `-m`. Prompt tuned against `glm-5.2` (Sugendran's default); a non-Claude default is recommended for a genuine counter-view |
| Output | **Claude-actionable** structured JSON → terse action list injected to Claude |
| Build | One focused fail-safe gate script + small tested libs + prompt/schema data |
| Scope reviewed | business-logic changes within Claude's **uncommitted working-tree diff** |
| Manual escape hatch | `/sugendran-skeptics` command + `SKEPTICS_DISABLE=1` env |

---

## How it runs

```
Claude finishes a turn ──▶ Stop hook ──▶ scripts/skeptic-gate.mjs
   │
   │ 1. stop_hook_active? / SKEPTICS_DISABLE?               ──▶ exit 0 ✓   (off)
   │ 2. Collect uncommitted diff (git diff HEAD + untracked)
   │ 3. No reviewable code, or diff-hash already reviewed   ──▶ exit 0 ✓   (no-nag)
   │ 4. Diff over size ceiling?  ─▶ stat-only fallback view
   │ 5. opencode run --format json  (prompt+diff piped via stdin)  (user's default model; timeout)
   │ 6. Parse NDJSON `text` events ─▶ final JSON {verdict, items[]}
   ▼
 verdict=approve  OR  no items ≥ threshold  OR  any error/timeout  ──▶ exit 0 ✓   (FAIL OPEN — never wedge)
 material items (first time for this diff-hash)                    ──▶ additionalContext =
                                                                        verify-or-fix list (non-blocking)
                                                                       then record diff-hash so it won't re-fire
```

A Stop hook hands text to Claude **without blocking** via
`hookSpecificOutput.additionalContext` — Claude sees the findings but is not forced to keep
working. That is exactly "advisory". The no-nag record means a given item-set is injected at
most once. (A future "blocking gate" mode would instead use `{"decision":"block","reason":…}`
to re-fire until items clear; `stop_hook_active` guards against loops there.)

---

## File layout

```
plugins/sugendran-skeptics/
  .claude-plugin/plugin.json
  hooks/hooks.json                  # registers the Stop hook → skeptic-gate.mjs
  scripts/skeptic-gate.mjs          # single entry point (orchestrates the steps above)
  scripts/lib/
    config.mjs    # load/merge config + env; thresholds, caps, on/off (no model — opencode owns that)
    diff.mjs      # collect working-tree diff; size; stat-only fallback; hash; defensive I/O
    intent.mjs    # read transcript_path → last user request (fail-open if absent)
    prompt.mjs    # interpolate prompts/skeptic.md with the diff blob + intent
    opencode.mjs  # spawn opencode run; timeout; capture; parse NDJSON → final message
    decision.mjs  # validate against schema; filter by threshold; build Stop-hook output
    state.mjs     # per-session no-nag record of reviewed diff-hashes
  prompts/skeptic.md                # adversarial prompt template
  schemas/skeptic-output.schema.json
  commands/sugendran-skeptics.md    # manual run + on/off toggle
  README.md
```

Each lib is one small, independently testable unit. The gate script wires them and owns
the fail-open guarantee.

---

## Six tenets (non-negotiable)

1. **Fail open, always.** Any failure — opencode missing, Ollama Cloud unreachable,
   timeout, unparseable output, malformed/empty diff — exits 0 and allows the turn to end,
   leaving a one-line breadcrumb in a log. A reviewer must *never* trap the session.
2. **No-nag / idempotent.** Hash the reviewed diff; if unchanged since the last gate, do
   nothing. Inject a given item-set at most once. No skeptic-vs-Claude argument loop.
3. **Bounded.** Wall-clock timeout on the opencode call; diff-size ceiling with stat-only
   fallback (stolen from codex). The gate cannot run long or embed a giant prompt.
4. **Targeted.** Reviews only Claude's working-tree changes, pre-collected into one blob,
   and engages only where **business logic** changed. opencode runs read-only and never
   re-reads the repo. This is the snappiness.
5. **Grounded + calibrated prompt.** "Break confidence, invent nothing, one strong challenge
   over many weak, return no items if the logic is sound." Calibration is what keeps it quiet
   on good code and drives the assumption-and-bug layer toward zero by PR time.
6. **Claude-actionable + escape hatches.** Strict JSON schema; the injected `additionalContext`
   is a terse machine-derived action list (file:line · kind · problem · verify), not human prose.
   `SKEPTICS_DISABLE=1`, `stop_hook_active`, a config file, and the manual command all keep
   the user in control.

---

## Skeptic prompt (in `prompts/skeptic.md`)

Adapts codex's adversarial framing, but **narrowed to business logic**:

- **Role/stance:** "You are a skeptic reviewing business logic an AI just wrote. You didn't
  write it — read it cold. Your job is to find where it *assumes* the right behaviour
  instead of *knowing* it. Challenge; don't validate. No credit for good intent."
- **Intent grounding:** "Here is what this change was asked to do: `{{INTENT}}`. Judge the
  logic against that, not just against itself." (Omitted cleanly if no intent available.)
- **Primary lens — unverified assumptions:** for each business-logic change, name the
  assumption it bakes in — about the domain rule, the requirement, the data shape, an
  external API's behaviour, or an invariant — and ask: *verified or guessed? the right
  rule?* This is the headline output.
- **Secondary lens — logic bugs:** once the intent is granted, is the rule still wrong —
  inverted condition, off-by-one, mishandled null/empty/boundary, happy-path-only?
- **Scope gate:** engage only where business/domain behaviour changes. Ignore pure
  refactors, renames, plumbing, formatting, config, imports. If nothing here changes
  business behaviour, return `verdict:"approve"` with empty `items`.
- **Finding bar:** material only. No style/naming/nits.
- **Grounding:** every challenge defensible from the supplied diff/intent; invent no
  files/lines/paths/behaviour; state inferences honestly; calibrate confidence.
- **Calibration:** one strong challenge beats five weak; if the logic is sound, say so and
  return no items.
- **Output contract:** return **only** JSON matching the schema below — no prose, no fence.
- When the diff is in stat-only fallback mode, a `{{COLLECTION_GUIDANCE}}` block tells the
  model it has stats + file list, not full hunks, and to scope its certainty accordingly.

*The prompt is calibrated against GLM-5.2 (Sugendran's default); the `opencode run` invocation
itself stays model-agnostic, so any user's default model gets the same instructions.*

---

## Output schema (`schemas/skeptic-output.schema.json`)

```json
{
  "verdict": "approve | needs-attention",
  "summary": "string",
  "items": [
    {
      "kind": "assumption | logic-bug",
      "severity": "critical | high | medium | low",
      "confidence": "number 0..1",
      "file": "string",
      "line_start": "integer",
      "line_end": "integer",
      "assumption": "the unverified assumption the change bakes in (kind=assumption)",
      "problem": "why it may be the wrong rule / where the logic breaks",
      "verify": "the concrete thing Claude should check to confirm or fix"
    }
  ]
}
```

`decision.mjs` validates this, drops items below the configured
`min_severity` / `min_confidence`, and only injects if any survive. The injected
`additionalContext` reads as a verify-or-fix action list — e.g. *"src/pricing.ts:42 — assumes
discount ≤ price; not enforced. Verify the business rule or clamp it."*

---

## Config + escape hatches

`config.mjs` merges, in order: built-in defaults → optional repo `.sugendran-skeptics.json`
→ environment. Keys:

| Key | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` | master on/off (`SKEPTICS_DISABLE=1` forces off) |
| `timeout_ms` | `90000` | wall-clock cap on the opencode call |
| `max_diff_bytes` | `262144` | above this → stat-only fallback |
| `min_severity` | `medium` | drop items below this |
| `min_confidence` | `0.6` | drop items below this |
| `paths_ignore` | lockfiles, generated, vendored | never reviewed |

**No `model` key by design.** The plugin runs `opencode run` with no `-m`, so opencode uses
the user's configured default. Choosing the skeptic model (ideally non-Claude) is the user's
job, set in opencode's own config — not the plugin's.

---

## Model selection & first verification step

**The plugin does not choose a model.** It runs `opencode run` with no `-m`, so opencode
uses the user's configured default. Picking a model — and a non-Claude one for a genuine
counter-view — is the user's responsibility, set in opencode's own config.

Sugendran's default is **GLM-5.2 via Ollama Cloud**, and the prompt is tuned against it.
(Other providers were dead ends when probed: OpenCode Zen 401 no-payment, GitHub Copilot
403 unlicensed, Google key missing.)

**Verify before building** — the user's default must return a parseable final JSON event:
`opencode run --format json 'reply only with this and nothing else: {"verdict":"approve","items":[]}'`
Confirm Sugendran's Ollama-Cloud default is the active one (local `ollama signin` proxy, or a
custom opencode provider against `ollama.com`).

---

## Failure-mode matrix (all fail open)

| Situation | Behaviour |
| --- | --- |
| `opencode` not on PATH | exit 0, breadcrumb "opencode unavailable" |
| model/provider unreachable or auth error | exit 0, breadcrumb with provider error |
| Call exceeds `timeout_ms` | kill child, exit 0, breadcrumb "timeout" |
| Output not valid JSON / fails schema | exit 0, breadcrumb "unparseable" |
| Empty / non-code diff | exit 0, silent |
| `transcript_path` missing/unreadable | proceed without intent grounding (don't fail) |
| Diff-hash already reviewed | exit 0, silent (no-nag) |
| `verdict:approve` / no business-logic change / all items sub-threshold | exit 0, silent |
| Material items, first time | `additionalContext` = verify-or-fix list (non-blocking); record hash |

---

## Manual command (`/sugendran-skeptics`)

- `/sugendran-skeptics` — run the gate now against the working tree; print findings.
- `/sugendran-skeptics off` / `on` — toggle `enabled` in repo config.
- Shares the exact same engine as the hook (no logic duplication).

---

## Testing & manual QA

**Unit (per lib, fast, no network):**
- `diff.mjs`: empty tree, untracked file, broken symlink, directory, over-ceiling → fallback, stable hash.
- `intent.mjs`: transcript with user turns → last user ask; missing/garbled file → null (no throw).
- `opencode.mjs`: parse a captured NDJSON fixture → final JSON; timeout path; non-JSON → error.
- `decision.mjs`: threshold filtering; schema-invalid → fail open; valid items → correct `block` shape.
- `config.mjs`: defaults < file < env precedence; `SKEPTICS_DISABLE`.
- `state.mjs`: same hash twice → second is no-op.

**Manual QA (the team runs these):**
- [ ] Install: `claude plugin validate ./plugins/sugendran-skeptics`; confirm Stop hook registered.
- [ ] **Assumption challenge** — change a business rule that bakes in an unverified assumption (e.g. apply a discount without checking it can't exceed the price); finish the turn; skeptic raises an `assumption` item at the right `file:line` asking what was verified.
- [ ] **Logic bug** — introduce an inverted condition / off-by-one / mishandled-empty case in domain logic; skeptic raises a `logic-bug` item.
- [ ] **Pure refactor** — rename a variable or move a function with no behaviour change; skeptic stays silent (verdict approve, exit 0).
- [ ] **No-nag** — finish a second turn without changing code; no second injection for the same diff.
- [ ] **Fail open** — temporarily point your opencode default at a bogus model id (or make the provider unreachable); finish a turn; turn completes normally, breadcrumb logged, no wedge.
- [ ] **Large diff** — generate a >256 KB diff; gate falls back to stat-only and completes within `timeout_ms`.
- [ ] **Disable** — `SKEPTICS_DISABLE=1`; finish a turn; gate is a no-op.
- [ ] **Manual** — `/sugendran-skeptics` prints current findings on demand.

---

## Out of scope (future)

- **Blocking gate mode** — re-fire until findings clear (enforced convergence). Add once the
  advisory prompt + parsing + Ollama wiring are trusted.
- `SubagentStop` coverage for delegated coding.
- Cross-session shared state / metrics.
- Human-readable report output (this plugin is Claude-facing by design).

---

## Open questions for review

1. **Advisory mechanism — resolved.** Uses `hookSpecificOutput.additionalContext` (genuine
   non-blocking; Claude sees the findings, isn't forced to continue). No `block` in v1.
2. **Spec location** — kept at `docs/superpowers/specs/`; move into the plugin dir instead?
3. **Model — resolved.** Plugin passes no `-m`; uses the user's opencode default (Sugendran:
   GLM-5.2 via Ollama Cloud). Build step 1 verifies that default returns parseable JSON.
