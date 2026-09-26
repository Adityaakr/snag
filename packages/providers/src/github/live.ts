/**
 * GitHub over Octokit (BUILD_PROMPT 6.1). All network access for the CLI and eval mining goes through here.
 * Rate limits: primary limits wait until `x-ratelimit-reset`, secondary limits honor `retry-after`.
 */
import { BRAND, type IssueRef, type IssueSnapshot, issueContentHash } from '@remit/core';
import { graphql as baseGraphql } from '@octokit/graphql';
import { Octokit } from '@octokit/rest';
import { ProviderError } from '../common/errors.js';
import { type Logger, silentLogger } from '../common/limits.js';
import { type RetryOptions, withRetry } from '../common/retry.js';
import { commentRole, isBotComment } from './roles.js';
import type { ContentResult, GitHubProvider, PullFile, PullRef, PullSnapshot } from './types.js';

export const MAX_CONTENT_BYTES = 1024 * 1024;
export const MAX_PR_FILES = 3000;

export interface LiveGitHubOptions {
  token?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  logger?: Logger;
  retry?: RetryOptions;
  now?: () => number;
}

interface HttpErrorLike {
  status?: number;
  message?: string;
  response?: { headers?: Record<string, string | number | undefined> };
}

/** Classifies Octokit errors. Exported for tests. */
export function classifyGitHubError(e: unknown, now: () => number = Date.now): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = e as HttpErrorLike;
  const status = err.status;
  const headers = err.response?.headers ?? {};
  if (status === 403 || status === 429) {
    const retryAfter = Number(headers['retry-after']);
    if (Number.isFinite(retryAfter) && retryAfter > 0)
      return new ProviderError(
        'github',
        'rate_limited',
        `secondary rate limit (${status})`,
        undefined,
        retryAfter * 1000,
      );
    if (String(headers['x-ratelimit-remaining']) === '0') {
      const reset = Number(headers['x-ratelimit-reset']) * 1000;
      const wait = Number.isFinite(reset) ? Math.max(1000, reset - now() + 1000) : undefined;
      return new ProviderError(
        'github',
        'rate_limited',
        'rate limit exhausted',
        'Set GITHUB_TOKEN for a higher limit.',
        wait,
      );
    }
    if (status === 403)
      return new ProviderError(
        'github',
        'auth',
        'access denied (403)',
        'Check that GITHUB_TOKEN can read this repository.',
      );
  }
  if (status === 401)
    return new ProviderError(
      'github',
      'auth',
      'the token was rejected (401)',
      'Check GITHUB_TOKEN in .env; a read-only fine-grained token is enough.',
    );
  if (status === 404)
    return new ProviderError(
      'github',
      'bad_request',
      'not found (404)',
      'Check the URL, and that GITHUB_TOKEN can see the repository.',
    );
  if (status === 422)
    return new ProviderError('github', 'bad_request', `unprocessable (422): ${err.message ?? ''}`);
  if (status !== undefined && status >= 500)
    return new ProviderError('github', 'server', `server error (${status})`);
  return new ProviderError(
    'github',
    'connection',
    err.message ?? String(e),
    'Check network access to api.github.com.',
  );
}

export class LiveGitHub implements GitHubProvider {
  private readonly octokit: Octokit;
  private readonly gql: typeof baseGraphql;
  private readonly logger: Logger;
  private readonly now: () => number;

  constructor(private readonly opts: LiveGitHubOptions = {}) {
    const token = opts.token ?? process.env.GITHUB_TOKEN;
    this.logger = opts.logger ?? silentLogger;
    this.now = opts.now ?? Date.now;
    const request = opts.fetch ? { fetch: opts.fetch } : {};
    this.octokit = new Octokit({
      ...(token ? { auth: token } : {}),
      userAgent: `${BRAND.slug}`,
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      request,
      log: { debug() {}, info() {}, warn() {}, error() {} },
    });
    this.gql = baseGraphql.defaults({
      ...(token ? { headers: { authorization: `token ${token}` } } : {}),
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      request,
    });
    if (!token)
      this.logger.warn(
        { provider: 'github' },
        'GITHUB_TOKEN is not set; using the low unauthenticated rate limit',
      );
  }

  private call<T>(what: string, fn: () => Promise<T>): Promise<T> {
    return withRetry(
      async () => {
        try {
          return await fn();
        } catch (e) {
          throw classifyGitHubError(e, this.now);
        }
      },
      {
        ...this.opts.retry,
        onRetry: (err, attempt, delay) =>
          this.logger.warn(
            { provider: 'github', what, error: err.kind, attempt, delay },
            'retrying github call',
          ),
      },
    );
  }

  async getPull(ref: PullRef): Promise<PullSnapshot> {
    const { data } = await this.call('pull', () =>
      this.octokit.pulls.get({ owner: ref.owner, repo: ref.repo, pull_number: ref.number }),
    );
    return {
      ref,
      title: data.title,
      body: data.body ?? '',
      author: data.user?.login ?? 'ghost',
      authorIsBot: data.user?.type === 'Bot',
      draft: data.draft ?? false,
      baseSha: data.base.sha,
      headSha: data.head.sha,
      baseRef: data.base.ref,
      headRef: data.head.ref,
      headRepo: data.head.repo?.full_name ?? `${ref.owner}/${ref.repo}`,
    };
  }

  async listPullFiles(ref: PullRef): Promise<PullFile[]> {
    const files: PullFile[] = [];
    for (let page = 1; files.length < MAX_PR_FILES; page++) {
      const { data } = await this.call('files', () =>
        this.octokit.pulls.listFiles({
          owner: ref.owner,
          repo: ref.repo,
          pull_number: ref.number,
          per_page: 100,
          page,
        }),
      );
      for (const f of data) {
        files.push({
          filename: f.filename,
          ...(f.previous_filename ? { previousFilename: f.previous_filename } : {}),
          status: f.status,
          ...(f.patch !== undefined ? { patch: f.patch } : {}),
          additions: f.additions,
          deletions: f.deletions,
        });
      }
      if (data.length < 100) break;
    }
    return files.slice(0, MAX_PR_FILES);
  }

  async getContent(owner: string, repo: string, path: string, ref: string): Promise<ContentResult> {
    let data: unknown;
    try {
      data = (await this.call('content', () => this.octokit.repos.getContent({ owner, repo, path, ref })))
        .data;
    } catch (e) {
      if (e instanceof ProviderError && e.message.includes('404')) return null;
      throw e;
    }
    if (Array.isArray(data) || (data as { type?: string }).type !== 'file') return null;
    const file = data as { size: number; content?: string; encoding?: string };
    if (file.size > MAX_CONTENT_BYTES) return { skipped: 'too_large' };
    const buf = Buffer.from(file.content ?? '', (file.encoding as BufferEncoding) ?? 'base64');
    if (buf.includes(0)) return { skipped: 'binary' };
    return { content: buf.toString('utf8') };
  }

  async getIssue(ref: IssueRef): Promise<IssueSnapshot> {
    const { data: issue } = await this.call('issue', () =>
      this.octokit.issues.get({ owner: ref.owner, repo: ref.repo, issue_number: ref.number }),
    );
    const author = issue.user?.login ?? 'ghost';
    const comments: IssueSnapshot['comments'] = [];
    for (let page = 1; ; page++) {
      const { data } = await this.call('comments', () =>
        this.octokit.issues.listComments({
          owner: ref.owner,
          repo: ref.repo,
          issue_number: ref.number,
          per_page: 100,
          page,
        }),
      );
      for (const c of data) {
        const login = c.user?.login ?? 'ghost';
        const body = c.body ?? '';
        if (isBotComment(login, c.user?.type, body)) continue;
        comments.push({
          id: String(c.id),
          author: login,
          role: commentRole(login, c.author_association, author),
          createdAt: c.created_at,
          body,
        });
      }
      if (data.length < 100) break;
    }
    const snapshot = {
      ref,
      title: issue.title,
      body: issue.body ?? '',
      author,
      state: issue.state === 'closed' ? ('closed' as const) : ('open' as const),
      comments,
    };
    return { ...snapshot, contentHash: issueContentHash(snapshot) };
  }

  /** Core API rate limit headroom (used by `remit doctor`). */
  async rateLimit(): Promise<{ limit: number; remaining: number; resetAt: number }> {
    const { data } = await this.call('rateLimit', () => this.octokit.rateLimit.get());
    return {
      limit: data.resources.core.limit,
      remaining: data.resources.core.remaining,
      resetAt: data.resources.core.reset * 1000,
    };
  }

  async closingIssues(ref: PullRef): Promise<IssueRef[]> {
    const query = `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          closingIssuesReferences(first: 20) { nodes { number repository { name owner { login } } } }
        }
      }
    }`;
    type Result = {
      repository: {
        pullRequest: {
          closingIssuesReferences: {
            nodes: { number: number; repository: { name: string; owner: { login: string } } }[];
          };
        } | null;
      };
    };
    const data = await this.call('closingIssues', () =>
      this.gql<Result>(query, { owner: ref.owner, repo: ref.repo, number: ref.number }),
    );
    return (data.repository.pullRequest?.closingIssuesReferences.nodes ?? []).map((n) => ({
      owner: n.repository.owner.login,
      repo: n.repository.name,
      number: n.number,
    }));
  }
}
