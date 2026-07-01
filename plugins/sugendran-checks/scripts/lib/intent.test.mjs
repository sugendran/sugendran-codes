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
