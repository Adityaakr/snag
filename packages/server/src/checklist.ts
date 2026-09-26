/**
 * The issue-time checklist (BUILD_PROMPT 10.2): extraction and `issue.v0` run when the issue gets the configured
 * label (or an assignee), the checklist is posted as a sticky comment, `/remit confirm` stores it by issue content
 * hash, and editing the issue invalidates it and posts it again.
 */
import { type IssueRef, renderChecklist } from '@remit/core';
import { extractRequirements } from '@remit/pipeline';
import type { GitHubWriter } from '@remit/providers';
import { upsertSticky, withMarker } from '@remit/providers';
import type { JobDeps } from './review-job.js';
import { loadRepoConfig } from './repo-config.js';

export async function postChecklist(
  gh: GitHubWriter,
  ref: IssueRef,
  deps: JobDeps,
): Promise<{ requirements: number }> {
  const { config } = await loadRepoConfig(gh, ref.owner, ref.repo);
  const issue = await gh.getIssue(ref);
  const { jev, llm } = deps.providers(config);
  const ex = await extractRequirements([issue], {
    ...(jev ? { jev } : {}),
    ...(llm ? { llm } : {}),
    config,
    reviewId: `checklist_${ref.owner}_${ref.repo}_${ref.number}`,
  });
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
  );
  return { requirements: ex.requirements.filter((r) => !r.supersededBy).length };
}

/** `/remit confirm`: stores the posted checklist when it still matches the issue text. */
export async function confirmChecklist(
  gh: GitHubWriter,
  ref: IssueRef,
  login: string,
  deps: JobDeps,
): Promise<'confirmed' | 'stale' | 'none'> {
  const repo = `${ref.owner}/${ref.repo}`;
  const current = await deps.store.getChecklist(repo, ref.number);
  if (!current) return 'none';
  const issue = await gh.getIssue(ref);
  if (issue.contentHash !== current.contentHash) {
    await postChecklist(gh, ref, deps);
    return 'stale';
  }
  await deps.store.saveChecklist({ ...current, confirmedBy: login, confirmedAt: new Date().toISOString() });
  return 'confirmed';
}

/** Issue edited: any stored checklist no longer applies, so it is dropped and posted again. */
export async function invalidateChecklist(gh: GitHubWriter, ref: IssueRef, deps: JobDeps): Promise<boolean> {
  const current = await deps.store.getChecklist(`${ref.owner}/${ref.repo}`, ref.number);
  if (!current) return false;
  const issue = await gh.getIssue(ref);
  if (issue.contentHash === current.contentHash) return false;
  await deps.store.deleteChecklist(`${ref.owner}/${ref.repo}`, ref.number);
  await postChecklist(gh, ref, deps);
  return true;
}
