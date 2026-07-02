import { SEVERITY_RANK } from './config.mjs';

const VERDICTS = new Set(['approve', 'needs-attention']);
const KINDS = new Set(['assumption', 'gap', 'risk']);

export function buildPlanPrompt(template, planText) {
  return template.replaceAll('{{PLAN}}', planText);
}

export function validatePlanOutput(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not an object' };
  if (!VERDICTS.has(obj.verdict)) return { ok: false, error: 'bad verdict' };
  if (!Array.isArray(obj.items)) return { ok: false, error: 'items not an array' };
  const items = [];
  for (const it of obj.items) {
    if (!it || typeof it !== 'object') continue;
    if (!KINDS.has(it.kind)) continue;
    if (SEVERITY_RANK[it.severity] === undefined) continue;
    items.push({
      kind: it.kind,
      severity: it.severity,
      confidence: Number.isFinite(it.confidence) ? it.confidence : 0,
      assumption: typeof it.assumption === 'string' ? it.assumption : '',
      problem: typeof it.problem === 'string' ? it.problem : '',
      verify: typeof it.verify === 'string' ? it.verify : '',
    });
  }
  return { ok: true, value: { verdict: obj.verdict, summary: String(obj.summary || ''), items } };
}

export function formatPlanFindings(items) {
  const lines = items.map((it) => {
    const what = it.kind === 'assumption' ? (it.assumption || it.problem) : (it.problem || it.assumption);
    return `- [${it.severity}] (${it.kind}) ${what} → address: ${it.verify}`;
  });
  return [
    'sugendran-checks reviewed this plan with a second model and raised these before you present it. Resolve or consciously accept each, then revise the plan:',
    ...lines,
  ].join('\n');
}
