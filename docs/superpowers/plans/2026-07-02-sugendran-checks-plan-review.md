# sugendran-checks Plan Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `review-plan` skill to the `sugendran-checks` plugin so that, before Claude presents a plan/design for approval, it runs the plan through the opencode skeptic and revises for unverified assumptions, gaps, and risks first.

**Architecture:** A new `scripts/plan-review.mjs` reads the plan from stdin, sends it to `opencode run --format json` (via the existing `lib/opencode.mjs`, using the user's default model) with a plan-review prompt, parses/filters the findings, and prints advisory text for Claude. A `skills/review-plan/SKILL.md` triggers Claude to run it before presenting a plan. It reuses `lib/config.mjs` and `lib/decision.mjs` (`coerceJson`, `filterItems`, `SEVERITY_RANK`); the breadcrumb log is extracted to a shared `lib/log.mjs` used by both the existing gate and the new script.

**Tech Stack:** Node ≥ 18, ES modules (`.mjs`), zero runtime dependencies. Tests: `node --test` with `node:assert/strict`. Plugin already exists (merged) at `plugins/sugendran-checks/`.

## Global Constraints

- **Fail-open, always.** `runPlanReview` wraps its whole body in try/catch and returns an advisory string; the CLI always `process.exit(0)`. It must never stall planning — worst case it's a silent no-op and Claude presents the plan unchanged.
- **No model flag.** `opencode run --format json` is invoked with **no `-m`** (reuses the user's opencode default). Prompt+plan go via **stdin** (reuse `lib/opencode.mjs`).
- **Advisory only.** The script only ever prints text; there is no blocking and no loop.
- **Zero deps.** Node built-ins only. Tests use `node:test` + `node:assert/strict`. ES modules throughout.
- **Reuse, don't fork.** Reuse `loadConfig`, `runOpencode`, `coerceJson`, `filterItems`, `SEVERITY_RANK` unchanged. `filterItems` filters on `severity`, `confidence`, and `(it.assumption || it.problem)` — it does NOT require a `file`, so plan items work with it.
- **Plan items have no `file`/`line`** (a plan is not a diff). `kind ∈ {assumption, gap, risk}`.
- **Config:** reuses `./.sugendran-checks.json` and `CHECKS_DISABLE`; no new keys.
- **Australian English** in user-facing copy. Command/skill frontmatter `description` avoids an unquoted colon-space.
- **Commits:** small, atomic, one per task; message references this plan and ends with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FaU6mNY39hSeeKFpwHa29W
  ```
- **Must pass** `claude plugin validate ./plugins/sugendran-checks` and the full `node --test` suite at the end.
- **Version:** bump `plugins/sugendran-checks/.claude-plugin/plugin.json` `0.1.0 → 0.2.0`.

### File structure

```
plugins/sugendran-checks/
  scripts/lib/log.mjs              # NEW  fileLog + logFilePath (extracted from checks-gate.mjs)
  scripts/lib/log.test.mjs         # NEW
  scripts/lib/plan.mjs             # NEW  buildPlanPrompt, validatePlanOutput, formatPlanFindings
  scripts/lib/plan.test.mjs        # NEW
  scripts/plan-review.mjs          # NEW  runPlanReview(plan, deps) + stdin CLI
  scripts/plan-review.test.mjs     # NEW
  prompts/plan.md                  # NEW  plan-review prompt template
  schemas/plan-output.schema.json  # NEW
  skills/review-plan/SKILL.md      # NEW  triggers Claude before plan approval
  scripts/checks-gate.mjs          # MODIFIED  import fileLog from lib/log.mjs (drop inline copy)
  .claude-plugin/plugin.json       # MODIFIED  version 0.2.0
  README.md                        # MODIFIED  add a "Plan review" section (new section)
  scripts/lib/{opencode,config,decision}.mjs   # REUSED unchanged
```

---

## Task 1: Extract the breadcrumb log to `lib/log.mjs`

**Files:**
- Create: `plugins/sugendran-checks/scripts/lib/log.mjs`
- Test: `plugins/sugendran-checks/scripts/lib/log.test.mjs`
- Modify: `plugins/sugendran-checks/scripts/checks-gate.mjs` (use the extracted `fileLog`)

**Interfaces:**
- Produces:
  - `logFilePath() → string` (`~/.cache/sugendran-checks/checks.log`)
  - `fileLog(line:string, { path?, now? } = {}) → void` (append a timestamped line; truncate past 256 KB; never throws). `path`/`now` are injectable for tests.

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/log.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileLog, logFilePath } from './log.mjs';

test('logFilePath points under ~/.cache/sugendran-checks/checks.log', () => {
  assert.match(logFilePath(), /sugendran-checks[/\\]checks\.log$/);
});

test('fileLog appends stamped lines', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'log-')), 'checks.log');
  fileLog('hello', { path: p, now: () => 'T0' });
  fileLog('world', { path: p, now: () => 'T1' });
  assert.equal(readFileSync(p, 'utf8'), 'T0 hello\nT1 world\n');
});

test('fileLog never throws on an unwritable path', () => {
  assert.doesNotThrow(() => fileLog('x', { path: '/dev/null/nope/checks.log', now: () => 'T' }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/sugendran-checks && node --test scripts/lib/log.test.mjs`
Expected: FAIL — cannot find module `./log.mjs`.

- [ ] **Step 3: Write `scripts/lib/log.mjs`**

```js
// scripts/lib/log.mjs
import { appendFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export function logFilePath() {
  return join(homedir(), '.cache', 'sugendran-checks', 'checks.log');
}

export function fileLog(line, { path = logFilePath(), now = () => new Date().toISOString() } = {}) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const stamped = `${now()} ${line}\n`;
    let size = 0;
    try { size = statSync(path).size; } catch { size = 0; }
    if (size > 262144) writeFileSync(path, stamped);
    else appendFileSync(path, stamped);
  } catch { /* never throw from logging */ }
}
```

- [ ] **Step 4: Rewire `checks-gate.mjs` to use it**

In `plugins/sugendran-checks/scripts/checks-gate.mjs`:
1. Change the `node:fs` import to only what's still used, and drop `node:os`:
   - FROM: `import { readFileSync, appendFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';`
   - TO:   `import { readFileSync } from 'node:fs';`
   - Remove the line `import { homedir } from 'node:os';`
2. Add: `import { fileLog } from './lib/log.mjs';`
3. Delete the inline `function logFilePath() {…}` and `function fileLog(line) {…}` definitions.
4. Leave `realDeps().log` calling `fileLog(line)` exactly as before (the call site is unchanged; only the definition moved).

- [ ] **Step 5: Run tests to verify**

Run: `cd plugins/sugendran-checks && node --test scripts/lib/log.test.mjs && node --test scripts/checks-gate.test.mjs`
Expected: both PASS (gate tests inject their own `log`, so they are unaffected by the move).

- [ ] **Step 6: Commit**

```bash
git add plugins/sugendran-checks/scripts/lib/log.mjs plugins/sugendran-checks/scripts/lib/log.test.mjs plugins/sugendran-checks/scripts/checks-gate.mjs
git commit -m "refactor(checks): extract breadcrumb log to lib/log.mjs (plan Task 1)"
```

---

## Task 2: `lib/plan.mjs` — plan prompt, validation, formatting

**Files:**
- Create: `plugins/sugendran-checks/scripts/lib/plan.mjs`
- Test: `plugins/sugendran-checks/scripts/lib/plan.test.mjs`

**Interfaces:**
- Consumes: `SEVERITY_RANK` from `./config.mjs`.
- Produces:
  - `buildPlanPrompt(template:string, planText:string) → string`
  - `validatePlanOutput(obj) → { ok:boolean, value?:{verdict,summary,items[]}, error? }` (kinds `assumption|gap|risk`; no `file` required)
  - `formatPlanFindings(items) → string`

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/plan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanPrompt, validatePlanOutput, formatPlanFindings } from './plan.mjs';

test('buildPlanPrompt interpolates {{PLAN}} (all occurrences)', () => {
  assert.equal(buildPlanPrompt('A {{PLAN}} B {{PLAN}}', 'X'), 'A X B X');
});

test('validatePlanOutput keeps assumption/gap/risk items and needs no file', () => {
  const r = validatePlanOutput({ verdict: 'needs-attention', items: [
    { kind: 'assumption', severity: 'high', confidence: 0.8, assumption: 'a', verify: 'check' },
    { kind: 'gap', severity: 'medium', confidence: 0.7, problem: 'no rollback', verify: 'add rollback' },
    { kind: 'risk', severity: 'low', confidence: 0.5, problem: 'ordering', verify: 'reorder' },
    { kind: 'logic-bug', severity: 'high' },
    'x',
  ]});
  assert.equal(r.ok, true);
  assert.equal(r.value.items.length, 3);
  assert.equal(r.value.items[0].confidence, 0.8);
});

test('validatePlanOutput rejects bad verdict and non-array items', () => {
  assert.equal(validatePlanOutput({ verdict: 'lgtm', items: [] }).ok, false);
  assert.equal(validatePlanOutput({ verdict: 'approve', items: 'x' }).ok, false);
  assert.equal(validatePlanOutput(null).ok, false);
});

test('formatPlanFindings renders readable lines with no file:line', () => {
  const out = formatPlanFindings([
    { kind: 'assumption', severity: 'high', confidence: 0.9, assumption: 'X is true', problem: '', verify: 'confirm X' },
    { kind: 'gap', severity: 'medium', confidence: 0.7, assumption: '', problem: 'no tests', verify: 'add tests' },
  ]);
  assert.match(out, /\[high\] \(assumption\) X is true → address: confirm X/);
  assert.match(out, /\[medium\] \(gap\) no tests → address: add tests/);
  assert.doesNotMatch(out, /:\d+/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/plan.test.mjs`
Expected: FAIL — cannot find module `./plan.mjs`.

- [ ] **Step 3: Write `scripts/lib/plan.mjs`**

```js
// scripts/lib/plan.mjs
import { SEVERITY_RANK } from './config.mjs';

const VERDICTS = new Set(['approve', 'needs-attention']);
const KINDS = new Set(['assumption', 'gap', 'risk']);

export function buildPlanPrompt(template, planText) {
  return template.replaceAll('{{PLAN}}', planText);
}

export function validatePlanOutput(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not an object' };
  if (!VERDICTS.has(obj.verdict)) return { ok: false, error: 'bad verdict' };
  if (!Array.isArray(obj.items)) return { ok: false, error: 'items not an array' };
  const items = [];
  for (const it of obj.items) {
    if (!it || typeof it !== 'object') continue;
    if (!KINDS.has(it.kind)) continue;
    if (SEVERITY_RANK[it.severity] === undefined) continue;
    items.push({
      kind: it.kind,
      severity: it.severity,
      confidence: Number.isFinite(it.confidence) ? it.confidence : 0,
      assumption: typeof it.assumption === 'string' ? it.assumption : '',
      problem: typeof it.problem === 'string' ? it.problem : '',
      verify: typeof it.verify === 'string' ? it.verify : '',
    });
  }
  return { ok: true, value: { verdict: obj.verdict, summary: String(obj.summary || ''), items } };
}

export function formatPlanFindings(items) {
  const lines = items.map((it) => {
    const what = it.kind === 'assumption' ? (it.assumption || it.problem) : (it.problem || it.assumption);
    return `- [${it.severity}] (${it.kind}) ${what} → address: ${it.verify}`;
  });
  return [
    'sugendran-checks reviewed this plan with a second model and raised these before you present it. Resolve or consciously accept each, then revise the plan:',
    ...lines,
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/plan.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/sugendran-checks/scripts/lib/plan.mjs plugins/sugendran-checks/scripts/lib/plan.test.mjs
git commit -m "feat(checks): plan prompt builder, output validation and formatting (plan Task 2)"
```

---

## Task 3: `plan-review.mjs` + prompt + schema

**Files:**
- Create: `plugins/sugendran-checks/scripts/plan-review.mjs`
- Test: `plugins/sugendran-checks/scripts/plan-review.test.mjs`
- Create: `plugins/sugendran-checks/prompts/plan.md`
- Create: `plugins/sugendran-checks/schemas/plan-output.schema.json`

**Interfaces:**
- Consumes: `loadConfig` (`config.mjs`), `runOpencode` (`opencode.mjs`), `coerceJson` + `filterItems` (`decision.mjs`), `buildPlanPrompt` + `validatePlanOutput` + `formatPlanFindings` (`plan.mjs`), `fileLog` (`log.mjs`).
- Produces:
  - `runPlanReview(planText:string, deps) → Promise<string>` — the advisory text to show Claude. DI so tests use no real opencode.
  - `realDeps() → deps`.
  - CLI: read the plan from stdin → `runPlanReview` → print → `exit 0`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/plan-review.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPlanReview } from './plan-review.mjs';

const FINDING = '{"verdict":"needs-attention","items":[{"kind":"assumption","severity":"high","confidence":0.9,"assumption":"X","problem":"","verify":"confirm X"}]}';

function baseDeps(over = {}) {
  return {
    loadConfig: () => ({ enabled: true, timeoutMs: 100, minSeverity: 'medium', minConfidence: 0.6 }),
    readTemplate: () => 'TEMPLATE {{PLAN}}',
    buildPlanPrompt: (t, p) => t.replace('{{PLAN}}', p),
    runOpencode: async () => ({ ok: true, text: FINDING }),
    coerceJson: (t) => JSON.parse(t),
    validatePlanOutput: (o) => ({ ok: true, value: { verdict: o.verdict, summary: '', items: o.items } }),
    filterItems: (items) => items,
    formatPlanFindings: (items) => `FINDINGS:${items.length}`,
    log: () => {},
    ...over,
  };
}

test('findings path returns formatted findings', async () => {
  assert.equal(await runPlanReview('a plan', baseDeps()), 'FINDINGS:1');
});

test('disabled → note', async () => {
  assert.match(await runPlanReview('p', baseDeps({ loadConfig: () => ({ enabled: false }) })), /disabled/);
});

test('empty plan → note', async () => {
  assert.match(await runPlanReview('   ', baseDeps()), /No plan text/);
});

test('opencode unavailable → fail-open note', async () => {
  const out = await runPlanReview('p', baseDeps({ runOpencode: async () => ({ ok: false, error: 'opencode unavailable' }) }));
  assert.match(out, /unavailable.*proceeding/i);
});

test('unparseable → fail-open note', async () => {
  const out = await runPlanReview('p', baseDeps({ validatePlanOutput: () => ({ ok: false, error: 'bad' }) }));
  assert.match(out, /unavailable.*proceeding/i);
});

test('no surviving items → no material concerns', async () => {
  assert.match(await runPlanReview('p', baseDeps({ filterItems: () => [] })), /no material concerns/i);
});

test('a throwing dep fails open (never throws)', async () => {
  const out = await runPlanReview('p', baseDeps({ buildPlanPrompt: () => { throw new Error('boom'); } }));
  assert.match(out, /unavailable.*proceeding/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/plan-review.test.mjs`
Expected: FAIL — cannot find module `./plan-review.mjs`.

- [ ] **Step 3: Write `scripts/plan-review.mjs`**

```js
// scripts/plan-review.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './lib/config.mjs';
import { runOpencode } from './lib/opencode.mjs';
import { coerceJson, filterItems } from './lib/decision.mjs';
import { buildPlanPrompt, validatePlanOutput, formatPlanFindings } from './lib/plan.mjs';
import { fileLog } from './lib/log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function realDeps() {
  return {
    loadConfig, runOpencode, coerceJson, filterItems,
    buildPlanPrompt, validatePlanOutput, formatPlanFindings,
    readTemplate: () => readFileSync(join(HERE, '..', 'prompts', 'plan.md'), 'utf8'),
    log: (msg) => {
      const line = `[sugendran-checks] ${msg}`;
      try { process.stderr.write(`${line}\n`); } catch { /* ignore */ }
      fileLog(line);
    },
  };
}

export async function runPlanReview(planText, deps) {
  try {
    const config = deps.loadConfig(process.env, process.cwd());
    if (!config.enabled) return 'sugendran-checks plan review is disabled.';
    if (!planText || !planText.trim()) return 'No plan text provided.';

    const prompt = deps.buildPlanPrompt(deps.readTemplate(), planText);
    const result = await deps.runOpencode({ prompt, cwd: process.cwd(), timeoutMs: config.timeoutMs });
    if (!result.ok) {
      deps.log(`plan-review skipped: ${result.error}`);
      return `Plan review unavailable (${result.error}) — proceeding without it.`;
    }

    const parsed = deps.validatePlanOutput(deps.coerceJson(result.text));
    if (!parsed.ok) {
      deps.log(`plan-review unparseable: ${parsed.error}`);
      return 'Plan review unavailable (unparseable) — proceeding without it.';
    }

    const kept = deps.filterItems(parsed.value.items, config);
    if (!kept.length) return 'Plan review — no material concerns.';
    return deps.formatPlanFindings(kept);
  } catch (err) {
    try { deps.log(`plan-review fail-open: ${err?.message || err}`); } catch { /* ignore */ }
    return 'Plan review unavailable (error) — proceeding without it.';
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (d) => { data += d; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    setTimeout(() => resolve(data), 2000); // safety: never hang
  });
}

async function main() {
  const deps = realDeps();
  deps.log('plan-review invoked');
  const planText = await readStdin();
  const out = await runPlanReview(planText, deps);
  const outcome = /no material concerns/i.test(out) ? 'no-concerns'
    : /(unavailable|disabled|No plan text)/i.test(out) ? 'skipped'
    : 'findings';
  deps.log(`plan-review result: ${outcome}`);
  process.stdout.write(out + '\n');
  process.exit(0);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/plan-review.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Write `prompts/plan.md`**

```markdown
You are a skeptic reviewing a PLAN an AI assistant wrote, before it is shown to a human for approval. You did not write it — read it cold. Your job is to find where the plan ASSUMES it is right instead of KNOWING it, and where it is incomplete or risky. Challenge it; do not validate it.

Review the plan through three lenses:
1. Unverified assumptions — what does the plan assume about the domain, the requirement, the existing code, external APIs, or the data that has not been confirmed? Would the plan break if an assumption is wrong?
2. Gaps — unhandled edge cases, error and failure paths, data migration or rollback, tests, and missing verification steps (how will anyone know it actually worked?).
3. Risks — ordering and dependency hazards, and places where the plan may not actually achieve its stated goal.

Rules:
- Material findings only. No wording, formatting, or style nits.
- Every finding must be defensible from the plan text below. Invent nothing. Keep confidence honest.
- Prefer one strong finding over several weak ones. If the plan is sound, return verdict "approve" with an empty items array.

Return ONLY a JSON object — no prose, no code fence — matching exactly:
{"verdict":"approve|needs-attention","summary":"one sentence","items":[{"kind":"assumption|gap|risk","severity":"critical|high|medium|low","confidence":0.0,"assumption":"the unverified assumption (when kind=assumption)","problem":"the concern / what is missing or risky","verify":"the concrete thing to check, add, or decide"}]}

The plan to review:
{{PLAN}}
```

- [ ] **Step 6: Write `schemas/plan-output.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "sugendran-checks plan-review output",
  "type": "object",
  "required": ["verdict", "items"],
  "properties": {
    "verdict": { "enum": ["approve", "needs-attention"] },
    "summary": { "type": "string" },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["kind", "severity", "confidence"],
        "properties": {
          "kind": { "enum": ["assumption", "gap", "risk"] },
          "severity": { "enum": ["critical", "high", "medium", "low"] },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "assumption": { "type": "string" },
          "problem": { "type": "string" },
          "verify": { "type": "string" }
        }
      }
    }
  }
}
```

- [ ] **Step 7: Confirm the schema is valid JSON**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('plugins/sugendran-checks/schemas/plan-output.schema.json','utf8')); console.log('schema OK')"` (from repo root)
Expected: `schema OK`.

- [ ] **Step 8: Commit**

```bash
git add plugins/sugendran-checks/scripts/plan-review.mjs plugins/sugendran-checks/scripts/plan-review.test.mjs plugins/sugendran-checks/prompts/plan.md plugins/sugendran-checks/schemas/plan-output.schema.json
git commit -m "feat(checks): plan-review script, prompt and output schema (plan Task 3)"
```

---

## Task 4: `review-plan` skill, version bump, README & final checks

**Files:**
- Create: `plugins/sugendran-checks/skills/review-plan/SKILL.md`
- Modify: `plugins/sugendran-checks/.claude-plugin/plugin.json` (version `0.2.0`)
- Modify: `plugins/sugendran-checks/README.md` (add a "Plan review" section)

**Interfaces:**
- Produces: the user-facing trigger (skill) + docs. No code.

- [ ] **Step 1: Write `skills/review-plan/SKILL.md`**

````markdown
---
name: review-plan
description: Use before presenting a plan or design to the user for approval — e.g. before calling ExitPlanMode, or before asking the user to approve a brainstorming/writing-plans design. Sends the plan to the sugendran-checks opencode skeptic (a different model) for a critique of unverified assumptions, gaps, and risks, so the plan can be revised before approval.
---

# review-plan

When you have a plan or design ready and are about to ask the user to approve it, get a second-model critique first.

1. Put the full plan/design text through the skeptic on stdin. If the plan already exists as a file (e.g. a written spec/plan doc), pipe that file; otherwise write the plan text to a temporary file first:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/plan-review.mjs" < /path/to/plan.md
   ```

2. Read the output:
   - A findings list (assumptions / gaps / risks) → treat each as something to resolve: verify the assumption, close the gap, or make a conscious decision that it is acceptable — and revise the plan accordingly.
   - `Plan review — no material concerns.` → continue.
   - `Plan review unavailable … proceeding without it.` or `… disabled.` → the skeptic could not run; continue.

3. Then present the (revised) plan to the user for approval.

This is advisory — incorporate material feedback using your judgement, and do not loop more than once or twice.
````

- [ ] **Step 2: Bump the plugin version**

In `plugins/sugendran-checks/.claude-plugin/plugin.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

- [ ] **Step 3: Add a "Plan review" section to `plugins/sugendran-checks/README.md`**

Append this section (do not modify the existing Install/Configuration sections):

```markdown
## Plan review

Beyond the code Stop hook, the plugin ships a **`review-plan` skill**. Before Claude presents a plan or design for your approval, it runs the plan through the same opencode skeptic — critiquing its unverified assumptions, gaps (missing edge cases, error handling, migration/rollback, tests, verification), and risks — so Claude can revise before asking you to approve.

Because Claude Code has no plan-mode hook, this is a skill Claude invokes as planning discipline (not an enforced hook). It is advisory and fail-open: if opencode is unavailable or `CHECKS_DISABLE=1`, the plan is presented unchanged.

Normally you don't run it yourself — the skill does. To try it directly, pipe plan text on stdin into the plugin's `scripts/plan-review.mjs`; it prints the findings (or a "no material concerns" / "unavailable" note) and always exits 0.
```

- [ ] **Step 4: Validate the plugin**

Run: `claude plugin validate ./plugins/sugendran-checks` (from repo root)
Expected: passes, and reports the new `review-plan` skill.

- [ ] **Step 5: Run the full test suite**

Run: `cd plugins/sugendran-checks && npm test`
Expected: all tests PASS (existing gate/lib tests + new log/plan/plan-review tests), output pristine.

- [ ] **Step 6: Commit**

```bash
git add plugins/sugendran-checks/skills/review-plan/SKILL.md plugins/sugendran-checks/.claude-plugin/plugin.json plugins/sugendran-checks/README.md
git commit -m "feat(checks): review-plan skill, docs and 0.2.0 bump (plan Task 4)"
```

---

## Manual QA (after Task 4)

- [ ] `claude plugin validate ./plugins/sugendran-checks` → passes, lists the `review-plan` skill.
- [ ] `printf 'Plan: apply a discount by multiplying price by (1 - discount). Steps: 1) update pricing.ts.' | node plugins/sugendran-checks/scripts/plan-review.mjs` → returns assumption/gap findings (real opencode) within `timeoutMs`.
- [ ] A sound, thorough plan → `Plan review — no material concerns.`
- [ ] `CHECKS_DISABLE=1 … | node … plan-review.mjs` → `sugendran-checks plan review is disabled.`, exit 0.
- [ ] Point opencode at a bogus model → `Plan review unavailable (…) — proceeding without it.`, exit 0; breadcrumb appears in `~/.cache/sugendran-checks/checks.log`.
- [ ] In a plan-mode session with the plugin installed, Claude invokes `review-plan` before presenting a plan and revises for material findings.
```
