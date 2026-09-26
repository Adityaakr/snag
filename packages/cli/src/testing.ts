import type { Io } from './io.js';

/** An in-memory Io for tests and embedding. */
export function memoryIo(cwd: string, env: Record<string, string | undefined> = {}) {
  const buf = { out: '', err: '' };
  const sink: Io = {
    out: (t) => {
      buf.out += t;
    },
    err: (t) => {
      buf.err += t;
    },
    cwd,
    env,
  };
  return {
    sink,
    get out() {
      return buf.out;
    },
    get err() {
      return buf.err;
    },
  };
}
