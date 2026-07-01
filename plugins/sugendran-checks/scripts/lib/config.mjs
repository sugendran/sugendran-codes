import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

const DEFAULTS = {
  enabled: true,
  timeoutMs: 90000,
  maxDiffBytes: 262144,
  minSeverity: 'medium',
  minConfidence: 0.6,
  pathsIgnore: [
    'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    '*.min.js', '*.map', 'dist/*', 'build/*', 'vendor/*',
  ],
};

function sanitise(obj) {
  const out = {};
  if (typeof obj.enabled === 'boolean') out.enabled = obj.enabled;
  if (Number.isFinite(obj.timeoutMs)) out.timeoutMs = obj.timeoutMs;
  if (Number.isFinite(obj.maxDiffBytes)) out.maxDiffBytes = obj.maxDiffBytes;
  if (typeof obj.minSeverity === 'string' && SEVERITY_RANK[obj.minSeverity]) out.minSeverity = obj.minSeverity;
  if (Number.isFinite(obj.minConfidence)) out.minConfidence = obj.minConfidence;
  if (Array.isArray(obj.pathsIgnore)) out.pathsIgnore = obj.pathsIgnore.filter((p) => typeof p === 'string');
  return out;
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(readFileSync(join(cwd, '.sugendran-checks.json'), 'utf8'));
  } catch {
    fileCfg = {};
  }
  const cfg = { ...DEFAULTS, ...sanitise(fileCfg) };
  if (env.CHECKS_DISABLE === '1' || env.CHECKS_DISABLE === 'true') cfg.enabled = false;
  return cfg;
}
