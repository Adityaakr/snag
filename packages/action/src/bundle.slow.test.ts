/**
 * The bundled action (dist/index.js) end to end: built fresh, run as a child process against a local fake GitHub
 * API, with tree-sitter grammars loaded from the bundle directory.
 */
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { fakeGitHubApi, fakeRepo } from '@remit/server';
import { describe, expect, it } from 'vitest';

const ACTION = join(import.meta.dirname, '..');

describe('bundled action', () => {
  it('reviews a PR through the GitHub API only', async () => {
    execFileSync('node', ['build.mjs'], { cwd: ACTION, stdio: 'ignore' });
    const repo = fakeRepo('three_reqs_one_missing');
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const api = fakeGitHubApi(repo.gh, publicKey, '1');
    const token = ['ghs', 'bundle', 'test'].join('_');
    api.tokens.push(token);
    const server = await new Promise<{ url: string; close: () => void }>((resolve) => {
      const s = serve({ fetch: api.app.fetch, port: 0, hostname: '127.0.0.1' }, (info: AddressInfo) =>
        resolve({ url: `http://127.0.0.1:${info.port}`, close: () => s.close() }),
      );
    });
    const dir = mkdtempSync(join(tmpdir(), 'remit-bundle-'));
    const eventPath = join(dir, 'event.json');
    writeFileSync(
      eventPath,
      JSON.stringify({
        repository: { name: 'reports', owner: { login: 'acme' } },
        pull_request: {
          number: 77,
          head: { repo: { full_name: 'acme/reports' } },
          base: { repo: { full_name: 'acme/reports' } },
        },
      }),
    );
    const out = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const child = spawn('node', [join(ACTION, 'dist', 'index.js')], {
        env: {
          PATH: process.env.PATH ?? '',
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_API_URL: server.url,
          'INPUT_GITHUB-TOKEN': token,
          GITHUB_STEP_SUMMARY: join(dir, 'summary.md'),
        },
      });
      let stdout = '';
      child.stdout.on('data', (d) => {
        stdout += d;
      });
      child.on('close', (code) => resolve({ code, stdout }));
    });
    server.close();
    expect(out.code).toBe(0);
    expect(out.stdout).toMatch(/^Remit: /m);
    expect(repo.gh.posted.get('acme/reports#77')?.[0]?.body).toContain('<!-- remit:summary v1');
  }, 120_000);
});
