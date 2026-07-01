// scripts/checks-gate.mjs
import { readFileSync, appendFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { loadConfig } from './lib/config.mjs';
import { collectDiff } from './lib/diff.mjs';
import { readIntent } from './lib/intent.mjs';
import { buildPrompt } from './lib/prompt.mjs';
import { runOpencode } from './lib/opencode.mjs';
import { coerceJson, validateOutput, decide, buildHookOutput } from './lib/decision.mjs';
import { makeState } from './lib/state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// A silently fail-open background hook needs a breadcrumb trail, otherwise a
// hook that never fired and a hook that fired-but-failed look identical. Log to
// a stable, discoverable path independent of TMPDIR (which can differ in a
// hook's spawned environment).
function logFilePath() {
  return join(homedir(), '.cache', 'sugendran-checks', 'checks.log');
}

function fileLog(line) {
  try {
    const path = logFilePath();
    mkdirSync(dirname(path), { recursive: true });
    const stamped = `${new Date().toISOString()} ${line}\n`;
    let size = 0;
    try { size = statSync(path).size; } catch { size = 0; }
    if (size > 262144) writeFileSync(path, stamped);
    else appendFileSync(path, stamped);
  } catch { /* never throw from logging */ }
}

export function realDeps() {
  return {
    loadConfig, collectDiff, readIntent, buildPrompt, runOpencode,
    coerceJson, validateOutput, decide, buildHookOutput,
    state: makeState(),
    readTemplate: () => readFileSync(join(HERE, '..', 'prompts', 'checks.md'), 'utf8'),
    log: (msg) => {
      const line = `[sugendran-checks] ${msg}`;
      try { process.stderr.write(`${line}\n`); } catch { /* ignore */ }
      fileLog(line);
    },
  };
}

export async function runGate(input, deps) {
  try {
    const cwd = input?.cwd || process.cwd();
    const config = deps.loadConfig(process.env, cwd);
    if (!config.enabled) return {};
    if (input?.stop_hook_active) return {};

    const diff = deps.collectDiff({ cwd, maxBytes: config.maxDiffBytes, pathsIgnore: config.pathsIgnore });
    if (diff.mode === 'empty') return {};

    const sessionId = input?.session_id || 'unknown';
    if (deps.state.has(sessionId, diff.hash)) return {};

    const intent = deps.readIntent(input?.transcript_path);
    const prompt = deps.buildPrompt({ template: deps.readTemplate(), diff, intent });

    const result = await deps.runOpencode({ prompt, cwd, timeoutMs: config.timeoutMs });
    if (!result.ok) { deps.log(`skipped: ${result.error}`); return {}; }

    const parsed = deps.validateOutput(deps.coerceJson(result.text));
    if (!parsed.ok) { deps.log(`unparseable: ${parsed.error}`); return {}; }

    deps.state.record(sessionId, diff.hash);
    return deps.buildHookOutput(deps.decide({ parsed: parsed.value, config }));
  } catch (err) {
    try { deps.log(`fail-open: ${err?.message || err}`); } catch { /* ignore */ }
    return {};
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (d) => { data += d; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    setTimeout(() => resolve(data), 2000); // safety: never hang the hook
  });
}

async function runManual() {
  try {
    const deps = realDeps();
    deps.log('manual invoked');
    const cwd = process.cwd();
    const config = { ...deps.loadConfig(process.env, cwd), enabled: true };
    const diff = deps.collectDiff({ cwd, maxBytes: config.maxDiffBytes, pathsIgnore: config.pathsIgnore });
    if (diff.mode === 'empty') { process.stdout.write('No uncommitted changes to review.\n'); process.exit(0); }
    const prompt = deps.buildPrompt({ template: deps.readTemplate(), diff, intent: deps.readIntent(null) });
    const result = await deps.runOpencode({ prompt, cwd, timeoutMs: config.timeoutMs });
    if (!result.ok) { process.stdout.write(`Skeptic unavailable: ${result.error}\n`); process.exit(0); }
    const parsed = deps.validateOutput(deps.coerceJson(result.text));
    if (!parsed.ok) { process.stdout.write(`Could not parse skeptic output: ${parsed.error}\n`); process.exit(0); }
    const decision = deps.decide({ parsed: parsed.value, config });
    process.stdout.write((decision.inject ? decision.additionalContext : 'Skeptic found nothing material.') + '\n');
    process.exit(0);
  } catch (err) {
    process.stdout.write(`Skeptic could not run: ${err?.message || err}\n`);
    process.exit(0);
  }
}

async function main() {
  if (process.argv.slice(2).includes('--manual')) return runManual();
  let input = {};
  try { input = JSON.parse(await readStdin()); } catch { input = {}; }
  const deps = realDeps();
  deps.log(`invoked: session=${input?.session_id || '?'} cwd=${input?.cwd || process.cwd()} stop_hook_active=${!!input?.stop_hook_active}`);
  const out = await runGate(input, deps);
  deps.log(`result: ${out && out.hookSpecificOutput ? 'injected findings' : 'no-op {}'}`);
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
