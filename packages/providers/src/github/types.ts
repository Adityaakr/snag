/**
 * The GitHub provider contract (BUILD_PROMPT 6.1, 10.2). Read-side methods for M2; write methods (comments,
 * check runs, labels) are added with the App in M7.
 */
import type { IssueRef, IssueSnapshot } from '@remit/core';

export interface PullRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PullSnapshot {
  ref: PullRef;
  title: string;
  body: string;
  author: string;
  authorIsBot: boolean;
  draft: boolean;
  baseSha: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  /** Owner/repo of the head, which differs from the base for fork PRs. */
  headRepo: string;
}

export interface PullFile {
  filename: string;
  previousFilename?: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  /** Missing for binary files and very large diffs. */
  patch?: string;
  additions: number;
  deletions: number;
}

export type ContentResult = { content: string } | { skipped: 'too_large' | 'binary' } | null;

export type LinkStrength = 'closing' | 'weak' | 'none';

export interface LinkedIssues {
  issues: IssueRef[];
  strength: LinkStrength;
}

export interface GitHubProvider {
  getPull(ref: PullRef): Promise<PullSnapshot>;
  /** Changed files, paginated, capped at 3,000 (the API limit). */
  listPullFiles(ref: PullRef): Promise<PullFile[]>;
  /** File contents at a ref; null when missing, skipped over 1 MB or when binary. */
  getContent(owner: string, repo: string, path: string, ref: string): Promise<ContentResult>;
  /** Issue title, body and comments with roles; bots and Remit's own comments are skipped. */
  getIssue(ref: IssueRef): Promise<IssueSnapshot>;
  /** GraphQL `closingIssuesReferences` of a pull request. */
  closingIssues(ref: PullRef): Promise<IssueRef[]>;
}

export interface MergedPull {
  ref: PullRef;
  title: string;
  mergedAt: string;
}

/** Extra read methods for mining real eval seeds (BUILD_PROMPT G.2). */
export interface GitHubMining extends GitHubProvider {
  /** Merged pull requests of one repository, merged within [from, to] (YYYY-MM-DD), newest first. */
  searchMergedPulls(
    owner: string,
    repo: string,
    range: { from: string; to: string },
    limit: number,
  ): Promise<MergedPull[]>;
  /** The repository license as an SPDX id, or null. */
  getLicense(owner: string, repo: string): Promise<string | null>;
}

export interface CheckRunOutput {
  title: string;
  summary: string;
  /** At most 50 per request (the API limit); callers batch. */
  annotations?: {
    path: string;
    start_line: number;
    end_line: number;
    annotation_level: 'notice' | 'warning' | 'failure';
    title: string;
    message: string;
  }[];
}

export interface CheckRunInput {
  name: string;
  headSha: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'neutral' | 'success' | 'failure' | 'cancelled' | 'action_required';
  output?: CheckRunOutput;
  externalId?: string;
}

export interface IssueComment {
  id: number;
  body: string;
  author: string;
  authorIsBot: boolean;
}

export type RepoPermission = 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';

/** Write side for the GitHub App and the Action (BUILD_PROMPT 10.2, 10.3). */
export interface GitHubWriter extends GitHubProvider {
  createCheckRun(owner: string, repo: string, input: CheckRunInput): Promise<{ id: number }>;
  updateCheckRun(
    owner: string,
    repo: string,
    id: number,
    input: Partial<Omit<CheckRunInput, 'name' | 'headSha'>>,
  ): Promise<void>;
  listIssueComments(ref: IssueRef): Promise<IssueComment[]>;
  createIssueComment(ref: IssueRef, body: string): Promise<{ id: number }>;
  updateIssueComment(owner: string, repo: string, id: number, body: string): Promise<void>;
  addLabels(ref: IssueRef, labels: string[]): Promise<void>;
  /** Inline comments on the head commit, posted as one review with event COMMENT. */
  createReviewComments(
    ref: PullRef,
    headSha: string,
    comments: { path: string; line: number; body: string }[],
  ): Promise<void>;
  getPermission(owner: string, repo: string, user: string): Promise<RepoPermission>;
  getDefaultBranch(owner: string, repo: string): Promise<string>;
}
