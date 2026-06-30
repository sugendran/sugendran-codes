# sugendran-skeptics — design

**A Claude Code Stop hook that runs an opencode skeptic (GLM-5.2 via Ollama Cloud) against the code Claude just wrote, and feeds Claude-actionable counter-views back in — advisory, once, fail-safe.**

It is **separate** from `sugendran-reviews`. Skeptics fires *in the loop* while Claude
codes; `sugendran-reviews` is the deep pass *at PR time*. Because both apply the same
review lenses, skeptics catches issues early — so by PR review there is little or nothing
left. **That overlap is the point.**

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
| Posture | **Advisory** — inject findings once per change-set, no enforced loop |
| Skeptic model | `glm-5.2` via **Ollama Cloud** (non-Claude lineage = genuine counter-view) |
| Output | **Claude-actionable** structured JSON → terse action list injected to Claude |
| Build | One focused fail-safe gate script + small tested libs + prompt/schema data |
| Scope reviewed | Claude's **uncommitted working-tree diff** only |
| Manual escape hatch | `/sugendran-skeptics` command + `SKEPTICS_DISABLE=1` env |

---

## How it runs

```
Claude finishes a turn ──▶ Stop hook ──▶ scripts/skeptic-gate.mjs
                                   │
   ┌───────────────────────────────┴────────────────────────────────┐
   │ 1. stop_hook_active? / SKEPTICS_DISABLE? ───────────▶ exit 0 ✓   │
   │ 2. Collect uncommitted diff (git diff HEAD + untracked)         │
   │ 3. No reviewable code, or diff-hash already reviewed ─▶ exit 0 ✓ │  (no-nag)
   │ 4. Diff over size ceiling? ─▶ stat-only fallback view           │
   │ 5. opencode run --format json -m ollama/glm-5.2 <skeptic prompt>│  (read-only, timeout)
   │ 6. Parse NDJSON event stream ▶ final JSON {verdict, findings[]} │
   └───────────────────────────────┬────────────────────────────────┘
                                   │
   verdict=approve  OR  no findings ≥ threshold  OR  ANY error/timeout
                                   └──────────────▶ exit 0 ✓   (FAIL OPEN — never wedge)
                                   │
   material findings (first time for this diff-hash)
                                   └──────────────▶ {"decision":"block",
                                                      "reason": <action list for Claude>}
                                                    record diff-hash so it won't re-fire
```

`block` is the *only* channel a Stop hook has to hand text to Claude; it costs one extra
turn. Advisory = we use it **once per change-set** and the no-nag record stops it firing
again. (A future "blocking gate" mode would simply re-fire until findings clear.)

---

## File layout

```
plugins/sugendran-skeptics/
  .claude-plugin/plugin.json
  hooks/hooks.json                  # registers the Stop hook → skeptic-gate.mjs
  scripts/skeptic-gate.mjs          # single entry point (orchestrates the steps above)
  scripts/lib/
    config.mjs    # load/merge config + env; thresholds, model, caps, on/off
    diff.mjs      # collect working-tree diff; size; stat-only fallback; hash; defensive I/O
    prompt.mjs    # interpolate prompts/skeptic.md with the diff blob
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
   nothing. Inject a given finding-set at most once. No skeptic-vs-Claude argument loop.
3. **Bounded.** Wall-clock timeout on the opencode call; diff-size ceiling with stat-only
   fallback (stolen from codex). The gate cannot run long or embed a giant prompt.
4. **Targeted.** Reviews only Claude's working-tree changes, pre-collected into one blob.
   opencode runs read-only and never re-reads the repo. This is the snappiness.
5. **Grounded + calibrated prompt.** "Break confidence, invent nothing, one strong finding
   over many weak, return empty findings if the change is fine." Calibration is what keeps
   it quiet on good code and drives the PR-time review toward zero.
6. **Claude-actionable + escape hatches.** Strict JSON schema; the injected `reason` is a
   terse machine-derived action list (file:line · severity · why · fix), not human prose.
   `SKEPTICS_DISABLE=1`, `stop_hook_active`, a config file, and the manual command all keep
   the user in control.

---

## Skeptic prompt (in `prompts/skeptic.md`)

Adapts codex's adversarial framing; attack surface mirrors `sugendran-reviews` lenses so
the two converge:

- **Role/stance:** "You are a skeptic reviewing code an AI just wrote. Your job is to break
  confidence in it, not validate it. Default to skepticism; no credit for good intent."
- **Attack surface:** correctness/logic bugs · silent/swallowed failures · auth & trust
  boundaries · data loss/corruption/idempotency · rollback & migration safety · races &
  ordering · empty/null/timeout/degraded-dependency paths · schema/version skew ·
  observability gaps · type/interface design.
- **Finding bar:** material only. No style/naming/nits. Each finding answers: what breaks,
  why this path is vulnerable, likely impact, the concrete fix.
- **Grounding:** every finding defensible from the supplied diff; invent no files/lines/
  paths; state inferences honestly; keep confidence calibrated.
- **Calibration:** prefer one strong finding over several weak; if it's safe, return
  `verdict:"approve"` with empty `findings`.
- **Output contract:** return **only** JSON matching the schema below — no prose, no fence.
- When the diff is in stat-only fallback mode, a `{{COLLECTION_GUIDANCE}}` block tells the
  model it has stats + file list, not full hunks, and to scope its certainty accordingly.

---

## Output schema (`schemas/skeptic-output.schema.json`)

```json
{
  "verdict": "approve | needs-attention",
  "summary": "string",
  "findings": [
    {
      "severity": "critical | high | medium | low",
      "title": "string",
      "file": "string",
      "line_start": "integer",
      "line_end": "integer",
      "confidence": "number 0..1",
      "why": "string",
      "fix": "string"
    }
  ]
}
```

`decision.mjs` validates this, drops findings below the configured
`min_severity` / `min_confidence`, and only injects if any survive.

---

## Config + escape hatches

`config.mjs` merges, in order: built-in defaults → optional repo `.sugendran-skeptics.json`
→ environment. Keys:

| Key | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` | master on/off (`SKEPTICS_DISABLE=1` forces off) |
| `model` | `ollama/glm-5.2` | opencode model id for the skeptic |
| `timeout_ms` | `90000` | wall-clock cap on the opencode call |
| `max_diff_bytes` | `262144` | above this → stat-only fallback |
| `min_severity` | `medium` | drop findings below this |
| `min_confidence` | `0.6` | drop findings below this |
| `paths_ignore` | lockfiles, generated, vendored | never reviewed |

---

## Ollama Cloud wiring — first implementation step (verify before building)

Confirmed dead ends: OpenCode Zen (401 no payment), GitHub Copilot (403 unlicensed),
Google key (missing). **Ollama Cloud + GLM-5.2 is the chosen path.** Exact opencode↔Ollama
wiring is unconfirmed and must be verified first:

- Either local `ollama` signed in to cloud (`ollama signin`) serving `glm-5.2`, with
  opencode's `ollama` provider pointed at `http://localhost:11434`; or
- A custom opencode provider (OpenAI-compatible) against `ollama.com` with `OLLAMA_API_KEY`.

**Verification:** one-line probe must return a parseable final JSON:
`opencode run --format json -m ollama/glm-5.2 'reply only: {"verdict":"approve","findings":[]}'`
The exact model id (`glm-5.2` vs a cloud-tagged variant) is pinned here once confirmed.

---

## Failure-mode matrix (all fail open)

| Situation | Behaviour |
| --- | --- |
| `opencode` not on PATH | exit 0, breadcrumb "opencode unavailable" |
| Ollama Cloud unreachable / auth error | exit 0, breadcrumb with provider error |
| Call exceeds `timeout_ms` | kill child, exit 0, breadcrumb "timeout" |
| Output not valid JSON / fails schema | exit 0, breadcrumb "unparseable" |
| Empty / non-code diff | exit 0, silent |
| Diff-hash already reviewed | exit 0, silent (no-nag) |
| `verdict:approve` or all findings sub-threshold | exit 0, silent |
| Material findings, first time | `block` + action-list reason; record hash |

---

## Manual command (`/sugendran-skeptics`)

- `/sugendran-skeptics` — run the gate now against the working tree; print findings.
- `/sugendran-skeptics off` / `on` — toggle `enabled` in repo config.
- Shares the exact same engine as the hook (no logic duplication).

---

## Testing & manual QA

**Unit (per lib, fast, no network):**
- `diff.mjs`: empty tree, untracked file, broken symlink, directory, over-ceiling → fallback, stable hash.
- `opencode.mjs`: parse a captured NDJSON fixture → final JSON; timeout path; non-JSON → error.
- `decision.mjs`: threshold filtering; schema-invalid → fail open; valid findings → correct `block` shape.
- `config.mjs`: defaults < file < env precedence; `SKEPTICS_DISABLE`.
- `state.mjs`: same hash twice → second is no-op.

**Manual QA (the team runs these):**
- [ ] Install: `claude plugin validate ./plugins/sugendran-skeptics`; confirm Stop hook registered.
- [ ] **Flawed change** — write a function that swallows an error; finish the turn; skeptic injects a `medium`+ finding pointing at the right `file:line`.
- [ ] **Clean change** — make a trivial correct edit; finish the turn; skeptic stays silent (verdict approve, exit 0).
- [ ] **No-nag** — finish a second turn without changing code; no second injection for the same diff.
- [ ] **Fail open** — set `model` to a bogus id; finish a turn; turn completes normally, breadcrumb logged, no wedge.
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

1. **Advisory mechanism** — OK that "advisory" = one soft `block` per change-set (the only
   way to feed Claude)? Or do you want pure non-blocking (file + user notice, manual pull)?
2. **Spec location** — kept at `docs/superpowers/specs/`; move into the plugin dir instead?
3. **Skeptic model id** — `ollama/glm-5.2` assumed; confirm against your Ollama Cloud setup.
