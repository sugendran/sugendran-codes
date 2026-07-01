import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function hashText(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function defaultRunGit(cwd) {
  return (args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function defaultReadFileSafe(absPath) {
  try {
    const st = statSync(absPath);
    if (!st.isFile()) return { ok: false };
    if (st.size > 65536) return { ok: true, content: `(file ${st.size} bytes — too large to inline)\n` };
    const content = readFileSync(absPath, 'utf8');
    if (content.includes('\u0000')) return { ok: false }; // binary (NUL byte)
    return { ok: true, content };
  } catch {
    return { ok: false };
  }
}

function filesFromDiff(diff) {
  const out = [];
  for (const line of diff.split('\n')) {
    const m = line.match(/^\+\+\+ b\/(.+)$/);
    if (m && m[1] !== '/dev/null') out.push(m[1]);
  }
  return out;
}

export function collectDiff({ cwd, maxBytes, pathsIgnore = [], runGit, readFileSafe = defaultReadFileSafe }) {
  const git = runGit || defaultRunGit(cwd);
  const excludes = pathsIgnore.map((p) => `:(exclude)${p}`);
  const safeGit = (args) => { try { return git(args); } catch { return ''; } };

  const tracked = safeGit(['diff', 'HEAD', '--no-color', '--', '.', ...excludes]).trim();
  const untrackedList = safeGit(['ls-files', '--others', '--exclude-standard', '--', '.', ...excludes])
    .split('\n').map((s) => s.trim()).filter(Boolean);

  const untrackedSections = [];
  for (const rel of untrackedList) {
    const r = readFileSafe(join(cwd, rel));
    if (r.ok) untrackedSections.push(`### new file: ${rel}\n${r.content}`);
  }

  const fullText = [tracked, ...untrackedSections].filter(Boolean).join('\n\n');
  const files = filesFromDiff(tracked).concat(untrackedList);

  if (!fullText) return { mode: 'empty', text: '', files, hash: hashText(''), bytes: 0 };

  const bytes = Buffer.byteLength(fullText, 'utf8');
  if (bytes > maxBytes) {
    const stat = safeGit(['diff', 'HEAD', '--stat', '--', '.', ...excludes]);
    const statText = `# Diff too large (${bytes} bytes) — summary only\n\n${stat}\n\nUntracked:\n${untrackedList.join('\n')}`;
    return { mode: 'stat', text: statText, files, hash: hashText(statText), bytes };
  }

  return { mode: 'full', text: fullText, files, hash: hashText(fullText), bytes };
}
