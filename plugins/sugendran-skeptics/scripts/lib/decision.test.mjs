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
