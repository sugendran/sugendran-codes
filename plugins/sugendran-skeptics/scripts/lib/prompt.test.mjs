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
