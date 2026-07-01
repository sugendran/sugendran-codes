import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, SEVERITY_RANK } from './config.mjs';

test('defaults when no file and no env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const cfg = loadConfig({}, dir);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.timeoutMs, 90000);
  assert.equal(cfg.maxDiffBytes, 262144);
  assert.equal(cfg.minSeverity, 'medium');
  assert.equal(cfg.minConfidence, 0.6);
  assert.ok(Array.isArray(cfg.pathsIgnore));
});

test('CHECKS_DISABLE=1 forces enabled false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  assert.equal(loadConfig({ CHECKS_DISABLE: '1' }, dir).enabled, false);
});

test('repo file overrides defaults; env wins over file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  writeFileSync(join(dir, '.sugendran-checks.json'),
    JSON.stringify({ enabled: true, timeoutMs: 1234, minSeverity: 'high' }));
  const cfg = loadConfig({ CHECKS_DISABLE: 'true' }, dir);
  assert.equal(cfg.timeoutMs, 1234);
  assert.equal(cfg.minSeverity, 'high');
  assert.equal(cfg.enabled, false); // env override
});

test('garbage in file is ignored, not thrown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  writeFileSync(join(dir, '.sugendran-checks.json'), 'not json {');
  assert.equal(loadConfig({}, dir).timeoutMs, 90000);
  assert.equal(SEVERITY_RANK.critical, 4);
});
