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
    state: { has: () => false, record: (_s, h) => recorded.push(h) },
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
