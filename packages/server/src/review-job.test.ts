import { loadScenario, checkExpected } from '@remit/pipeline';
import { describe, expect, it } from 'vitest';
import { fakeRepo } from './fake-harness.js';
import { reviewPullRequest } from './review-job.js';
import { MemoryStore } from './store.js';

describe('reviewPullRequest against a fake GitHub', () => {
  it('matches the golden verdicts through the GitHub path and publishes every surface', async () => {
    const repo = fakeRepo('three_reqs_one_missing');
    const store = new MemoryStore();
    const out = await reviewPullRequest(repo.gh, repo.installationId, repo.pr, {
      providers: repo.providers,
      store,
      newId: () => 'rev_1',
    });
    expect(out.status).toBe('done');
    if (out.status !== 'done') return;
    expect(checkExpected(out.record.result, loadScenario('three_reqs_one_missing').expected)).toEqual([]);
    const run = repo.gh.checkRuns[0];
    expect(run).toMatchObject({
      name: 'Remit',
      headSha: 'head0000',
      status: 'completed',
      conclusion: 'neutral',
      externalId: 'rev_1',
    });
    const comments = await repo.gh.listIssueComments({ ...repo.pr });
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain('<!-- remit:summary v1 review=rev_1');
    expect(await store.latestReview('acme/reports', 77)).toMatchObject({ id: 'rev_1', headSha: 'head0000' });
  });
});
