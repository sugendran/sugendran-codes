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
