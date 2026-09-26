import { type IssueRef, type IssueSnapshot, issueContentHash } from '@remit/core';
import { ProviderError } from '../common/errors.js';
import { commentRole, isBotComment } from './roles.js';
import type {
  CheckRunInput,
  ContentResult,
  GitHubMining,
  GitHubWriter,
  IssueComment,
  MergedPull,
  PullFile,
  PullRef,
  PullSnapshot,
  RepoPermission,
} from './types.js';

export interface FakeCheckRun extends CheckRunInput {
  id: number;
  owner: string;
  repo: string;
  /** Every annotation sent across create and update calls. */
  annotations: NonNullable<NonNullable<CheckRunInput['output']>['annotations']>;
  updates: number;
}

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
export class FakeGitHub implements GitHubMining, GitHubWriter {
  readonly calls: string[] = [];
  readonly pulls = new Map<string, FakePull>();
  readonly issues = new Map<string, FakeIssue>();
  /** `owner/repo@sha:path` -> content (a Buffer for binary). */
  readonly contents = new Map<string, string | Buffer>();
  readonly licenses = new Map<string, string>();
  readonly checkRuns: FakeCheckRun[] = [];
  /** Comments posted through the writer, per `owner/repo#n`. */
  readonly posted = new Map<string, IssueComment[]>();
  readonly labels = new Map<string, string[]>();
  readonly reviewComments: { pull: string; headSha: string; path: string; line: number; body: string }[] = [];
  readonly permissions = new Map<string, RepoPermission>();
  readonly defaultBranches = new Map<string, string>();
  /** The login the writer posts as. */
  botLogin = 'remit[bot]';
  private nextId = 1000;
  readonly merged = new Map<string, string>();

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

  /** Marks a pull as merged at a date (for searchMergedPulls). */
  setMerged(ref: PullRef, mergedAt: string): this {
    this.merged.set(this.key(ref.owner, ref.repo, ref.number), mergedAt);
    return this;
  }

  async searchMergedPulls(
    owner: string,
    repo: string,
    range: { from: string; to: string },
    limit: number,
  ): Promise<MergedPull[]> {
    this.calls.push(`searchMergedPulls ${owner}/${repo}`);
    const out: MergedPull[] = [];
    for (const [key, pull] of this.pulls) {
      const m = /^(.+)\/(.+)#(\d+)$/.exec(key);
      const mergedAt = this.merged.get(key);
      if (!m || m[1] !== owner || m[2] !== repo || !mergedAt) continue;
      const day = mergedAt.slice(0, 10);
      if (day < range.from || day > range.to) continue;
      out.push({ ref: { owner, repo, number: Number(m[3]) }, title: pull.title, mergedAt });
    }
    return out.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt)).slice(0, limit);
  }

  async getLicense(owner: string, repo: string): Promise<string | null> {
    this.calls.push(`getLicense ${owner}/${repo}`);
    return this.licenses.get(`${owner}/${repo}`) ?? null;
  }

  async createCheckRun(owner: string, repo: string, input: CheckRunInput): Promise<{ id: number }> {
    this.calls.push(`createCheckRun ${owner}/${repo}@${input.headSha}`);
    const run: FakeCheckRun = {
      ...input,
      id: this.nextId++,
      owner,
      repo,
      annotations: [...(input.output?.annotations ?? [])],
      updates: 0,
    };
    this.assertBatch(input.output?.annotations);
    this.checkRuns.push(run);
    return { id: run.id };
  }

  async updateCheckRun(
    owner: string,
    repo: string,
    id: number,
    input: Partial<Omit<CheckRunInput, 'name' | 'headSha'>>,
  ): Promise<void> {
    this.calls.push(`updateCheckRun ${owner}/${repo} ${id}`);
    const run = this.checkRuns.find((r) => r.id === id && r.owner === owner && r.repo === repo);
    if (!run) throw new ProviderError('github', 'bad_request', 'not found (404)');
    this.assertBatch(input.output?.annotations);
    if (input.status) run.status = input.status;
    if (input.conclusion) run.conclusion = input.conclusion;
    if (input.output) {
      run.output = { title: input.output.title, summary: input.output.summary };
      run.annotations.push(...(input.output.annotations ?? []));
    }
    run.updates++;
  }

  private assertBatch(annotations: unknown[] | undefined) {
    if ((annotations?.length ?? 0) > 50)
      throw new ProviderError('github', 'bad_request', 'unprocessable (422): more than 50 annotations');
  }

  async listIssueComments(ref: IssueRef): Promise<IssueComment[]> {
    const key = this.key(ref.owner, ref.repo, ref.number);
    this.calls.push(`listIssueComments ${key}`);
    const original = (this.issues.get(key)?.comments ?? []).map((c, i) => ({
      id: i + 1,
      body: c.body,
      author: c.author,
      authorIsBot: c.userType === 'Bot',
    }));
    return [...original, ...(this.posted.get(key) ?? [])];
  }

  async createIssueComment(ref: IssueRef, body: string): Promise<{ id: number }> {
    const key = this.key(ref.owner, ref.repo, ref.number);
    this.calls.push(`createIssueComment ${key}`);
    const c = { id: this.nextId++, body, author: this.botLogin, authorIsBot: true };
    this.posted.set(key, [...(this.posted.get(key) ?? []), c]);
    return { id: c.id };
  }

  async updateIssueComment(owner: string, repo: string, id: number, body: string): Promise<void> {
    this.calls.push(`updateIssueComment ${owner}/${repo} ${id}`);
    for (const [key, list] of this.posted)
      if (key.startsWith(`${owner}/${repo}#`)) {
        const c = list.find((x) => x.id === id);
        if (c) {
          c.body = body;
          return;
        }
      }
    throw new ProviderError('github', 'bad_request', 'not found (404)');
  }

  async addLabels(ref: IssueRef, labels: string[]): Promise<void> {
    const key = this.key(ref.owner, ref.repo, ref.number);
    this.calls.push(`addLabels ${key}`);
    this.labels.set(key, [...new Set([...(this.labels.get(key) ?? []), ...labels])]);
  }

  async createReviewComments(
    ref: PullRef,
    headSha: string,
    comments: { path: string; line: number; body: string }[],
  ): Promise<void> {
    const pull = this.key(ref.owner, ref.repo, ref.number);
    this.calls.push(`createReviewComments ${pull}`);
    for (const c of comments) this.reviewComments.push({ pull, headSha, ...c });
  }

  async getPermission(owner: string, repo: string, user: string): Promise<RepoPermission> {
    this.calls.push(`getPermission ${owner}/${repo} ${user}`);
    return this.permissions.get(`${owner}/${repo}:${user}`) ?? 'none';
  }

  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    this.calls.push(`getDefaultBranch ${owner}/${repo}`);
    return this.defaultBranches.get(`${owner}/${repo}`) ?? 'main';
  }
}
