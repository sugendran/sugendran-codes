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
