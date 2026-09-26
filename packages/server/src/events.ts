/**
 * Webhook event routing (BUILD_PROMPT 10.2). Every handler only enqueues work, so the webhook answers fast. Payloads
 * are parsed with zod at this boundary; unknown events and actions are acknowledged and ignored.
 */
import { BRAND, sanitize } from '@remit/core';
import type { GitHubWriter } from '@remit/providers';
import { z } from 'zod';
import { confirmChecklist, invalidateChecklist, postChecklist } from './checklist.js';
import type { JobQueue, JobSpec } from './queue.js';
import { RateLimiter } from './session.js';
import { loadRepoConfig } from './repo-config.js';
import { type JobDeps, reviewPullRequest } from './review-job.js';
import { explainMarkdown, HELP, isBotLogin, parseSlash, WRITE_ROLES } from './slash.js';

export interface AppDeps extends JobDeps {
  /** A client authenticated as the installation, with a fresh token per job, narrowed to `repo` when given. */
  github: (installationId: number, repo?: string) => Promise<GitHubWriter>;
  queue: JobQueue;
  /** Burst window for `synchronize` events (default 30 s). */
  debounceMs?: number;
  /** Reviews per installation per hour before PR events are delayed instead of reviewed at once (M9). */
  reviewsPerHour?: number;
  /** Nightly jobs: retention cleanup and recalibration from feedback (M8). */
  maintenance?: (kind: 'cleanup' | 'recalibrate') => Promise<void>;
}

const Repo = z.object({ name: z.string(), owner: z.object({ login: z.string() }) });
const User = z.object({ login: z.string(), type: z.string().optional() });
const Installation = z.object({ id: z.number().int() });

const PullEvent = z.object({
  action: z.string(),
  installation: Installation,
  repository: Repo,
  pull_request: z.object({ number: z.number().int() }),
  changes: z.record(z.string(), z.unknown()).optional(),
});
const CheckRunEvent = z.object({
  action: z.string(),
  installation: Installation,
  repository: Repo,
  check_run: z.object({ name: z.string(), pull_requests: z.array(z.object({ number: z.number().int() })) }),
});
const CommentEvent = z.object({
  action: z.string(),
  installation: Installation,
  repository: Repo,
  issue: z.object({ number: z.number().int(), pull_request: z.unknown().optional(), user: User }),
  comment: z.object({ id: z.number().int(), body: z.string().nullable(), user: User }),
});
const IssueEvent = z.object({
  action: z.string(),
  installation: Installation,
  repository: Repo,
  issue: z.object({ number: z.number().int() }),
  label: z.object({ name: z.string() }).optional(),
});
const InstallationEvent = z.object({
  action: z.string(),
  installation: Installation.extend({ account: z.object({ login: z.string() }).optional() }),
  repositories: z.array(z.object({ full_name: z.string() })).optional(),
});
const InstallationReposEvent = z.object({
  action: z.string(),
  installation: Installation,
  repositories_added: z.array(z.object({ full_name: z.string() })).default([]),
  repositories_removed: z.array(z.object({ full_name: z.string() })).default([]),
});

export const PULL_ACTIONS = new Set(['opened', 'synchronize', 'reopened', 'ready_for_review', 'edited']);

export type Handled = { handled: string } | { ignored: string };

/** Per-installation review rate (M9): past the limit, events are debounced for 5 minutes instead of dropped. */
const limiters = new WeakMap<AppDeps, RateLimiter>();
export const RATE_LIMITED_DEBOUNCE_MS = 5 * 60_000;
function rateDebounce(deps: AppDeps, installationId: number, debounceMs: number): number {
  if (!deps.reviewsPerHour) return debounceMs;
  let limiter = limiters.get(deps);
  if (!limiter) {
    limiter = new RateLimiter(deps.reviewsPerHour, 3600_000);
    limiters.set(deps, limiter);
  }
  if (limiter.allow(String(installationId))) return debounceMs;
  deps.metrics?.inc('remit_reviews_delayed_total');
  return Math.max(debounceMs, RATE_LIMITED_DEBOUNCE_MS);
}

function enqueueReview(
  deps: AppDeps,
  installationId: number,
  owner: string,
  repo: string,
  pr: number,
  debounceMs = 0,
) {
  return deps.queue.enqueue(
    `review:${owner}/${repo}#${pr}`,
    { kind: 'review', installationId, owner, repo, pr },
    { debounceMs },
  );
}

/** Runs one queued job (the queue's handler). */
export async function runJob(job: JobSpec, deps: AppDeps, signal: AbortSignal): Promise<void> {
  switch (job.kind) {
    case 'review': {
      const gh = await deps.github(job.installationId, job.repo);
      await reviewPullRequest(
        gh,
        job.installationId,
        { owner: job.owner, repo: job.repo, number: job.pr },
        deps,
        signal,
      );
      return;
    }
    case 'slash': {
      const e = CommentEvent.parse(job.event);
      const cmd = parseSlash(e.comment.body ?? '');
      if (cmd) await runSlash(e, cmd, deps);
      return;
    }
    case 'issue': {
      const ref = { owner: job.owner, repo: job.repo, number: job.number };
      const gh = await deps.github(job.installationId, job.repo);
      if (job.action === 'edited') {
        await invalidateChecklist(gh, ref, deps, job.installationId);
        return;
      }
      const { config } = await loadRepoConfig(gh, ref.owner, ref.repo);
      const wanted =
        (job.action === 'labeled' &&
          config.issue_checklist === 'on_label' &&
          job.label === config.issue_checklist_label) ||
        (job.action === 'assigned' && config.issue_checklist === 'on_assign');
      if (wanted) await postChecklist(gh, ref, deps, job.installationId);
      return;
    }
    case 'cleanup':
    case 'recalibrate':
      await deps.maintenance?.(job.kind);
      return;
  }
}

export async function handleEvent(name: string, payload: unknown, deps: AppDeps): Promise<Handled> {
  switch (name) {
    case 'pull_request': {
      const e = PullEvent.parse(payload);
      if (!PULL_ACTIONS.has(e.action)) return { ignored: `pull_request.${e.action}` };
      // Edits matter only when the title or body changed (links may move); bursts are debounced like pushes.
      if (e.action === 'edited' && !e.changes?.title && !e.changes?.body)
        return { ignored: 'pull_request.edited (no title or body change)' };
      const debounce = rateDebounce(
        deps,
        e.installation.id,
        e.action === 'synchronize' || e.action === 'edited' ? (deps.debounceMs ?? 30_000) : 0,
      );
      await enqueueReview(
        deps,
        e.installation.id,
        e.repository.owner.login,
        e.repository.name,
        e.pull_request.number,
        debounce,
      );
      return { handled: `pull_request.${e.action}` };
    }
    case 'check_run': {
      const e = CheckRunEvent.parse(payload);
      if (e.action !== 'rerequested' || e.check_run.name !== BRAND.checkName)
        return { ignored: `check_run.${e.action}` };
      for (const p of e.check_run.pull_requests)
        await enqueueReview(deps, e.installation.id, e.repository.owner.login, e.repository.name, p.number);
      return { handled: 'check_run.rerequested' };
    }
    case 'issue_comment': {
      const e = CommentEvent.parse(payload);
      if (e.action !== 'created' && e.action !== 'edited') return { ignored: `issue_comment.${e.action}` };
      if (isBotLogin(e.comment.user.login, e.comment.user.type)) return { ignored: 'bot comment' };
      const cmd = parseSlash(e.comment.body ?? '');
      if (!cmd) return { ignored: 'no command' };
      await deps.queue.enqueue(
        `slash:${e.repository.owner.login}/${e.repository.name}#${e.issue.number}:${e.comment.id}`,
        {
          kind: 'slash',
          event: payload,
        },
      );
      return { handled: `slash.${cmd.name}` };
    }
    case 'issues': {
      const e = IssueEvent.parse(payload);
      if (!['labeled', 'assigned', 'edited'].includes(e.action)) return { ignored: `issues.${e.action}` };
      const ref = { owner: e.repository.owner.login, repo: e.repository.name, number: e.issue.number };
      await enqueueIssue(deps, e.installation.id, ref, e.action, e.label?.name);
      return { handled: `issues.${e.action}` };
    }
    case 'installation': {
      const e = InstallationEvent.parse(payload);
      if (e.action === 'created')
        await deps.store.addInstallation(
          e.installation.id,
          e.installation.account?.login ?? 'unknown',
          (e.repositories ?? []).map((r) => r.full_name),
        );
      else if (e.action === 'deleted') await deps.store.deleteInstallation(e.installation.id);
      else return { ignored: `installation.${e.action}` };
      return { handled: `installation.${e.action}` };
    }
    case 'installation_repositories': {
      const e = InstallationReposEvent.parse(payload);
      await deps.store.setRepositories(
        e.installation.id,
        e.repositories_added.map((r) => r.full_name),
        e.repositories_removed.map((r) => r.full_name),
      );
      return { handled: `installation_repositories.${e.action}` };
    }
    case 'ping':
      return { handled: 'ping' };
    default:
      return { ignored: name };
  }
}

/** Checklist runs spend provider money: debounce edits like pushes and apply the installation's hourly rate. */
async function enqueueIssue(
  deps: AppDeps,
  installationId: number,
  ref: { owner: string; repo: string; number: number },
  action: string,
  label?: string,
): Promise<void> {
  await deps.queue.enqueue(
    `issue:${ref.owner}/${ref.repo}#${ref.number}`,
    { kind: 'issue', installationId, ...ref, action, ...(label ? { label } : {}) },
    {
      debounceMs: rateDebounce(deps, installationId, action === 'edited' ? (deps.debounceMs ?? 30_000) : 0),
    },
  );
}

async function runSlash(
  e: z.infer<typeof CommentEvent>,
  cmd: NonNullable<ReturnType<typeof parseSlash>>,
  deps: AppDeps,
): Promise<void> {
  const owner = e.repository.owner.login;
  const repo = e.repository.name;
  const ref = { owner, repo, number: e.issue.number };
  const login = e.comment.user.login;
  const gh = await deps.github(e.installation.id, e.repository.name);
  const role = await gh.getPermission(owner, repo, login);
  const isIssueAuthor = e.issue.user.login === login;
  const allowed = WRITE_ROLES.has(role) || (cmd.name === 'confirm' && isIssueAuthor && !e.issue.pull_request);
  if (!allowed) return;
  const reply = (text: string) => gh.createIssueComment(ref, text);
  const isPr = Boolean(e.issue.pull_request);
  switch (cmd.name) {
    case 'help':
    case 'unknown':
      await reply(HELP);
      return;
    case 'review':
      if (isPr) await enqueueReview(deps, e.installation.id, owner, repo, e.issue.number);
      return;
    case 'confirm': {
      if (isPr) {
        await reply(`\`${BRAND.slashCommand} confirm\` works on issues, not pull requests.`);
        return;
      }
      const r = await confirmChecklist(gh, ref, login, deps, e.installation.id);
      if (r === 'stale') await enqueueIssue(deps, e.installation.id, ref, 'edited');
      await reply(
        r === 'confirmed'
          ? `Checklist confirmed by @${sanitize(login, 40)}. Reviews of PRs for this issue will use it.`
          : r === 'stale'
            ? 'The issue changed since the checklist was posted, so it will be read again shortly. Please check the new list and confirm again.'
            : `There is no ${BRAND.name} checklist on this issue yet.`,
      );
      return;
    }
    case 'agree':
    case 'disagree':
    case 'explain': {
      const latest = await deps.store.latestReview(`${owner}/${repo}`, e.issue.number);
      if (!latest) {
        await reply(`${BRAND.name} has not reviewed this PR yet.`);
        return;
      }
      if (cmd.name === 'explain') {
        const { config } = await loadRepoConfig(gh, owner, repo);
        const text = explainMarkdown(latest.result, cmd.id, config.thresholds);
        await reply(text ?? `There is no finding ${cmd.id} in the latest review.`);
        return;
      }
      const found = cmd.ids.map((id) => latest.result.findings.find((f) => f.id === id));
      // An edited comment re-runs its command: keep one label per finding and person.
      const prior = await deps.store.feedback(`${owner}/${repo}`, e.issue.number);
      for (const f of found)
        if (
          f &&
          !prior.some((p) => p.contentKey === f.contentKey && p.login === login && p.label === cmd.name)
        )
          await deps.store.addFeedback({
            repo: `${owner}/${repo}`,
            pr: e.issue.number,
            findingId: f.id,
            contentKey: f.contentKey,
            login,
            label: cmd.name,
            ...(cmd.name === 'disagree' && cmd.reason ? { reason: cmd.reason } : {}),
            source: 'slash',
            createdAt: new Date().toISOString(),
          });
      for (const f of found)
        if (f) deps.metrics?.inc('remit_feedback_total', { label: cmd.name, source: 'slash' });
      const missing = cmd.ids.filter((_, i) => !found[i]);
      await reply(
        `Recorded ${cmd.name} for ${found.filter(Boolean).length} finding${found.filter(Boolean).length === 1 ? '' : 's'}.${missing.length ? ` Not found in the latest review: ${missing.map((m) => `\`${m}\``).join(', ')}.` : ''}`,
      );
      return;
    }
  }
}
