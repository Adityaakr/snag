/**
 * GitHub OAuth for the dashboard (BUILD_PROMPT 9.10, 10.4): exchange the code for a user token, then read the user
 * and the App installations that user can access. The user token is used for these calls only and never stored.
 */
import { BRAND } from '@remit/core';
import { Octokit } from '@octokit/rest';
import { ProviderError } from '../common/errors.js';
import { classifyGitHubError } from './live.js';

export interface OAuthOptions {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  /** github.com by default. */
  webUrl?: string;
  apiUrl?: string;
}

export interface OAuthUser {
  login: string;
  installationIds: number[];
}

export async function exchangeOAuthCode(
  opts: OAuthOptions,
  code: string,
  redirectUri: string,
): Promise<string> {
  if (!/^[\w-]{1,100}$/.test(code)) throw new ProviderError('github', 'bad_request', 'invalid OAuth code');
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${opts.webUrl ?? 'https://github.com'}/login/oauth/access_token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': BRAND.slug },
      body: JSON.stringify({
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
  } catch (e) {
    throw new ProviderError('github', 'connection', `OAuth exchange failed: ${(e as Error).name}`);
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token)
    throw new ProviderError(
      'github',
      'auth',
      `GitHub refused the OAuth code (${body.error ?? res.status})`,
      'Sign in again.',
    );
  return body.access_token;
}

export async function oauthUser(opts: OAuthOptions, token: string): Promise<OAuthUser> {
  const octokit = new Octokit({
    auth: token,
    userAgent: BRAND.slug,
    ...(opts.apiUrl ? { baseUrl: opts.apiUrl } : {}),
    ...(opts.fetch ? { request: { fetch: opts.fetch } } : {}),
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  try {
    const { data: user } = await octokit.users.getAuthenticated();
    const installations = await octokit.paginate(octokit.apps.listInstallationsForAuthenticatedUser, {
      per_page: 100,
    });
    return { login: user.login, installationIds: installations.map((i) => i.id) };
  } catch (e) {
    throw classifyGitHubError(e);
  }
}
