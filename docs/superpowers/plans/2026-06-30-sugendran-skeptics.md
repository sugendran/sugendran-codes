# sugendran-skeptics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Claude Code plugin whose Stop hook runs an opencode second-model "skeptic" over the business-logic Claude just changed, and feeds back — non-blocking — a terse, Claude-actionable list of unverified assumptions and logic bugs.

**Architecture:** A single fail-safe entry point (`scripts/skeptic-gate.mjs`) orchestrates six small, independently-tested libs (config, diff, intent, prompt, opencode, decision, state). The gate reads the Stop-hook JSON on stdin, collects the working-tree diff, pipes a skeptic prompt + diff to `opencode run --format json` via **stdin**, parses the NDJSON `text` events, filters findings by threshold, and emits `hookSpecificOutput.additionalContext` (non-blocking) — or `{}`. Every failure path returns `{}` and exits 0 so the hook can never wedge a session.

**Tech Stack:** Node ≥ 18 (verified v24.13.1), ES modules (`.mjs`), zero runtime dependencies. Tests use the built-in runner (`node --test`) with `node:assert/strict`. The skeptic model is **not** chosen by the plugin — `opencode run` is invoked with no `-m`, using the user's own opencode default (GLM-5.2 via Ollama Cloud for Sugendran).

## Global Constraints

- **Fail open, always.** `runGate` wraps its whole body in try/catch and returns `{}`; the CLI always `process.exit(0)`. A hook failure must never block Claude.
- **No model flag.** Invoke `opencode run --format json` with **no `-m`**; the prompt+diff go via **stdin** (avoids ARG_MAX). The prompt is tuned for GLM-5.2 but the call is model-agnostic.
- **Advisory, non-blocking.** v1 uses `hookSpecificOutput.additionalContext` only — never `decision:"block"`. Honour `stop_hook_active` (return `{}`) and `SKEPTICS_DISABLE=1`.
- **No-nag.** Record reviewed diff hashes per `session_id` under `os.tmpdir()`; never review the same diff twice, never re-inject the same finding-set.
- **Zero deps.** No npm installs. Only Node built-ins (`node:fs`, `node:child_process`, `node:crypto`, `node:os`, `node:path`, `node:url`, `node:test`).
- **Plugin/skill/command names:** kebab-case. Command frontmatter `description` is quoted (colon-space breaks the YAML parser).
- **marketplace.json `source`** must be the explicit relative path `./plugins/sugendran-skeptics`.
- **Australian English** in all user-facing copy.
- **Commits:** small and atomic, one per task. Message references this plan (`docs/superpowers/plans/2026-06-30-sugendran-skeptics.md`, Task N) and ends with the repo trailers:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FaU6mNY39hSeeKFpwHa29W
  ```
- **Must pass** `claude plugin validate ./plugins/sugendran-skeptics` after Task 1 and at the end.

### Verified facts (don't re-derive)

- **Stop-hook stdin:** `{ session_id, transcript_path, cwd, hook_event_name:"Stop", stop_hook_active }`. `stop_hook_active===true` ⇒ a prior Stop hook already continued Claude — do not act again.
- **Non-blocking output (exit 0):** `{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"<text Claude sees>"}}`. Allow-silently: `{}`. (Blocking — *not used in v1* — is `{"decision":"block","reason":"…"}`.)
- **Plugin hook registration:** `hooks/hooks.json`; Stop takes **no matcher**; command may use `${CLAUDE_PLUGIN_ROOT}`.
- **opencode `--format json`** emits NDJSON, one event per line. The answer is in `type:"text"` events at `.part.text` (concatenate in order). A `type:"error"` event means failure. Confirmed real success stream:
  ```
  {"type":"step_start","part":{"type":"step-start"}}
  {"type":"text","part":{"type":"text","text":"{\"verdict\":\"approve\",\"items\":[]}"}}
  {"type":"step_finish","part":{"reason":"stop"}}
  ```
- **transcript JSONL:** user turns are lines with `type:"user"` and `message.content` that is a **string** (or an array of blocks; human text is in `type:"text"` blocks).

### File structure

```
plugins/sugendran-skeptics/
  .claude-plugin/plugin.json
  package.json
  hooks/hooks.json
  prompts/skeptic.md
  schemas/skeptic-output.schema.json
  commands/sugendran-skeptics.md
  scripts/skeptic-gate.mjs            # entry point: runGate(input, deps) + CLI + --manual
  scripts/skeptic-gate.test.mjs
  scripts/lib/config.mjs              # loadConfig, SEVERITY_RANK
  scripts/lib/config.test.mjs
  scripts/lib/state.mjs               # makeState{has,record}, defaultStateDir
  scripts/lib/state.test.mjs
  scripts/lib/diff.mjs                # collectDiff, hashText, defaultRunGit, defaultReadFileSafe
  scripts/lib/diff.test.mjs
  scripts/lib/intent.mjs              # readIntent, extractUserText
  scripts/lib/intent.test.mjs
  scripts/lib/prompt.mjs              # buildPrompt
  scripts/lib/prompt.test.mjs
  scripts/lib/opencode.mjs            # parseOpencodeStream, runOpencode, defaultSpawn
  scripts/lib/opencode.test.mjs
  scripts/lib/decision.mjs            # coerceJson, validateOutput, filterItems, formatAdditionalContext, decide, buildHookOutput
  scripts/lib/decision.test.mjs
  README.md
```

---

## Task 1: Plugin scaffold, manifest & marketplace registration

**Files:**
- Create: `plugins/sugendran-skeptics/.claude-plugin/plugin.json`
- Create: `plugins/sugendran-skeptics/package.json`
- Create: `plugins/sugendran-skeptics/README.md`
- Modify: `.claude-plugin/marketplace.json` (add the plugin entry)
- Modify: `README.md` (repo root — add a table row)

**Interfaces:**
- Produces: an installable, validatable plugin shell. No code yet.

- [ ] **Step 1: Write `plugin.json`**

```json
{
  "name": "sugendran-skeptics",
  "description": "Adversarial business-logic skeptic. A Stop hook runs an opencode second-model review of the change Claude just wrote and feeds back unverified assumptions and logic bugs.",
  "version": "0.1.0"
}
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "sugendran-skeptics",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "opencode skeptic gate for Claude Code",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 3: Write a `README.md` skeleton**

```markdown
# sugendran-skeptics

A Claude Code Stop hook that runs a **second-model skeptic** (via the [opencode](https://opencode.ai) CLI) over the business logic Claude just wrote, and asks the question Claude can't ask itself: *are we doing the right thing, or just assuming it's right?*

It is separate from `sugendran-reviews` (the deep PR-time pass). Skeptics runs **in the loop**, advisory and non-blocking, and only engages when **business logic** changes.

## Install

```bash
/plugin marketplace add sugendran/sugendran-codes
/plugin install sugendran-skeptics@sugendran-codes
```

## Model

The plugin runs `opencode run` with **no `-m`** — it uses *your* opencode default model. Set that to a non-Claude model for a genuine counter-view (Sugendran uses GLM-5.2 via Ollama Cloud).

## How it works

On every Stop, the hook diffs your working tree, sends it to the skeptic, and — if the skeptic finds a material unverified assumption or logic bug — injects a terse action list back to Claude via `additionalContext`. Anything that goes wrong (opencode missing, timeout, unparseable) silently allows the turn to finish.

## Manual use

```bash
/sugendran-skeptics          # review the working tree now
/sugendran-skeptics off      # disable for this repo
/sugendran-skeptics on       # re-enable
```
```

- [ ] **Step 4: Register in `.claude-plugin/marketplace.json`**

Add to the `plugins` array (after the `sugendran-reviews` entry):

```json
    {
      "name": "sugendran-skeptics",
      "source": "./plugins/sugendran-skeptics",
      "description": "Adversarial opencode skeptic that reviews business-logic changes via a Stop hook."
    }
```

- [ ] **Step 5: Add a row to the repo root `README.md` table**

Read the existing plugins table and add a row consistent with its columns, e.g.:

```markdown
| sugendran-skeptics | Stop-hook opencode skeptic that challenges business-logic changes (assumptions + logic bugs). |
```

- [ ] **Step 6: Validate**

Run: `claude plugin validate ./plugins/sugendran-skeptics`
Expected: validation passes (no errors). A warning about no hooks/commands yet is acceptable.

- [ ] **Step 7: Commit**

```bash
git add plugins/sugendran-skeptics/.claude-plugin/plugin.json \
        plugins/sugendran-skeptics/package.json \
        plugins/sugendran-skeptics/README.md \
        .claude-plugin/marketplace.json README.md
git commit -m "feat(skeptics): scaffold plugin, manifest and marketplace entry (plan Task 1)"
```

---

## Task 2: `config.mjs` — configuration loading

**Files:**
- Create: `plugins/sugendran-skeptics/scripts/lib/config.mjs`
- Test: `plugins/sugendran-skeptics/scripts/lib/config.test.mjs`

**Interfaces:**
- Produces:
  - `loadConfig(env = process.env, cwd = process.cwd()) → { enabled:boolean, timeoutMs:number, maxDiffBytes:number, minSeverity:string, minConfidence:number, pathsIgnore:string[] }`
  - `SEVERITY_RANK = { low:1, medium:2, high:3, critical:4 }`

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, SEVERITY_RANK } from './config.mjs';

test('defaults when no file and no env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const cfg = loadConfig({}, dir);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.timeoutMs, 90000);
  assert.equal(cfg.minSeverity, 'medium');
  assert.equal(cfg.minConfidence, 0.6);
  assert.ok(Array.isArray(cfg.pathsIgnore));
});

test('SKEPTICS_DISABLE=1 forces enabled false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  assert.equal(loadConfig({ SKEPTICS_DISABLE: '1' }, dir).enabled, false);
});

test('repo file overrides defaults; env wins over file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  writeFileSync(join(dir, '.sugendran-skeptics.json'),
    JSON.stringify({ enabled: true, timeoutMs: 1234, minSeverity: 'high' }));
  const cfg = loadConfig({ SKEPTICS_DISABLE: 'true' }, dir);
  assert.equal(cfg.timeoutMs, 1234);
  assert.equal(cfg.minSeverity, 'high');
  assert.equal(cfg.enabled, false); // env override
});

test('garbage in file is ignored, not thrown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  writeFileSync(join(dir, '.sugendran-skeptics.json'), 'not json {');
  assert.equal(loadConfig({}, dir).timeoutMs, 90000);
  assert.equal(SEVERITY_RANK.critical, 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/sugendran-skeptics && node --test scripts/lib/config.test.mjs`
Expected: FAIL — cannot find module `./config.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/config.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

const DEFAULTS = {
  enabled: true,
  timeoutMs: 90000,
  maxDiffBytes: 262144,
  minSeverity: 'medium',
  minConfidence: 0.6,
  pathsIgnore: [
    'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    '*.min.js', '*.map', 'dist/*', 'build/*', 'vendor/*',
  ],
};

function sanitise(obj) {
  const out = {};
  if (typeof obj.enabled === 'boolean') out.enabled = obj.enabled;
  if (Number.isFinite(obj.timeoutMs)) out.timeoutMs = obj.timeoutMs;
  if (Number.isFinite(obj.maxDiffBytes)) out.maxDiffBytes = obj.maxDiffBytes;
  if (typeof obj.minSeverity === 'string' && SEVERITY_RANK[obj.minSeverity]) out.minSeverity = obj.minSeverity;
  if (Number.isFinite(obj.minConfidence)) out.minConfidence = obj.minConfidence;
  if (Array.isArray(obj.pathsIgnore)) out.pathsIgnore = obj.pathsIgnore.filter((p) => typeof p === 'string');
  return out;
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(readFileSync(join(cwd, '.sugendran-skeptics.json'), 'utf8'));
  } catch {
    fileCfg = {};
  }
  const cfg = { ...DEFAULTS, ...sanitise(fileCfg) };
  if (env.SKEPTICS_DISABLE === '1' || env.SKEPTICS_DISABLE === 'true') cfg.enabled = false;
  return cfg;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/config.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/sugendran-skeptics/scripts/lib/config.mjs plugins/sugendran-skeptics/scripts/lib/config.test.mjs
git commit -m "feat(skeptics): config loading with file + env precedence (plan Task 2)"
```

---

## Task 3: `state.mjs` — per-session no-nag record

**Files:**
- Create: `plugins/sugendran-skeptics/scripts/lib/state.mjs`
- Test: `plugins/sugendran-skeptics/scripts/lib/state.test.mjs`

**Interfaces:**
- Produces:
  - `defaultStateDir() → string` (under `os.tmpdir()`)
  - `makeState({ dir }) → { has(sessionId, hash):boolean, record(sessionId, hash):void }`

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/state.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeState } from './state.mjs';

test('has is false before record, true after', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'));
  const s = makeState({ dir });
  assert.equal(s.has('sess1', 'abc'), false);
  s.record('sess1', 'abc');
  assert.equal(s.has('sess1', 'abc'), true);
  assert.equal(s.has('sess1', 'other'), false);
  assert.equal(s.has('sess2', 'abc'), false); // session-scoped
});

test('corrupt state file → has returns false, no throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sess1.json'), 'broken{');
  const s = makeState({ dir });
  assert.equal(s.has('sess1', 'abc'), false);
  s.record('sess1', 'abc'); // recovers
  assert.equal(s.has('sess1', 'abc'), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/state.test.mjs`
Expected: FAIL — cannot find module `./state.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/state.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function defaultStateDir() {
  return join(tmpdir(), 'sugendran-skeptics');
}

function safe(id) {
  return String(id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function makeState({ dir = defaultStateDir() } = {}) {
  const fileFor = (sessionId) => join(dir, `${safe(sessionId)}.json`);
  const read = (sessionId) => {
    try {
      const set = JSON.parse(readFileSync(fileFor(sessionId), 'utf8'));
      return Array.isArray(set) ? set : [];
    } catch {
      return [];
    }
  };
  return {
    has(sessionId, hash) {
      return read(sessionId).includes(hash);
    },
    record(sessionId, hash) {
      try {
        mkdirSync(dir, { recursive: true });
        const set = read(sessionId);
        if (!set.includes(hash)) set.push(hash);
        writeFileSync(fileFor(sessionId), JSON.stringify(set.slice(-100)));
      } catch {
        /* fail open: best-effort */
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/state.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/sugendran-skeptics/scripts/lib/state.mjs plugins/sugendran-skeptics/scripts/lib/state.test.mjs
git commit -m "feat(skeptics): per-session no-nag state store (plan Task 3)"
```

---

## Task 4: `diff.mjs` — collect & size the working-tree diff

**Files:**
- Create: `plugins/sugendran-skeptics/scripts/lib/diff.mjs`
- Test: `plugins/sugendran-skeptics/scripts/lib/diff.test.mjs`

**Interfaces:**
- Produces:
  - `hashText(text:string) → string`
  - `defaultRunGit(cwd:string) → (args:string[]) => string`
  - `defaultReadFileSafe(absPath:string) → { ok:boolean, content?:string }`
  - `collectDiff({ cwd, maxBytes, pathsIgnore, runGit, readFileSafe }) → { mode:'empty'|'full'|'stat', text:string, files:string[], hash:string, bytes:number }`
- Consumes (in tests): a fake `runGit(args)` returning canned stdout, and a fake `readFileSafe`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/diff.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectDiff, hashText } from './diff.mjs';

const TRACKED = `diff --git a/src/pricing.ts b/src/pricing.ts
--- a/src/pricing.ts
+++ b/src/pricing.ts
@@ -1,3 +1,3 @@
-const total = price;
+const total = price - discount;
`;

function fakeGit(map) {
  return (args) => {
    const key = args.join(' ');
    for (const [prefix, value] of Object.entries(map)) {
      if (key.startsWith(prefix)) return value;
    }
    return '';
  };
}

test('empty when no changes', () => {
  const r = collectDiff({ cwd: '/x', maxBytes: 1000, pathsIgnore: [],
    runGit: fakeGit({}), readFileSafe: () => ({ ok: false }) });
  assert.equal(r.mode, 'empty');
  assert.equal(r.text, '');
});

test('full mode includes tracked diff + untracked content, stable hash', () => {
  const git = fakeGit({ 'diff HEAD --no-color': TRACKED, 'ls-files': 'src/new.ts\n' });
  const read = (p) => ({ ok: true, content: p.endsWith('new.ts') ? 'export const x = 1;\n' : '' });
  const r = collectDiff({ cwd: '/x', maxBytes: 100000, pathsIgnore: [], runGit: git, readFileSafe: read });
  assert.equal(r.mode, 'full');
  assert.match(r.text, /price - discount/);
  assert.match(r.text, /new file: src\/new.ts/);
  assert.ok(r.files.includes('src/pricing.ts'));
  assert.ok(r.files.includes('src/new.ts'));
  assert.equal(r.hash, hashText(r.text));
});

test('over-ceiling falls back to stat mode', () => {
  const big = 'x'.repeat(5000);
  const git = fakeGit({ 'diff HEAD --no-color': `+++ b/a.ts\n${big}`, 'diff HEAD --stat': ' a.ts | 200 ++\n', 'ls-files': '' });
  const r = collectDiff({ cwd: '/x', maxBytes: 1000, pathsIgnore: [], runGit: git, readFileSafe: () => ({ ok: false }) });
  assert.equal(r.mode, 'stat');
  assert.match(r.text, /summary only/);
});

test('unreadable untracked file is skipped', () => {
  const git = fakeGit({ 'ls-files': 'broken.bin\n' });
  const r = collectDiff({ cwd: '/x', maxBytes: 1000, pathsIgnore: [], runGit: git, readFileSafe: () => ({ ok: false }) });
  assert.equal(r.mode, 'empty');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/diff.test.mjs`
Expected: FAIL — cannot find module `./diff.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/diff.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function hashText(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function defaultRunGit(cwd) {
  return (args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function defaultReadFileSafe(absPath) {
  try {
    const st = statSync(absPath);
    if (!st.isFile()) return { ok: false };
    if (st.size > 65536) return { ok: true, content: `(file ${st.size} bytes — too large to inline)\n` };
    const content = readFileSync(absPath, 'utf8');
    if (content.includes('\u0000')) return { ok: false }; // binary (NUL byte)
    return { ok: true, content };
  } catch {
    return { ok: false };
  }
}

function filesFromDiff(diff) {
  const out = [];
  for (const line of diff.split('\n')) {
    const m = line.match(/^\+\+\+ b\/(.+)$/);
    if (m && m[1] !== '/dev/null') out.push(m[1]);
  }
  return out;
}

export function collectDiff({ cwd, maxBytes, pathsIgnore = [], runGit, readFileSafe = defaultReadFileSafe }) {
  const git = runGit || defaultRunGit(cwd);
  const excludes = pathsIgnore.map((p) => `:(exclude)${p}`);
  const safeGit = (args) => { try { return git(args); } catch { return ''; } };

  const tracked = safeGit(['diff', 'HEAD', '--no-color', '--', '.', ...excludes]).trim();
  const untrackedList = safeGit(['ls-files', '--others', '--exclude-standard', '--', '.', ...excludes])
    .split('\n').map((s) => s.trim()).filter(Boolean);

  const untrackedSections = [];
  for (const rel of untrackedList) {
    const r = readFileSafe(join(cwd, rel));
    if (r.ok) untrackedSections.push(`### new file: ${rel}\n${r.content}`);
  }

  const fullText = [tracked, ...untrackedSections].filter(Boolean).join('\n\n');
  const files = filesFromDiff(tracked).concat(untrackedList);

  if (!fullText) return { mode: 'empty', text: '', files: [], hash: hashText(''), bytes: 0 };

  const bytes = Buffer.byteLength(fullText, 'utf8');
  if (bytes > maxBytes) {
    const stat = safeGit(['diff', 'HEAD', '--stat', '--', '.', ...excludes]);
    const statText = `# Diff too large (${bytes} bytes) — summary only\n\n${stat}\n\nUntracked:\n${untrackedList.join('\n')}`;
    return { mode: 'stat', text: statText, files, hash: hashText(statText), bytes };
  }

  return { mode: 'full', text: fullText, files, hash: hashText(fullText), bytes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/diff.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/sugendran-skeptics/scripts/lib/diff.mjs plugins/sugendran-skeptics/scripts/lib/diff.test.mjs
git commit -m "feat(skeptics): working-tree diff collection with stat fallback (plan Task 4)"
```

---

## Task 5: `intent.mjs` — last user request from the transcript

**Files:**
- Create: `plugins/sugendran-skeptics/scripts/lib/intent.mjs`
- Test: `plugins/sugendran-skeptics/scripts/lib/intent.test.mjs`

**Interfaces:**
- Produces:
  - `extractUserText(content:string|array) → string | null`
  - `readIntent(transcriptPath:string, { readFile, maxChars } = {}) → string | null`

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/intent.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readIntent, extractUserText } from './intent.mjs';

const JSONL = [
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'Add discount logic to checkout' } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'done' }] } }),
].join('\n');

test('returns the most recent human user message, skipping tool_result-only user lines', () => {
  const intent = readIntent('/fake', { readFile: () => JSONL });
  assert.equal(intent, 'Add discount logic to checkout');
});

test('missing/garbled transcript → null, no throw', () => {
  assert.equal(readIntent('/fake', { readFile: () => { throw new Error('nope'); } }), null);
  assert.equal(readIntent(null), null);
  assert.equal(readIntent('/fake', { readFile: () => 'garbage\n{bad' }), null);
});

test('extractUserText handles string and text-block arrays', () => {
  assert.equal(extractUserText('hi'), 'hi');
  assert.equal(extractUserText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb');
  assert.equal(extractUserText([{ type: 'tool_result', content: 'x' }]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/intent.test.mjs`
Expected: FAIL — cannot find module `./intent.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/intent.mjs
import { readFileSync } from 'node:fs';

export function extractUserText(content) {
  if (typeof content === 'string') return content.trim() || null;
  if (Array.isArray(content)) {
    const joined = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return joined || null;
  }
  return null;
}

export function readIntent(transcriptPath, { readFile = (p) => readFileSync(p, 'utf8'), maxChars = 2000 } = {}) {
  if (!transcriptPath) return null;
  let raw;
  try { raw = readFile(transcriptPath); } catch { return null; }
  const lines = String(raw).split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if (obj?.type !== 'user') continue;
    const text = extractUserText(obj?.message?.content);
    if (text) return text.slice(0, maxChars);
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/intent.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/sugendran-skeptics/scripts/lib/intent.mjs plugins/sugendran-skeptics/scripts/lib/intent.test.mjs
git commit -m "feat(skeptics): extract last user request from transcript (plan Task 5)"
```

---

## Task 6: Prompt template, output schema & `prompt.mjs`

**Files:**
- Create: `plugins/sugendran-skeptics/prompts/skeptic.md`
- Create: `plugins/sugendran-skeptics/schemas/skeptic-output.schema.json`
- Create: `plugins/sugendran-skeptics/scripts/lib/prompt.mjs`
- Test: `plugins/sugendran-skeptics/scripts/lib/prompt.test.mjs`

**Interfaces:**
- Produces: `buildPrompt({ template:string, diff:{mode,text}, intent:string|null }) → string`

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/prompt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from './prompt.mjs';

const TEMPLATE = 'Intent: {{INTENT}}\n{{COLLECTION_GUIDANCE}}\nDIFF:\n{{DIFF}}';

test('interpolates intent and diff in full mode (no guidance)', () => {
  const out = buildPrompt({ template: TEMPLATE, diff: { mode: 'full', text: 'THEDIFF' }, intent: 'do X' });
  assert.match(out, /Intent: do X/);
  assert.match(out, /THEDIFF/);
  assert.doesNotMatch(out, /summary \(file list/);
});

test('null intent becomes a placeholder', () => {
  const out = buildPrompt({ template: TEMPLATE, diff: { mode: 'full', text: 'D' }, intent: null });
  assert.match(out, /no explicit task captured/);
});

test('stat mode injects collection guidance', () => {
  const out = buildPrompt({ template: TEMPLATE, diff: { mode: 'stat', text: 'D' }, intent: 'x' });
  assert.match(out, /only a diff summary/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/prompt.test.mjs`
Expected: FAIL — cannot find module `./prompt.mjs`.

- [ ] **Step 3: Write `prompt.mjs`**

```js
// scripts/lib/prompt.mjs
export function buildPrompt({ template, diff, intent }) {
  const guidance = diff.mode === 'stat'
    ? 'NOTE: Only a diff summary (file list + stats) is available, not full hunks. Scope your certainty accordingly and prefer pointing at files that warrant a closer look.'
    : '';
  return template
    .replaceAll('{{INTENT}}', intent || '(no explicit task captured for this turn)')
    .replaceAll('{{COLLECTION_GUIDANCE}}', guidance)
    .replaceAll('{{DIFF}}', diff.text);
}
```

- [ ] **Step 4: Write `prompts/skeptic.md`**

```markdown
You are a skeptic reviewing business logic an AI assistant just wrote. You did not write it — read it cold. Your job is to find where the change ASSUMES the right behaviour instead of KNOWING it. Challenge it; do not validate it. Give no credit for good intent.

What the change was asked to do:
{{INTENT}}

Engage ONLY where business or domain behaviour changes. Ignore pure refactors, renames, plumbing, formatting, config, and imports. If nothing here changes business behaviour, return verdict "approve" with an empty items array.

Two lenses, in priority order:
1. Unverified assumptions (primary): for each business-logic change, name the assumption it bakes in — about a domain rule, the requirement, the data shape, an external API's behaviour, or an invariant — and ask whether it is verified or merely guessed, and whether it is the right rule.
2. Logic bugs (secondary): once intent is granted, is the rule still wrong — inverted condition, off-by-one, mishandled null/empty/boundary, happy-path-only?

Rules:
- Material findings only. No style, naming, or nitpicks.
- Every finding must be defensible from the diff below. Invent no files, lines, or behaviour. Keep confidence honest.
- Prefer one strong finding over several weak ones. If the logic is sound, return no items.
{{COLLECTION_GUIDANCE}}

Return ONLY a JSON object — no prose, no code fence — matching exactly:
{"verdict":"approve|needs-attention","summary":"one sentence","items":[{"kind":"assumption|logic-bug","severity":"critical|high|medium|low","confidence":0.0,"file":"path","line_start":1,"line_end":1,"assumption":"the assumption it bakes in (when kind=assumption)","problem":"why it may be the wrong rule / where the logic breaks","verify":"the concrete thing to check or fix"}]}

The change to review:
{{DIFF}}
```

- [ ] **Step 5: Write `schemas/skeptic-output.schema.json`** (the contract, for documentation and future validation)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "sugendran-skeptics output",
  "type": "object",
  "required": ["verdict", "items"],
  "properties": {
    "verdict": { "enum": ["approve", "needs-attention"] },
    "summary": { "type": "string" },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["kind", "severity", "confidence", "file"],
        "properties": {
          "kind": { "enum": ["assumption", "logic-bug"] },
          "severity": { "enum": ["critical", "high", "medium", "low"] },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "file": { "type": "string" },
          "line_start": { "type": "integer" },
          "line_end": { "type": "integer" },
          "assumption": { "type": "string" },
          "problem": { "type": "string" },
          "verify": { "type": "string" }
        }
      }
    }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test scripts/lib/prompt.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add plugins/sugendran-skeptics/prompts/skeptic.md \
        plugins/sugendran-skeptics/schemas/skeptic-output.schema.json \
        plugins/sugendran-skeptics/scripts/lib/prompt.mjs \
        plugins/sugendran-skeptics/scripts/lib/prompt.test.mjs
git commit -m "feat(skeptics): skeptic prompt template, output schema and builder (plan Task 6)"
```

---

## Task 7: `opencode.mjs` — invoke opencode & parse NDJSON

**Files:**
- Create: `plugins/sugendran-skeptics/scripts/lib/opencode.mjs`
- Test: `plugins/sugendran-skeptics/scripts/lib/opencode.test.mjs`

**Interfaces:**
- Produces:
  - `parseOpencodeStream(stdout:string) → { ok:boolean, text?:string, error?:string }`
  - `defaultSpawn(prompt:string, cwd:string) → ChildProcess`
  - `runOpencode({ prompt, cwd, timeoutMs, spawn }) → Promise<{ ok, text?, error? }>`
- Consumes (in tests): a fake `spawn` returning an `EventEmitter` child with `.stdout` (EventEmitter), `.stdin` (`{write, end}`), `.kill()`, and `.on()`.

- [ ] **Step 1: Write the failing test** (uses the REAL verified NDJSON shape)

```js
// scripts/lib/opencode.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseOpencodeStream, runOpencode } from './opencode.mjs';

const SUCCESS = [
  '{"type":"step_start","part":{"type":"step-start"}}',
  '{"type":"text","part":{"type":"text","text":"{\\"verdict\\":\\"approve\\",\\"items\\":[]}"}}',
  '{"type":"step_finish","part":{"reason":"stop"}}',
].join('\n');

const ERROR = '{"type":"error","error":{"name":"APIError","data":{"message":"boom"}}}';

test('parseOpencodeStream extracts concatenated text parts', () => {
  const r = parseOpencodeStream(SUCCESS);
  assert.equal(r.ok, true);
  assert.equal(r.text, '{"verdict":"approve","items":[]}');
});

test('parseOpencodeStream reports error events', () => {
  const r = parseOpencodeStream(ERROR);
  assert.equal(r.ok, false);
  assert.match(r.error, /boom/);
});

test('parseOpencodeStream: no text → not ok', () => {
  assert.equal(parseOpencodeStream('{"type":"step_finish","part":{}}').ok, false);
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdin = { write() {}, end() {} };
  child.kill = () => { child._killed = true; };
  return child;
}

test('runOpencode resolves ok from a fake child stream', async () => {
  const child = fakeChild();
  const p = runOpencode({ prompt: 'x', cwd: '/x', timeoutMs: 1000, spawn: () => child });
  child.stdout.emit('data', Buffer.from(SUCCESS));
  child.emit('close', 0);
  assert.deepEqual(await p, { ok: true, text: '{"verdict":"approve","items":[]}' });
});

test('runOpencode times out and kills the child', async () => {
  const child = fakeChild();
  const p = runOpencode({ prompt: 'x', cwd: '/x', timeoutMs: 10, spawn: () => child });
  const r = await p;
  assert.equal(r.ok, false);
  assert.match(r.error, /timed out/);
  assert.equal(child._killed, true);
});

test('runOpencode handles spawn ENOENT', async () => {
  const r = await runOpencode({ prompt: 'x', cwd: '/x', timeoutMs: 100, spawn: () => { throw new Error('ENOENT'); } });
  assert.equal(r.ok, false);
  assert.match(r.error, /unavailable/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/opencode.test.mjs`
Expected: FAIL — cannot find module `./opencode.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/opencode.mjs
import { spawn as nodeSpawn } from 'node:child_process';

export function parseOpencodeStream(stdout) {
  const lines = String(stdout).split('\n').map((l) => l.trim()).filter(Boolean);
  const texts = [];
  let errored = null;
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type === 'error') {
      errored = ev?.error?.data?.message || ev?.error?.message || ev?.error?.name || 'opencode error';
    } else if (ev?.type === 'text' && typeof ev?.part?.text === 'string') {
      texts.push(ev.part.text);
    }
  }
  if (errored) return { ok: false, error: errored };
  const text = texts.join('').trim();
  if (!text) return { ok: false, error: 'no text output from opencode' };
  return { ok: true, text };
}

export function defaultSpawn(_prompt, cwd) {
  return nodeSpawn('opencode', ['run', '--format', 'json'], { cwd });
}

export function runOpencode({ prompt, cwd, timeoutMs, spawn = defaultSpawn }) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(prompt, cwd); } catch { return resolve({ ok: false, error: 'opencode unavailable' }); }

    let stdout = '';
    let settled = false;
    const done = (res) => { if (!settled) { settled = true; clearTimeout(timer); resolve(res); } };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      done({ ok: false, error: 'opencode timed out' });
    }, timeoutMs);

    child.on('error', () => done({ ok: false, error: 'opencode unavailable' }));
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.on('close', () => done(parseOpencodeStream(stdout)));

    try {
      child.stdin?.write(prompt);
      child.stdin?.end();
    } catch {
      done({ ok: false, error: 'failed to send prompt to opencode' });
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/opencode.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/sugendran-skeptics/scripts/lib/opencode.mjs plugins/sugendran-skeptics/scripts/lib/opencode.test.mjs
git commit -m "feat(skeptics): opencode invocation and NDJSON parsing (plan Task 7)"
```

---

## Task 8: `decision.mjs` — validate, filter, format the hook output

**Files:**
- Create: `plugins/sugendran-skeptics/scripts/lib/decision.mjs`
- Test: `plugins/sugendran-skeptics/scripts/lib/decision.test.mjs`

**Interfaces:**
- Consumes: `SEVERITY_RANK` from `./config.mjs`.
- Produces:
  - `coerceJson(text:string) → object | null`
  - `validateOutput(obj) → { ok:boolean, value?:{verdict,summary,items[]}, error?:string }`
  - `filterItems(items, config) → items[]`
  - `formatAdditionalContext(items) → string`
  - `decide({ parsed, config }) → { inject:boolean, additionalContext:string|null, kept:[] }`
  - `buildHookOutput(decision) → object`  (`{}` or `{hookSpecificOutput:{hookEventName:'Stop',additionalContext}}`)

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/decision.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceJson, validateOutput, decide, buildHookOutput } from './decision.mjs';

const CFG = { minSeverity: 'medium', minConfidence: 0.6 };

const ITEM = {
  kind: 'assumption', severity: 'high', confidence: 0.8,
  file: 'src/pricing.ts', line_start: 42, line_end: 42,
  assumption: 'discount never exceeds price', problem: 'not enforced', verify: 'clamp or validate the rule',
};

test('coerceJson strips a code fence', () => {
  assert.deepEqual(coerceJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(coerceJson('not json'), null);
});

test('validateOutput keeps only well-formed items', () => {
  const r = validateOutput({ verdict: 'needs-attention', items: [ITEM, { kind: 'nope' }, 'x'] });
  assert.equal(r.ok, true);
  assert.equal(r.value.items.length, 1);
});

test('validateOutput rejects bad verdict', () => {
  assert.equal(validateOutput({ verdict: 'lgtm', items: [] }).ok, false);
});

test('decide: approve → no injection', () => {
  const d = decide({ parsed: { verdict: 'approve', items: [] }, config: CFG });
  assert.equal(d.inject, false);
  assert.deepEqual(buildHookOutput(d), {});
});

test('decide: sub-threshold filtered out', () => {
  const low = { ...ITEM, severity: 'low', confidence: 0.9 };
  const weak = { ...ITEM, confidence: 0.3 };
  const d = decide({ parsed: { verdict: 'needs-attention', items: [low, weak] }, config: CFG });
  assert.equal(d.inject, false);
});

test('decide: material item → additionalContext hook output', () => {
  const d = decide({ parsed: { verdict: 'needs-attention', items: [ITEM] }, config: CFG });
  assert.equal(d.inject, true);
  const out = buildHookOutput(d);
  assert.equal(out.hookSpecificOutput.hookEventName, 'Stop');
  assert.match(out.hookSpecificOutput.additionalContext, /src\/pricing.ts:42/);
  assert.match(out.hookSpecificOutput.additionalContext, /verify:/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/decision.test.mjs`
Expected: FAIL — cannot find module `./decision.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/decision.mjs
import { SEVERITY_RANK } from './config.mjs';

const VERDICTS = new Set(['approve', 'needs-attention']);
const KINDS = new Set(['assumption', 'logic-bug']);

export function coerceJson(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { return null; }
}

export function validateOutput(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not an object' };
  if (!VERDICTS.has(obj.verdict)) return { ok: false, error: 'bad verdict' };
  if (!Array.isArray(obj.items)) return { ok: false, error: 'items not an array' };
  const items = [];
  for (const it of obj.items) {
    if (!it || typeof it !== 'object') continue;
    if (!KINDS.has(it.kind)) continue;
    if (!SEVERITY_RANK[it.severity]) continue;
    if (typeof it.file !== 'string') continue;
    items.push({
      kind: it.kind,
      severity: it.severity,
      confidence: Number.isFinite(it.confidence) ? it.confidence : 0,
      file: it.file,
      line_start: Number.isInteger(it.line_start) ? it.line_start : 0,
      line_end: Number.isInteger(it.line_end) ? it.line_end : 0,
      assumption: typeof it.assumption === 'string' ? it.assumption : '',
      problem: typeof it.problem === 'string' ? it.problem : '',
      verify: typeof it.verify === 'string' ? it.verify : '',
    });
  }
  return { ok: true, value: { verdict: obj.verdict, summary: String(obj.summary || ''), items } };
}

export function filterItems(items, config) {
  const minRank = SEVERITY_RANK[config.minSeverity] || 2;
  return items.filter((it) => SEVERITY_RANK[it.severity] >= minRank && it.confidence >= config.minConfidence);
}

export function formatAdditionalContext(items) {
  const lines = items.map((it) => {
    const what = it.kind === 'assumption' ? (it.assumption || it.problem) : (it.problem || it.assumption);
    return `- [${it.severity}] ${it.file}:${it.line_start} — ${it.kind}: ${what} → verify: ${it.verify}`;
  });
  return [
    'sugendran-skeptics (a second model reviewing the business logic you just changed) flagged these. Confirm each is actually correct, or address it, then continue:',
    ...lines,
  ].join('\n');
}

export function decide({ parsed, config }) {
  if (!parsed || parsed.verdict === 'approve' || !parsed.items?.length) {
    return { inject: false, additionalContext: null, kept: [] };
  }
  const kept = filterItems(parsed.items, config);
  if (!kept.length) return { inject: false, additionalContext: null, kept: [] };
  return { inject: true, additionalContext: formatAdditionalContext(kept), kept };
}

export function buildHookOutput(decision) {
  if (!decision.inject) return {};
  return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: decision.additionalContext } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/decision.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/sugendran-skeptics/scripts/lib/decision.mjs plugins/sugendran-skeptics/scripts/lib/decision.test.mjs
git commit -m "feat(skeptics): validate, filter and format findings into hook output (plan Task 8)"
```

---

## Task 9: `skeptic-gate.mjs` — orchestrator (runGate + CLI)

**Files:**
- Create: `plugins/sugendran-skeptics/scripts/skeptic-gate.mjs`
- Test: `plugins/sugendran-skeptics/scripts/skeptic-gate.test.mjs`

**Interfaces:**
- Consumes: all libs from Tasks 2–8.
- Produces:
  - `runGate(input, deps) → Promise<object>`  — the hook output object (`{}` or `{hookSpecificOutput:…}`)
  - `realDeps() → deps`  — wires the real libs
  - CLI behaviour: read Stop-hook JSON on stdin → `runGate` → print JSON → `exit 0`. `--manual` flag prints a human-readable review of the working tree (ignores cache/enabled/stop_hook_active).
- `deps` shape (what tests stub): `{ loadConfig, collectDiff, readIntent, buildPrompt, runOpencode, coerceJson, validateOutput, decide, buildHookOutput, state:{has,record}, readTemplate, log }`.

- [ ] **Step 1: Write the failing test** (pure `runGate` with stubbed deps — no git, no network)

```js
// scripts/skeptic-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGate } from './skeptic-gate.mjs';

function baseDeps(over = {}) {
  const recorded = [];
  return {
    recorded,
    loadConfig: () => ({ enabled: true, timeoutMs: 100, maxDiffBytes: 1000, minSeverity: 'medium', minConfidence: 0.6, pathsIgnore: [] }),
    collectDiff: () => ({ mode: 'full', text: 'D', files: ['a.ts'], hash: 'H', bytes: 1 }),
    readIntent: () => 'do X',
    buildPrompt: () => 'PROMPT',
    runOpencode: async () => ({ ok: true, text: '{"verdict":"needs-attention","items":[{"kind":"assumption","severity":"high","confidence":0.9,"file":"a.ts","line_start":1,"line_end":1,"assumption":"x","problem":"y","verify":"z"}]}' }),
    coerceJson: (t) => JSON.parse(t),
    validateOutput: (o) => ({ ok: true, value: { verdict: o.verdict, summary: '', items: o.items } }),
    decide: ({ parsed }) => ({ inject: parsed.items.length > 0, additionalContext: 'CTX', kept: parsed.items }),
    buildHookOutput: (d) => (d.inject ? { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: d.additionalContext } } : {}),
    state: { has: () => false, record: (s, h) => recorded.push(h) },
    readTemplate: () => 'TPL',
    log: () => {},
    ...over,
  };
}
const INPUT = { session_id: 's1', transcript_path: '/t', cwd: '/repo', stop_hook_active: false };

test('happy path injects additionalContext and records the hash', async () => {
  const deps = baseDeps();
  const out = await runGate(INPUT, deps);
  assert.equal(out.hookSpecificOutput.additionalContext, 'CTX');
  assert.deepEqual(deps.recorded, ['H']);
});

test('disabled → {}', async () => {
  const out = await runGate(INPUT, baseDeps({ loadConfig: () => ({ enabled: false }) }));
  assert.deepEqual(out, {});
});

test('stop_hook_active → {} (no re-nag)', async () => {
  const out = await runGate({ ...INPUT, stop_hook_active: true }, baseDeps());
  assert.deepEqual(out, {});
});

test('empty diff → {}', async () => {
  const out = await runGate(INPUT, baseDeps({ collectDiff: () => ({ mode: 'empty', text: '', hash: 'E' }) }));
  assert.deepEqual(out, {});
});

test('already-reviewed hash → {} (no-nag)', async () => {
  const out = await runGate(INPUT, baseDeps({ state: { has: () => true, record: () => {} } }));
  assert.deepEqual(out, {});
});

test('opencode failure → {} and hash NOT recorded (retry next time)', async () => {
  const deps = baseDeps({ runOpencode: async () => ({ ok: false, error: 'timed out' }) });
  const out = await runGate(INPUT, deps);
  assert.deepEqual(out, {});
  assert.deepEqual(deps.recorded, []);
});

test('a throwing dep fails open to {}', async () => {
  const out = await runGate(INPUT, baseDeps({ collectDiff: () => { throw new Error('git boom'); } }));
  assert.deepEqual(out, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/skeptic-gate.test.mjs`
Expected: FAIL — cannot find module `./skeptic-gate.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/skeptic-gate.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './lib/config.mjs';
import { collectDiff } from './lib/diff.mjs';
import { readIntent } from './lib/intent.mjs';
import { buildPrompt } from './lib/prompt.mjs';
import { runOpencode } from './lib/opencode.mjs';
import { coerceJson, validateOutput, decide, buildHookOutput } from './lib/decision.mjs';
import { makeState } from './lib/state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function realDeps() {
  return {
    loadConfig, collectDiff, readIntent, buildPrompt, runOpencode,
    coerceJson, validateOutput, decide, buildHookOutput,
    state: makeState(),
    readTemplate: () => readFileSync(join(HERE, '..', 'prompts', 'skeptic.md'), 'utf8'),
    log: (msg) => { try { process.stderr.write(`[sugendran-skeptics] ${msg}\n`); } catch { /* ignore */ } },
  };
}

export async function runGate(input, deps) {
  try {
    const cwd = input?.cwd || process.cwd();
    const config = deps.loadConfig(process.env, cwd);
    if (!config.enabled) return {};
    if (input?.stop_hook_active) return {};

    const diff = deps.collectDiff({ cwd, maxBytes: config.maxDiffBytes, pathsIgnore: config.pathsIgnore });
    if (diff.mode === 'empty') return {};

    const sessionId = input?.session_id || 'unknown';
    if (deps.state.has(sessionId, diff.hash)) return {};

    const intent = deps.readIntent(input?.transcript_path);
    const prompt = deps.buildPrompt({ template: deps.readTemplate(), diff, intent });

    const result = await deps.runOpencode({ prompt, cwd, timeoutMs: config.timeoutMs });
    if (!result.ok) { deps.log(`skipped: ${result.error}`); return {}; }

    const parsed = deps.validateOutput(deps.coerceJson(result.text));
    if (!parsed.ok) { deps.log(`unparseable: ${parsed.error}`); return {}; }

    deps.state.record(sessionId, diff.hash);
    return deps.buildHookOutput(deps.decide({ parsed: parsed.value, config }));
  } catch (err) {
    try { deps.log(`fail-open: ${err?.message || err}`); } catch { /* ignore */ }
    return {};
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (d) => { data += d; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    setTimeout(() => resolve(data), 2000); // safety: never hang the hook
  });
}

async function runManual() {
  const deps = realDeps();
  const cwd = process.cwd();
  const config = { ...deps.loadConfig(process.env, cwd), enabled: true };
  const diff = deps.collectDiff({ cwd, maxBytes: config.maxDiffBytes, pathsIgnore: config.pathsIgnore });
  if (diff.mode === 'empty') { process.stdout.write('No uncommitted changes to review.\n'); process.exit(0); }
  const prompt = deps.buildPrompt({ template: deps.readTemplate(), diff, intent: deps.readIntent(null) });
  const result = await deps.runOpencode({ prompt, cwd, timeoutMs: config.timeoutMs });
  if (!result.ok) { process.stdout.write(`Skeptic unavailable: ${result.error}\n`); process.exit(0); }
  const parsed = deps.validateOutput(deps.coerceJson(result.text));
  if (!parsed.ok) { process.stdout.write(`Could not parse skeptic output: ${parsed.error}\n`); process.exit(0); }
  const decision = deps.decide({ parsed: parsed.value, config });
  process.stdout.write((decision.inject ? decision.additionalContext : 'Skeptic found nothing material.') + '\n');
  process.exit(0);
}

async function main() {
  if (process.argv.slice(2).includes('--manual')) return runManual();
  let input = {};
  try { input = JSON.parse(await readStdin()); } catch { input = {}; }
  const out = await runGate(input, realDeps());
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/skeptic-gate.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the whole suite**

Run: `cd plugins/sugendran-skeptics && npm test`
Expected: all tests across all libs PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/sugendran-skeptics/scripts/skeptic-gate.mjs plugins/sugendran-skeptics/scripts/skeptic-gate.test.mjs
git commit -m "feat(skeptics): fail-open gate orchestrator with CLI and --manual (plan Task 9)"
```

---

## Task 10: Register the Stop hook & verify end-to-end

**Files:**
- Create: `plugins/sugendran-skeptics/hooks/hooks.json`

**Interfaces:**
- Produces: a live Stop hook running `node ${CLAUDE_PLUGIN_ROOT}/scripts/skeptic-gate.mjs`.

- [ ] **Step 1: Write `hooks/hooks.json`**

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/skeptic-gate.mjs\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Validate the plugin**

Run: `claude plugin validate ./plugins/sugendran-skeptics`
Expected: passes, and reports a Stop hook registered.

- [ ] **Step 3: Simulate a hook call with an empty diff (fail-open / no-op smoke)**

Run (from a clean checkout of this repo):
```bash
echo '{"session_id":"smoke","transcript_path":"/nonexistent","cwd":"'"$PWD"'","hook_event_name":"Stop","stop_hook_active":false}' \
  | node plugins/sugendran-skeptics/scripts/skeptic-gate.mjs
```
Expected: prints `{}` and exits 0 (no uncommitted changes → no-op).

- [ ] **Step 4: Real opencode smoke via --manual** (confirms the user's opencode default returns parseable JSON — the spec's "first verification step")

First confirm the default model responds with parseable JSON:
```bash
opencode run --format json 'reply only with this and nothing else: {"verdict":"approve","items":[]}'
```
Expected: an NDJSON stream whose `type:"text"` event contains `{"verdict":"approve","items":[]}`. If instead you see a `type:"error"` event (e.g. auth/credits), fix the opencode default model before continuing — the gate will correctly fail open, but the skeptic won't actually run.

Then make a tiny business-logic change and run the manual review:
```bash
node plugins/sugendran-skeptics/scripts/skeptic-gate.mjs --manual
```
Expected: either a findings list or "Skeptic found nothing material." — and it returns within `timeout_ms`.

- [ ] **Step 5: Commit**

```bash
git add plugins/sugendran-skeptics/hooks/hooks.json
git commit -m "feat(skeptics): register Stop hook and verify end-to-end (plan Task 10)"
```

---

## Task 11: Manual command `/sugendran-skeptics`

**Files:**
- Create: `plugins/sugendran-skeptics/commands/sugendran-skeptics.md`

**Interfaces:**
- Produces: a slash command that (no arg) runs `--manual`, and `on`/`off` toggles the repo config.

- [ ] **Step 1: Write the command**

````markdown
---
description: "Run the opencode skeptic on the current working tree, or toggle it for this repo"
argument-hint: "[on | off]"
allowed-tools: ["Bash", "Read", "Write"]
---

# sugendran-skeptics (manual)

**Argument:** "$ARGUMENTS"

Decide based on the argument:

- **`off`** — Read `./.sugendran-skeptics.json` if it exists, set `"enabled": false` (preserving other keys), write it back, and report that the skeptic is disabled for this repo.
- **`on`** — Same, but set `"enabled": true`, and report it is enabled.
- **anything else / empty** — Run the skeptic against the current working tree and print its output verbatim:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/skeptic-gate.mjs" --manual
  ```

  If it lists findings, treat each as a checklist item: confirm the business logic is actually correct, or fix it. If it says nothing material, report that and stop.
````

- [ ] **Step 2: Validate**

Run: `claude plugin validate ./plugins/sugendran-skeptics`
Expected: passes; reports the `sugendran-skeptics` command.

- [ ] **Step 3: Commit**

```bash
git add plugins/sugendran-skeptics/commands/sugendran-skeptics.md
git commit -m "feat(skeptics): manual run + on/off toggle command (plan Task 11)"
```

---

## Task 12: README polish & final validation

**Files:**
- Modify: `plugins/sugendran-skeptics/README.md` (fill in config + behaviour details)

**Interfaces:**
- Produces: complete docs; green validation; full test suite green.

- [ ] **Step 1: Expand the README** with a config table and the fail-open guarantee

Add the configuration section (`.sugendran-skeptics.json` keys: `enabled`, `timeoutMs`, `maxDiffBytes`, `minSeverity`, `minConfidence`, `pathsIgnore`), a note that **model is not configured here** (it's the user's opencode default), and the fail-open guarantee (any failure silently allows the turn to finish; `SKEPTICS_DISABLE=1` disables entirely).

- [ ] **Step 2: Run the full test suite**

Run: `cd plugins/sugendran-skeptics && npm test`
Expected: all tests PASS.

- [ ] **Step 3: Final validation**

Run: `claude plugin validate ./plugins/sugendran-skeptics`
Expected: passes with hook + command + no errors.

- [ ] **Step 4: Commit**

```bash
git add plugins/sugendran-skeptics/README.md
git commit -m "docs(skeptics): complete README; final validation (plan Task 12)"
```

---

## Manual QA (run after Task 12, in a real project with the plugin installed)

- [ ] **Assumption challenge** — change a business rule with an unverified assumption (e.g. apply a discount without checking it can't exceed the price); finish a turn; the skeptic injects an `assumption` finding at the right `file:line`.
- [ ] **Logic bug** — introduce an inverted condition / off-by-one in domain logic; the skeptic raises a `logic-bug` finding.
- [ ] **Pure refactor** — rename a variable with no behaviour change; the skeptic stays silent.
- [ ] **No-nag** — finish a second turn without changing code; no second injection for the same diff.
- [ ] **Fail open** — point the opencode default at a bogus model id; finish a turn; it completes normally with a stderr breadcrumb, no wedge.
- [ ] **Large diff** — generate a >256 KB diff; the gate uses stat-only mode and completes within `timeout_ms`.
- [ ] **Disable** — `SKEPTICS_DISABLE=1`; finish a turn; the gate is a no-op.
- [ ] **Manual** — `/sugendran-skeptics` prints findings on demand; `/sugendran-skeptics off` then `on` toggles `.sugendran-skeptics.json`.
