import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function defaultStateDir() {
  return join(tmpdir(), 'sugendran-checks');
}

function safe(id) {
  return String(id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function makeState({ dir = defaultStateDir() } = {}) {
  const fileFor = (sessionId) => join(dir, `${safe(sessionId)}.json`);
  const read = (sessionId) => {
    try {
      const set = JSON.parse(readFileSync(fileFor(sessionId), 'utf8'));
      return Array.isArray(set) ? set : [];
    } catch {
      return [];
    }
  };
  return {
    has(sessionId, hash) {
      return read(sessionId).includes(hash);
    },
    record(sessionId, hash) {
      try {
        mkdirSync(dir, { recursive: true });
        const set = read(sessionId);
        if (!set.includes(hash)) set.push(hash);
        writeFileSync(fileFor(sessionId), JSON.stringify(set.slice(-100)));
      } catch {
        /* fail open: best-effort */
      }
    },
  };
}
