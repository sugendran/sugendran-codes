// scripts/skeptic-gate.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './lib/config.mjs';
import { collectDiff } from './lib/diff.mjs';
import { readIntent } from './lib/intent.mjs';
import { buildPrompt } from './lib/prompt.mjs';
import { runOpencode } from './lib/opencode.mjs';
import { coerceJson, validateOutput, decide, buildHookOutput } from './lib/decision.mjs';
import { makeState } from './lib/state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function realDeps() {
  return {
    loadConfig, collectDiff, readIntent, buildPrompt, runOpencode,
    coerceJson, validateOutput, decide, buildHookOutput,
    state: makeState(),
    readTemplate: () => readFileSync(join(HERE, '..', 'prompts', 'skeptic.md'), 'utf8'),
    log: (msg) => { try { process.stderr.write(`[sugendran-skeptics] ${msg}\n`); } catch { /* ignore */ } },
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
  const deps = realDeps();
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
}

async function main() {
  if (process.argv.slice(2).includes('--manual')) return runManual();
  let input = {};
  try { input = JSON.parse(await readStdin()); } catch { input = {}; }
  const out = await runGate(input, realDeps());
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
