export function buildPrompt({ template, diff, intent }) {
  const guidance = diff.mode === 'stat'
    ? 'NOTE: Only a diff summary (file list + stats) is available, not full hunks. Scope your certainty accordingly and prefer pointing at files that warrant a closer look.'
    : '';
  return template
    .replaceAll('{{INTENT}}', intent || '(no explicit task captured for this turn)')
    .replaceAll('{{COLLECTION_GUIDANCE}}', guidance)
    .replaceAll('{{DIFF}}', diff.text);
}
