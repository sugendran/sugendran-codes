import { SEVERITY_RANK } from './config.mjs';

const VERDICTS = new Set(['approve', 'needs-attention']);
const KINDS = new Set(['assumption', 'logic-bug']);

export function coerceJson(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { return null; }
}

export function validateOutput(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not an object' };
  if (!VERDICTS.has(obj.verdict)) return { ok: false, error: 'bad verdict' };
  if (!Array.isArray(obj.items)) return { ok: false, error: 'items not an array' };
  const items = [];
  for (const it of obj.items) {
    if (!it || typeof it !== 'object') continue;
    if (!KINDS.has(it.kind)) continue;
    if (SEVERITY_RANK[it.severity] === undefined) continue;
    if (typeof it.file !== 'string') continue;
    items.push({
      kind: it.kind,
      severity: it.severity,
      confidence: Number.isFinite(it.confidence) ? it.confidence : 0,
      file: it.file,
      line_start: Number.isInteger(it.line_start) ? it.line_start : 0,
      line_end: Number.isInteger(it.line_end) ? it.line_end : 0,
      assumption: typeof it.assumption === 'string' ? it.assumption : '',
      problem: typeof it.problem === 'string' ? it.problem : '',
      verify: typeof it.verify === 'string' ? it.verify : '',
    });
  }
  return { ok: true, value: { verdict: obj.verdict, summary: String(obj.summary || ''), items } };
}

export function filterItems(items, config) {
  const minRank = SEVERITY_RANK[config.minSeverity] ?? 2;
  return items.filter(
    (it) =>
      SEVERITY_RANK[it.severity] >= minRank &&
      it.confidence >= config.minConfidence &&
      (it.assumption || it.problem),
  );
}

export function formatAdditionalContext(items) {
  const lines = items.map((it) => {
    const what = it.kind === 'assumption' ? (it.assumption || it.problem) : (it.problem || it.assumption);
    return `- [${it.severity}] ${it.file}:${it.line_start} — ${it.kind}: ${what} → verify: ${it.verify}`;
  });
  return [
    'sugendran-skeptics (a second model reviewing the business logic you just changed) flagged these. Confirm each is actually correct, or address it, then continue:',
    ...lines,
  ].join('\n');
}

export function decide({ parsed, config }) {
  if (!parsed || parsed.verdict === 'approve' || !parsed.items?.length) {
    return { inject: false, additionalContext: null, kept: [] };
  }
  const kept = filterItems(parsed.items, config);
  if (!kept.length) return { inject: false, additionalContext: null, kept: [] };
  return { inject: true, additionalContext: formatAdditionalContext(kept), kept };
}

export function buildHookOutput(decision) {
  if (!decision.inject) return {};
  return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: decision.additionalContext } };
}
