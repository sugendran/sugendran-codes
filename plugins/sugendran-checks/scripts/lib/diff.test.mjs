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
