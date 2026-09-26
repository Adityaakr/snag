/** The docker-compose topology as local processes (BUILD_PROMPT M9): see scripts/dev/stack-smoke.mjs. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('stack smoke', () => {
  it('runs web, worker, Postgres and the fake GitHub, and reviews a PR end to end', () => {
    const out = execFileSync(
      process.execPath,
      [join(import.meta.dirname, '..', '..', '..', 'scripts', 'dev', 'stack-smoke.mjs')],
      {
        encoding: 'utf8',
        env: { ...process.env, REMIT_ALLOW_NETWORK: '1' },
      },
    );
    expect(out).toContain('stack smoke ok');
  }, 300_000);
});
