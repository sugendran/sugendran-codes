// scripts/lib/opencode.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseOpencodeStream, runOpencode, resolveOpencodeBin } from './opencode.mjs';

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

test('resolveOpencodeBin honours SKEPTICS_OPENCODE_BIN when it exists', () => {
  const bin = resolveOpencodeBin({
    env: { SKEPTICS_OPENCODE_BIN: '/custom/oc' },
    existsSync: (p) => p === '/custom/oc',
    home: '/home/u',
  });
  assert.equal(bin, '/custom/oc');
});

test('resolveOpencodeBin finds ~/.opencode/bin/opencode when not on PATH', () => {
  const bin = resolveOpencodeBin({
    env: {},
    existsSync: (p) => p === '/home/u/.opencode/bin/opencode',
    home: '/home/u',
  });
  assert.equal(bin, '/home/u/.opencode/bin/opencode');
});

test('resolveOpencodeBin ignores a non-existent override and probes known locations', () => {
  const bin = resolveOpencodeBin({
    env: { SKEPTICS_OPENCODE_BIN: '/gone/oc' },
    existsSync: (p) => p === '/opt/homebrew/bin/opencode',
    home: '/home/u',
  });
  assert.equal(bin, '/opt/homebrew/bin/opencode');
});

test('resolveOpencodeBin falls back to bare opencode when nothing is found', () => {
  const bin = resolveOpencodeBin({ env: {}, existsSync: () => false, home: '/home/u' });
  assert.equal(bin, 'opencode');
});
