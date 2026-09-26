/**
 * A local fake GitHub for `docker compose up` and the smoke check (BUILD_PROMPT M9): serves the
 * GitHub API for one golden scenario (acme/reports#77) and writes a freshly generated App private key to
 * `KEY_OUT` (and a random webhook secret to `WEBHOOK_SECRET_OUT`), so the server can run without real credentials.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { fakeRepo } from '../fake-harness.js';
import { fakeGitHubApi } from '../fake-github-server.js';

const port = Number(process.env.FAKE_GITHUB_PORT ?? 4000);
const keyOut = process.env.KEY_OUT ?? '.data/fake-app-key.pem';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
mkdirSync(dirname(keyOut), { recursive: true });
writeFileSync(keyOut, privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), { mode: 0o600 });
// A random webhook secret next to the key, so no secret is written in compose files or scripts.
const secretOut = process.env.WEBHOOK_SECRET_OUT ?? `${dirname(keyOut)}/webhook-secret`;
writeFileSync(secretOut, randomBytes(24).toString('hex'), { mode: 0o600 });
const repo = fakeRepo(process.env.FAKE_SCENARIO ?? 'three_reqs_one_missing');
const api = fakeGitHubApi(repo.gh, publicKey, process.env.GITHUB_APP_ID ?? '1');
api.app.get('/healthz', (c) => c.text('ok'));
serve({ fetch: api.app.fetch, port, hostname: process.env.FAKE_GITHUB_HOST ?? '0.0.0.0' });
process.stderr.write(`fake GitHub on :${port} (key at ${keyOut})\n`);
