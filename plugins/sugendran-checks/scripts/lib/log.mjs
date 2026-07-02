import { appendFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export function logFilePath() {
  return join(homedir(), '.cache', 'sugendran-checks', 'checks.log');
}

export function fileLog(line, { path = logFilePath(), now = () => new Date().toISOString() } = {}) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const stamped = `${now()} ${line}\n`;
    let size = 0;
    try { size = statSync(path).size; } catch { size = 0; }
    if (size > 262144) writeFileSync(path, stamped);
    else appendFileSync(path, stamped);
  } catch { /* never throw from logging */ }
}
