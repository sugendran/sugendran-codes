import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './lib/config.mjs';
import { runOpencode } from './lib/opencode.mjs';
import { coerceJson, filterItems } from './lib/decision.mjs';
import { buildPlanPrompt, validatePlanOutput, formatPlanFindings } from './lib/plan.mjs';
import { fileLog } from './lib/log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function realDeps() {
  return {
    loadConfig, runOpencode, coerceJson, filterItems,
    buildPlanPrompt, validatePlanOutput, formatPlanFindings,
    readTemplate: () => readFileSync(join(HERE, '..', 'prompts', 'plan.md'), 'utf8'),
    log: (msg) => {
      const line = `[sugendran-checks] ${msg}`;
      try { process.stderr.write(`${line}\n`); } catch { /* ignore */ }
      fileLog(line);
    },
  };
}

export async function runPlanReview(planText, deps) {
  try {
    const config = deps.loadConfig(process.env, process.cwd());
    if (!config.enabled) return 'sugendran-checks plan review is disabled.';
    if (!planText || !planText.trim()) return 'No plan text provided.';

    const prompt = deps.buildPlanPrompt(deps.readTemplate(), planText);
    const result = await deps.runOpencode({ prompt, cwd: process.cwd(), timeoutMs: config.timeoutMs });
    if (!result.ok) {
      deps.log(`plan-review skipped: ${result.error}`);
      return `Plan review unavailable (${result.error}) — proceeding without it.`;
    }

    const parsed = deps.validatePlanOutput(deps.coerceJson(result.text));
    if (!parsed.ok) {
      deps.log(`plan-review unparseable: ${parsed.error}`);
      return 'Plan review unavailable (unparseable) — proceeding without it.';
    }

    const kept = deps.filterItems(parsed.value.items, config);
    if (!kept.length) return 'Plan review — no material concerns.';
    return deps.formatPlanFindings(kept);
  } catch (err) {
    try { deps.log(`plan-review fail-open: ${err?.message || err}`); } catch { /* ignore */ }
    return 'Plan review unavailable (error) — proceeding without it.';
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (d) => { data += d; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    setTimeout(() => resolve(data), 2000); // safety: never hang
  });
}

async function main() {
  const deps = realDeps();
  deps.log('plan-review invoked');
  const planText = await readStdin();
  const out = await runPlanReview(planText, deps);
  const outcome = /no material concerns/i.test(out) ? 'no-concerns'
    : /(unavailable|disabled|No plan text)/i.test(out) ? 'skipped'
    : 'findings';
  deps.log(`plan-review result: ${outcome}`);
  process.stdout.write(out + '\n');
  process.exit(0);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
