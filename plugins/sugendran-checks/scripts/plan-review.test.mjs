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
