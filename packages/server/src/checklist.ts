/**
 * The issue-time checklist (BUILD_PROMPT 10.2): extraction and `issue.v0` run when the issue gets the configured
 * label (or an assignee), the checklist is posted as a sticky comment, `/remit confirm` stores it by issue content
 * hash, and editing the issue invalidates it and posts it again.
 */
import { randomUUID } from 'node:crypto';
import { type IssueRef, renderChecklist } from '@remit/core';
import { extractRequirements } from '@remit/pipeline';
import type { GitHubWriter } from '@remit/providers';
import { upsertSticky, withMarker } from '@remit/providers';
import type { JobDeps } from './review-job.js';
import { reserveBudget } from './budget.js';
import { silent } from './logger.js';
import { loadRepoConfig } from './repo-config.js';

export async function postChecklist(
  gh: GitHubWriter,
  ref: IssueRef,
  deps: JobDeps,
  installationId: number,
): Promise<{ requirements: number } | { skipped: 'daily budget reached' }> {
  const loaded = await loadRepoConfig(gh, ref.owner, ref.repo);
  const issue = await gh.getIssue(ref);
  const runId = `checklist_${randomUUID()}`;
  const log = (deps.logger ?? silent).child({ runId, repo: `${ref.owner}/${ref.repo}`, issue: ref.number });
  // Extraction spends provider money, so it goes through the same daily budget as reviews (9.13).
  const reservation = await reserveBudget(
    deps.store,
    deps.dailyBudgetUsd,
    installationId,
    runId,
    loaded.config,
    log,
  );
  if (reservation === 'over') {
    deps.metrics?.inc('remit_budget_skips_total');
    return { skipped: 'daily budget reached' };
  }
  const config = reservation.config;
  const built = deps.providers(config);
  let ex: Awaited<ReturnType<typeof extractRequirements>>;
  try {
    ex = await extractRequirements([issue], {
      ...(built.jev ? { jev: built.jev } : {}),
      ...(built.llm ? { llm: built.llm } : {}),
      config,
      reviewId: runId,
    });
  } finally {
    await reservation.settle(built.costs?.usage.costUsd ?? 0);
  }
  await deps.store.saveChecklist({
    repo: `${ref.owner}/${ref.repo}`,
    issue: ref.number,
    contentHash: issue.contentHash,
    requirements: ex.requirements,
  });
  const body = renderChecklist(ex.requirements, ex.openQuestions);
  await upsertSticky(
    gh,
    ref,
    'checklist',
    withMarker('checklist', body, `hash=${issue.contentHash.slice(0, 12)}`),
    deps.botLogin,
  );
  return { requirements: ex.requirements.filter((r) => !r.supersededBy).length };
}

/** `/remit confirm`: stores the posted checklist when it still matches the issue text. */
export async function confirmChecklist(
  gh: GitHubWriter,
  ref: IssueRef,
  login: string,
  deps: JobDeps,
  installationId: number,
): Promise<'confirmed' | 'stale' | 'none'> {
  const repo = `${ref.owner}/${ref.repo}`;
  const current = await deps.store.getChecklist(repo, ref.number);
  if (!current) return 'none';
  const issue = await gh.getIssue(ref);
  // A stale checklist is read again by the caller through the debounced, rate-limited issue queue, never inline.
  if (issue.contentHash !== current.contentHash) return 'stale';
  await deps.store.saveChecklist({ ...current, confirmedBy: login, confirmedAt: new Date().toISOString() });
  return 'confirmed';
}

/** Issue edited: any stored checklist no longer applies, so it is dropped and posted again. */
export async function invalidateChecklist(
  gh: GitHubWriter,
  ref: IssueRef,
  deps: JobDeps,
  installationId: number,
): Promise<boolean> {
  const current = await deps.store.getChecklist(`${ref.owner}/${ref.repo}`, ref.number);
  if (!current) return false;
  const issue = await gh.getIssue(ref);
  if (issue.contentHash === current.contentHash) return false;
  await deps.store.deleteChecklist(`${ref.owner}/${ref.repo}`, ref.number);
  await postChecklist(gh, ref, deps, installationId);
  return true;
}
