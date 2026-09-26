/**
 * Record and replay for GitHub reads (BUILD_PROMPT 7.4, G.2 "cache every response"). The key covers the method and
 * its arguments. Used for eval seed mining, so reruns cost no API calls and work offline in replay mode.
 */
import type { IssueRef, IssueSnapshot } from '@remit/core';
import { type CacheMode, type CassetteStore, cacheKey } from '../cache/store.js';
import { ProviderError } from '../common/errors.js';
import type { ContentResult, GitHubMining, MergedPull, PullFile, PullRef, PullSnapshot } from './types.js';

export class CachedGitHub implements GitHubMining {
  hits = 0;
  misses = 0;

  constructor(
    private readonly inner: GitHubMining | null,
    private readonly store: CassetteStore,
    readonly mode: CacheMode,
  ) {}

  private async through<T>(
    method: string,
    args: unknown[],
    live: (gh: GitHubMining) => Promise<T>,
  ): Promise<T> {
    const request = { provider: 'github', method, args };
    const key = cacheKey(request);
    if (this.mode !== 'live' && this.mode !== 'record') {
      const hit = await this.store.get('github', key);
      if (hit) {
        this.hits++;
        return hit.response as T;
      }
      this.misses++;
      if (this.mode === 'replay' || !this.inner)
        throw new ProviderError(
          'github',
          'cache_miss',
          `no cassette for ${method}`,
          'Record with GITHUB_TOKEN set.',
        );
    }
    if (!this.inner) throw new ProviderError('github', 'config', 'CachedGitHub has no live provider');
    const response = await live(this.inner);
    if (this.mode !== 'live')
      await this.store.put('github', { key, request, response, recordedAt: new Date().toISOString() });
    return response;
  }

  getPull(ref: PullRef): Promise<PullSnapshot> {
    return this.through('getPull', [ref], (gh) => gh.getPull(ref));
  }
  listPullFiles(ref: PullRef): Promise<PullFile[]> {
    return this.through('listPullFiles', [ref], (gh) => gh.listPullFiles(ref));
  }
  getContent(owner: string, repo: string, path: string, ref: string): Promise<ContentResult> {
    return this.through('getContent', [owner, repo, path, ref], (gh) =>
      gh.getContent(owner, repo, path, ref),
    );
  }
  getIssue(ref: IssueRef): Promise<IssueSnapshot> {
    return this.through('getIssue', [ref], (gh) => gh.getIssue(ref));
  }
  closingIssues(ref: PullRef): Promise<IssueRef[]> {
    return this.through('closingIssues', [ref], (gh) => gh.closingIssues(ref));
  }
  searchMergedPulls(
    owner: string,
    repo: string,
    range: { from: string; to: string },
    limit: number,
  ): Promise<MergedPull[]> {
    return this.through('searchMergedPulls', [owner, repo, range, limit], (gh) =>
      gh.searchMergedPulls(owner, repo, range, limit),
    );
  }
  getLicense(owner: string, repo: string): Promise<string | null> {
    return this.through('getLicense', [owner, repo], (gh) => gh.getLicense(owner, repo));
  }
}
