import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync as fsExistsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function parseOpencodeStream(stdout) {
  const lines = String(stdout).split('\n').map((l) => l.trim()).filter(Boolean);
  const texts = [];
  let errored = null;
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type === 'error') {
      errored = ev?.error?.data?.message || ev?.error?.message || ev?.error?.name || 'opencode error';
    } else if (ev?.type === 'text' && typeof ev?.part?.text === 'string') {
      texts.push(ev.part.text);
    }
  }
  if (errored) return { ok: false, error: errored };
  const text = texts.join('').trim();
  if (!text) return { ok: false, error: 'no text output from opencode' };
  return { ok: true, text };
}

// Resolve the opencode binary without relying on PATH. A Stop hook is often
// spawned with a minimal PATH that excludes the opencode install dir
// (~/.opencode/bin), which would make `spawn('opencode')` ENOENT and the gate
// fail open silently. Order: explicit override → known install locations →
// bare name (PATH lookup) as a last resort.
export function resolveOpencodeBin({ env = process.env, existsSync = fsExistsSync, home = homedir() } = {}) {
  const override = env.CHECKS_OPENCODE_BIN;
  if (override && existsSync(override)) return override;
  const candidates = [
    join(home, '.opencode', 'bin', 'opencode'),
    '/opt/homebrew/bin/opencode',
    '/usr/local/bin/opencode',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'opencode';
}

export function defaultSpawn(_prompt, cwd) {
  return nodeSpawn(resolveOpencodeBin(), ['run', '--format', 'json'], { cwd });
}

export function runOpencode({ prompt, cwd, timeoutMs, spawn = defaultSpawn }) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(prompt, cwd); } catch { return resolve({ ok: false, error: 'opencode unavailable' }); }

    let stdout = '';
    let settled = false;
    const done = (res) => { if (!settled) { settled = true; clearTimeout(timer); resolve(res); } };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      done({ ok: false, error: 'opencode timed out' });
    }, timeoutMs);

    child.on('error', () => done({ ok: false, error: 'opencode unavailable' }));
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.on('close', () => done(parseOpencodeStream(stdout)));

    try {
      child.stdin?.write(prompt);
      child.stdin?.end();
    } catch {
      done({ ok: false, error: 'failed to send prompt to opencode' });
    }
  });
}
