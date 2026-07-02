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
