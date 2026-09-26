/**
 * The smoke check for a running stack (`docker compose --profile fake up`, or the processes it starts): sends a
 * signed `pull_request.opened` webhook to the server and waits until the fake GitHub has a completed check run and
 * a sticky comment. Exits 0 on success.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signBody } from '../webhook-verify.js';

const remit = process.env.REMIT_URL ?? 'http://localhost:3000';
const github = process.env.FAKE_GITHUB_URL ?? 'http://localhost:4000';
const secretFile = process.env.GITHUB_WEBHOOK_SECRET_FILE;
const secret = secretFile
  ? readFileSync(secretFile, 'utf8').trim()
  : (process.env.GITHUB_WEBHOOK_SECRET ?? '');
if (!secret) throw new Error('Set GITHUB_WEBHOOK_SECRET_FILE (or GITHUB_WEBHOOK_SECRET).');
const fixtures =
  process.env.FIXTURES_DIR ?? join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'webhooks');

async function waitFor(url: string, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

await waitFor(`${remit}/healthz`, 60_000);
await waitFor(`${github}/healthz`, 60_000);
const body = readFileSync(join(fixtures, 'pull_request.opened.json'), 'utf8');
const started = Date.now();
const res = await fetch(`${remit}/webhooks`, {
  method: 'POST',
  body,
  headers: {
    'content-type': 'application/json',
    'x-github-event': 'pull_request',
    'x-github-delivery': `smoke-${Date.now()}`,
    'x-hub-signature-256': signBody(secret, body),
  },
});
if (res.status !== 202) throw new Error(`webhook answered ${res.status}: ${await res.text()}`);
const end = Date.now() + 120_000;
for (;;) {
  const state = (await (await fetch(`${github}/__fake/state`)).json()) as {
    checkRuns: { status: string; conclusion: string | null }[];
    comments: Record<string, string[]>;
  };
  const done = state.checkRuns.find((r) => r.status === 'completed');
  if (done && (state.comments['acme/reports#77'] ?? []).length) {
    process.stdout.write(
      `smoke ok: check run ${done.conclusion}, comment posted, ${Date.now() - started} ms\n`,
    );
    process.exit(0);
  }
  if (Date.now() > end) throw new Error(`no completed check run: ${JSON.stringify(state)}`);
  await new Promise((r) => setTimeout(r, 500));
}
