import { readFileSync } from 'node:fs';

export function extractUserText(content) {
  if (typeof content === 'string') return content.trim() || null;
  if (Array.isArray(content)) {
    const joined = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return joined || null;
  }
  return null;
}

export function readIntent(transcriptPath, { readFile = (p) => readFileSync(p, 'utf8'), maxChars = 2000 } = {}) {
  if (!transcriptPath) return null;
  let raw;
  try { raw = readFile(transcriptPath); } catch { return null; }
  const lines = String(raw).split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if (obj?.type !== 'user') continue;
    const text = extractUserText(obj?.message?.content);
    if (text) return text.slice(0, maxChars);
  }
  return null;
}
