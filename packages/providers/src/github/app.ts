/**
 * GitHub App authentication (BUILD_PROMPT 9.2, 10.2): an RS256 app JWT signed with the private key, exchanged for a
 * short-lived installation token per job. Tokens are never persisted. Also the manifest-flow code exchange for
 * `/setup`.
 */
import { createSign } from 'node:crypto';
import { BRAND } from '@remit/core';
import { Octokit } from '@octokit/rest';
import { ProviderError } from '../common/errors.js';
import { type RetryOptions, withRetry } from '../common/retry.js';
import { classifyGitHubError } from './live.js';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** An app JWT valid for 9 minutes, back-dated 60 s for clock drift (GitHub allows at most 10 minutes). */
export function appJwt(appId: string, privateKeyPem: string, nowMs = Date.now()): string {
  const now = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  let signature: Buffer;
  try {
    signature = signer.sign(privateKeyPem);
  } catch {
    throw new ProviderError(
      'github',
      'config',
      'the GitHub App private key could not be used',
      'Set GITHUB_APP_PRIVATE_KEY to the PEM from the app settings (or run /setup).',
    );
  }
  return `${header}.${payload}.${b64url(signature)}`;
}

export interface AppCredentials {
  appId: string;
  privateKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  retry?: RetryOptions;
}

function client(auth: string, opts: Pick<AppCredentials, 'baseUrl' | 'fetch'>): Octokit {
  return new Octokit({
    auth,
    userAgent: BRAND.slug,
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.fetch ? { request: { fetch: opts.fetch } } : {}),
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
}

/** A fresh installation token, scoped to one installation, for one job. */
export async function installationToken(
  creds: AppCredentials,
  installationId: number,
  nowMs = Date.now(),
): Promise<{ token: string; expiresAt: string }> {
  const octokit = client(appJwt(creds.appId, creds.privateKey, nowMs), creds);
  return withRetry(async () => {
    try {
      const { data } = await octokit.apps.createInstallationAccessToken({ installation_id: installationId });
      return { token: data.token, expiresAt: data.expires_at };
    } catch (e) {
      throw classifyGitHubError(e);
    }
  }, creds.retry);
}

export interface ManifestConversion {
  id: number;
  slug: string;
  htmlUrl: string;
  pem: string;
  webhookSecret: string;
  clientId: string;
  clientSecret: string;
}

/** Exchanges the manifest-flow code for the new app's credentials (no auth needed; the code is single-use). */
export async function convertManifest(
  code: string,
  opts: Pick<AppCredentials, 'baseUrl' | 'fetch'> = {},
): Promise<ManifestConversion> {
  if (!/^[\w-]{1,100}$/.test(code)) throw new ProviderError('github', 'bad_request', 'invalid manifest code');
  const octokit = new Octokit({
    userAgent: BRAND.slug,
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.fetch ? { request: { fetch: opts.fetch } } : {}),
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  try {
    const { data } = await octokit.apps.createFromManifest({ code });
    return {
      id: data.id,
      slug: data.slug ?? String(data.id),
      htmlUrl: data.html_url,
      pem: data.pem,
      webhookSecret: data.webhook_secret ?? '',
      clientId: data.client_id,
      clientSecret: data.client_secret,
    };
  } catch (e) {
    throw classifyGitHubError(e);
  }
}
