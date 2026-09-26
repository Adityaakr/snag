import { type IssueRef, type IssueSnapshot, issueContentHash } from '@remit/core';
import { ProviderError } from '../common/errors.js';
import { commentRole, isBotComment } from './roles.js';
import type { ContentResult, GitHubProvider, PullFile, PullRef, PullSnapshot } from './types.js';

export interface FakeIssue {
  title: string;
  body: string;
  author: string;
  state?: 'open' | 'closed';
  comments?: {
    id: string;
    author: string;
    association?: string;
    userType?: string;
    createdAt?: string;
    body: string;
  }[];
}

export interface FakePull
  extends Omit<PullSnapshot, 'ref' | 'headRepo' | 'authorIsBot' | 'baseRef' | 'headRef'> {
  files: PullFile[];
  closing?: IssueRef[];
  headRepo?: string;
  authorIsBot?: boolean;
}

/** In-memory GitHub for tests (BUILD_PROMPT M2): pulls, files, issues, contents at a SHA. Records every call. */
export class FakeGitHub implements GitHubProvider {
  readonly calls: string[] = [];
  readonly pulls = new Map<string, FakePull>();
  readonly issues = new Map<string, FakeIssue>();
  /** `owner/repo@sha:path` -> content (a Buffer for binary). */
  readonly contents = new Map<string, string | Buffer>();

  private key(owner: string, repo: string, n: number) {
    return `${owner}/${repo}#${n}`;
  }

  addPull(ref: PullRef, pull: FakePull): this {
    this.pulls.set(this.key(ref.owner, ref.repo, ref.number), pull);
    return this;
  }

  addIssue(ref: IssueRef, issue: FakeIssue): this {
    this.issues.set(this.key(ref.owner, ref.repo, ref.number), issue);
    return this;
  }

  addContent(owner: string, repo: string, sha: string, path: string, content: string | Buffer): this {
    this.contents.set(`${owner}/${repo}@${sha}:${path}`, content);
    return this;
  }

  private pull(ref: PullRef): FakePull {
    const p = this.pulls.get(this.key(ref.owner, ref.repo, ref.number));
    if (!p) throw new ProviderError('github', 'bad_request', 'not found (404)');
    return p;
  }

  async getPull(ref: PullRef): Promise<PullSnapshot> {
    this.calls.push(`getPull ${this.key(ref.owner, ref.repo, ref.number)}`);
    const { files: _f, closing: _c, headRepo, authorIsBot, ...rest } = this.pull(ref);
    return {
      ...rest,
      ref,
      headRepo: headRepo ?? `${ref.owner}/${ref.repo}`,
      authorIsBot: authorIsBot ?? false,
      baseRef: 'main',
      headRef: 'feature',
    };
  }

  async listPullFiles(ref: PullRef): Promise<PullFile[]> {
    this.calls.push(`listPullFiles ${this.key(ref.owner, ref.repo, ref.number)}`);
    return this.pull(ref).files.slice(0, 3000);
  }

  async getContent(owner: string, repo: string, path: string, ref: string): Promise<ContentResult> {
    this.calls.push(`getContent ${owner}/${repo}@${ref}:${path}`);
    const c = this.contents.get(`${owner}/${repo}@${ref}:${path}`);
    if (c === undefined) return null;
    const buf = typeof c === 'string' ? Buffer.from(c) : c;
    if (buf.length > 1024 * 1024) return { skipped: 'too_large' };
    if (buf.includes(0)) return { skipped: 'binary' };
    return { content: buf.toString('utf8') };
  }

  async getIssue(ref: IssueRef): Promise<IssueSnapshot> {
    this.calls.push(`getIssue ${this.key(ref.owner, ref.repo, ref.number)}`);
    const i = this.issues.get(this.key(ref.owner, ref.repo, ref.number));
    if (!i) throw new ProviderError('github', 'bad_request', 'not found (404)');
    const comments = (i.comments ?? [])
      .filter((c) => !isBotComment(c.author, c.userType, c.body))
      .map((c) => ({
        id: c.id,
        author: c.author,
        role: commentRole(c.author, c.association, i.author),
        createdAt: c.createdAt ?? '2026-01-01T00:00:00Z',
        body: c.body,
      }));
    const snapshot = {
      ref,
      title: i.title,
      body: i.body,
      author: i.author,
      state: i.state ?? ('open' as const),
      comments,
    };
    return { ...snapshot, contentHash: issueContentHash(snapshot) };
  }

  async closingIssues(ref: PullRef): Promise<IssueRef[]> {
    this.calls.push(`closingIssues ${this.key(ref.owner, ref.repo, ref.number)}`);
    return this.pull(ref).closing ?? [];
  }
}
