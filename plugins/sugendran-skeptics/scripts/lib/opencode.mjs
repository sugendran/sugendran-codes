import { spawn as nodeSpawn } from 'node:child_process';

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

export function defaultSpawn(_prompt, cwd) {
  return nodeSpawn('opencode', ['run', '--format', 'json'], { cwd });
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
