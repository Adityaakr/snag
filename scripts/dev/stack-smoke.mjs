#!/usr/bin/env node
// `pnpm stack:smoke`: builds the server and runs the docker-compose topology as local processes (no Docker needed):
// Postgres (PGlite on the wire protocol), the fake GitHub, the web role and the worker role, then the smoke check.
// The container image runs the same compiled entry points (see Dockerfile and docker-compose.yml).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const dist = join(root, 'packages/server/dist');
if (!process.argv.includes('--no-build'))
  execFileSync('pnpm', ['exec', 'tsc', '-b', 'packages/server'], { cwd: root, stdio: 'inherit' });
const dir = mkdtempSync(join(tmpdir(), 'remit-stack-'));
const children = [];
const WEB = 35000 + Math.floor(Math.random() * 500) * 3;
const WORKER = WEB + 1;
const GH = WEB + 2;
let stopping = false;

function run(file, env, name) {
  const child = spawn(process.execPath, [join(dist, file)], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
  });
  child.stderr.on('data', (d) => {
    out += d;
  });
  child.on('exit', (code) => {
    if (code && !stopping) process.stderr.write(`${name} exited ${code}:\n${out.slice(-2000)}\n`);
  });
  return { output: () => out };
}

const stop = () => {
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
};
process.on('exit', stop);

async function until(cond, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}
const up = (url) =>
  fetch(url).then(
    (r) => r.ok,
    () => false,
  );

try {
  const pg = run('dev/pglite-postgres.js', {}, 'postgres');
  await until(() => /postgres:\/\//.test(pg.output()), 30_000, 'postgres');
  const DATABASE_URL = pg.output().trim().split('\n')[0];
  const keyFile = join(dir, 'app-key.pem');
  const common = {
    DATABASE_URL,
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY_FILE: keyFile,
    GITHUB_WEBHOOK_SECRET_FILE: join(dir, 'webhook-secret'),
    GITHUB_API_URL: `http://127.0.0.1:${GH}`,
    REMIT_REPORTS_DIR: join(dir, 'reports'),
    DATA_DIR: join(dir, 'data'),
    LOG_LEVEL: 'warn',
  };
  run(
    'dev/fake-github.js',
    { FAKE_GITHUB_PORT: String(GH), FAKE_GITHUB_HOST: '127.0.0.1', KEY_OUT: keyFile },
    'fake-github',
  );
  await until(
    async () => existsSync(keyFile) && (await up(`http://127.0.0.1:${GH}/healthz`)),
    30_000,
    'fake GitHub',
  );
  // The web role migrates the database; the worker starts once it is healthy (compose: depends_on healthy).
  run('main.js', { ...common, REMIT_ROLE: 'web', PORT: String(WEB) }, 'web');
  await until(() => up(`http://127.0.0.1:${WEB}/healthz`), 60_000, 'web');
  run('main.js', { ...common, REMIT_ROLE: 'worker', WORKER_PORT: String(WORKER) }, 'worker');
  await until(() => up(`http://127.0.0.1:${WORKER}/healthz`), 60_000, 'worker');
  execFileSync(process.execPath, [join(dist, 'dev/smoke.js')], {
    env: {
      ...process.env,
      REMIT_URL: `http://127.0.0.1:${WEB}`,
      FAKE_GITHUB_URL: `http://127.0.0.1:${GH}`,
      GITHUB_WEBHOOK_SECRET_FILE: join(dir, 'webhook-secret'),
    },
    stdio: 'inherit',
  });
  const metrics = await (await fetch(`http://127.0.0.1:${WORKER}/metrics`)).text();
  if (!/remit_reviews_total\{status="done"\} 1/.test(metrics))
    throw new Error(`worker metrics missing the review:\n${metrics}`);
  process.stdout.write('stack smoke ok: web, worker, Postgres and fake GitHub\n');
  stop();
  process.exit(0);
} catch (e) {
  process.stderr.write(`stack smoke failed: ${e.message}\n`);
  stop();
  process.exit(1);
}
