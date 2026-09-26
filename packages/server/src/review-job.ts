/**
 * One App review (BUILD_PROMPT 10.2 "Review flow"): create the check run as in progress, run the pipeline, upsert
 * the sticky comment (and the rework comment in rework mode), complete the check run with the mode's conclusion and
 * batched annotations, add optional inline comments and labels, and store the result. A superseded job stops at the
 * next step boundary and marks its check run cancelled.
 */
import { randomUUID } from 'node:crypto';
import {
  BRAND,
  type Calibration,
  checkRun,
  type RemitConfig,
  renderComment,
  renderRework,
  type ReviewResult,
  sanitize,
} from '@remit/core';
import { trace } from '@opentelemetry/api';
import { ingestPullRequest, runReview } from '@remit/pipeline';
import {
  CostTracker,
  type GitHubWriter,
  type JevProvider,
  type LlmProvider,
  type PullRef,
} from '@remit/providers';
import { upsertSticky, withMarker } from '@remit/providers';
import type { Metrics } from './metrics.js';
import { type Logger, silent } from './logger.js';
import { CONFIG_PATH, loadRepoConfig } from './repo-config.js';
import type { ReviewRecord, Store } from './store.js';
import { weakLabels } from './weak-labels.js';

export interface JobDeps {
  /** Jev and LLM providers for a repository's config (keys come from env). */
  providers: (config: RemitConfig) => { jev?: JevProvider; llm?: LlmProvider; costs?: CostTracker };
  store: Store;
  calibration?: (jevModel: string) => Calibration | undefined;
  metrics?: Metrics;
  newId?: () => string;
  /** The login the App posts as (`<slug>[bot]`), so sticky comments by other bots are never edited. */
  botLogin?: string;
  logger?: Logger;
  /** Per-installation daily provider budget in USD (9.13); reviews past it are skipped with a notice. */
  dailyBudgetUsd?: number;
}

export type ReviewOutcome =
  | { status: 'done'; record: ReviewRecord }
  | { status: 'skipped'; reason: string }
  | { status: 'cancelled' };

class Superseded extends Error {}

const tracer = trace.getTracer('remit');

/** One App review, traced (OpenTelemetry, a no-op unless the operator registers an SDK) and logged with its id. */
export async function reviewPullRequest(
  gh: GitHubWriter,
  installationId: number,
  ref: PullRef,
  deps: JobDeps,
  signal: AbortSignal = new AbortController().signal,
): Promise<ReviewOutcome> {
  return tracer.startActiveSpan('remit.review', async (span) => {
    span.setAttribute('remit.repo', `${ref.owner}/${ref.repo}`);
    span.setAttribute('remit.pr', ref.number);
    try {
      const out = await runPullReview(gh, installationId, ref, deps, signal);
      span.setAttribute('remit.status', out.status);
      return out;
    } catch (e) {
      span.recordException(e as Error);
      throw e;
    } finally {
      span.end();
    }
  });
}

async function runPullReview(
  gh: GitHubWriter,
  installationId: number,
  ref: PullRef,
  deps: JobDeps,
  signal: AbortSignal = new AbortController().signal,
): Promise<ReviewOutcome> {
  const repo = `${ref.owner}/${ref.repo}`;
  const reviewId = deps.newId?.() ?? `rev_${randomUUID()}`;
  const log = (deps.logger ?? silent).child({ reviewId, repo, pr: ref.number });
  const check = (s: AbortSignal) => {
    if (s.aborted) throw new Superseded();
  };
  const { config, errors } = await loadRepoConfig(gh, ref.owner, ref.repo);
  const pull = await gh.getPull(ref);
  if (pull.draft && config.draft_prs === 'skip')
    return { status: 'skipped', reason: 'draft PR (draft_prs: skip)' };
  if (deps.dailyBudgetUsd !== undefined) {
    const spent = await deps.store.spendToday(installationId);
    if (spent >= deps.dailyBudgetUsd) {
      log.warn({ spent, limit: deps.dailyBudgetUsd }, 'daily budget reached; review skipped');
      deps.metrics?.inc('remit_budget_skips_total');
      if (config.surfaces.check_run)
        await gh.createCheckRun(ref.owner, ref.repo, {
          name: BRAND.checkName,
          headSha: pull.headSha,
          status: 'completed',
          conclusion: 'neutral',
          output: {
            title: 'Daily budget reached',
            summary: `This installation reached its daily ${BRAND.name} budget ($${deps.dailyBudgetUsd.toFixed(2)}). Reviews resume after midnight UTC; reply \`${BRAND.slashCommand} review\` then.`,
          },
        });
      return { status: 'skipped', reason: 'daily budget reached' };
    }
  }
  log.info({ head: pull.headSha }, 'review started');
  check(signal);
  const run = config.surfaces.check_run
    ? await gh.createCheckRun(ref.owner, ref.repo, {
        name: BRAND.checkName,
        headSha: pull.headSha,
        status: 'in_progress',
        externalId: reviewId,
      })
    : null;
  const started = Date.now();
  try {
    check(signal);
    const ingest = await ingestPullRequest(gh, ref);
    check(signal);
    const notes = [...errors, ...ingest.warnings];
    // Linked issues are read only inside the PR's own account (9.7): an issue elsewhere could be attacker-controlled.
    const foreign = ingest.input.issues.filter((i) => i.ref.owner.toLowerCase() !== ref.owner.toLowerCase());
    if (foreign.length) {
      ingest.input.issues = ingest.input.issues.filter((i) => !foreign.includes(i));
      ingest.input.issueRefs = ingest.input.issues.map((i) => i.ref);
      if (!ingest.input.issues.length) ingest.input.linkStrength = 'none';
      for (const i of foreign)
        notes.push(
          `Issue ${i.ref.owner}/${i.ref.repo}#${i.ref.number} is outside this account, so it was not used.`,
        );
    }
    if (
      ingest.input.diffText
        .split('\n')
        .some((l) => l.startsWith('diff --git ') && l.endsWith(` b/${CONFIG_PATH}`))
    )
      notes.push(
        `This PR edits ${CONFIG_PATH}; the change applies after it is merged into the default branch.`,
      );
    const { jev, llm, costs } = deps.providers(config);
    const reviewCosts = costs ?? new CostTracker(config.budgets.max_usd_per_review);
    const calibration = deps.calibration?.(jev?.model ?? config.jev.model);
    const result = await runReview(ingest.input, {
      ...(jev ? { jev } : {}),
      ...(llm ? { llm } : {}),
      ...(calibration ? { calibration } : {}),
      config,
      reviewId,
      // The providers record spend on this tracker, so the per-review budget holds (9.13).
      costs: reviewCosts,
      contents: ingest.contents,
      confirmed: async (issue) => {
        const c = await deps.store.getChecklist(`${issue.ref.owner}/${issue.ref.repo}`, issue.ref.number);
        return c?.confirmedBy && c.contentHash === issue.contentHash ? c.requirements : null;
      },
    });
    result.warnings.unshift(...notes);
    check(signal);
    // Another process may have started a review of a newer push: the latest head wins (10.2).
    if ((await gh.getPull(ref)).headSha !== pull.headSha) throw new Superseded();
    await publish(gh, ref, result, config, reviewId, run?.id, deps.botLogin);
    const record: ReviewRecord = {
      id: reviewId,
      installationId,
      repo,
      pr: ref.number,
      headSha: pull.headSha,
      result,
      createdAt: new Date().toISOString(),
      input: ingest.input,
      retention: {
        retainPayloads: config.retention.retain_payloads,
        retentionDays: config.retention.retention_days,
      },
      apiCalls: [...reviewCosts.log],
      config,
    };
    const previous = await deps.store.latestReview(repo, ref.number);
    await deps.store.saveReview(record);
    if (previous) {
      const existing = new Set(
        (await deps.store.feedback(repo, ref.number))
          .filter((f) => f.source === 'implicit')
          .map((f) => f.contentKey),
      );
      for (const label of weakLabels(previous.result, result, { repo, pr: ref.number, at: record.createdAt }))
        if (!existing.has(label.contentKey)) {
          await deps.store.addFeedback(label);
          deps.metrics?.inc('remit_feedback_total', { label: label.label, source: 'implicit' });
        }
    }
    deps.metrics?.observeReview('done', (Date.now() - started) / 1000, result.usage.costUsd, result.findings);
    deps.metrics?.observeCalls(reviewCosts.log);
    log.info(
      { findings: result.findings.length, costUsd: result.usage.costUsd, latencyMs: Date.now() - started },
      'review done',
    );
    return { status: 'done', record };
  } catch (e) {
    if (e instanceof Superseded) {
      if (run)
        await gh.updateCheckRun(ref.owner, ref.repo, run.id, {
          status: 'completed',
          conclusion: 'cancelled',
          output: {
            title: 'Superseded by a newer push',
            summary: `${BRAND.name} is reviewing the latest commit instead.`,
          },
        });
      deps.metrics?.observeReview('cancelled', (Date.now() - started) / 1000, 0, []);
      log.info('review cancelled: a newer push superseded it');
      return { status: 'cancelled' };
    }
    if (run)
      await gh.updateCheckRun(ref.owner, ref.repo, run.id, {
        status: 'completed',
        conclusion: 'neutral',
        output: {
          title: `${BRAND.name} could not finish this review`,
          summary: sanitize(
            `The review failed: ${(e as Error).message}. It will run again on the next push, or reply \`${BRAND.slashCommand} review\`.`,
            1000,
          ),
        },
      });
    deps.metrics?.observeReview('failed', (Date.now() - started) / 1000, 0, []);
    log.error({ error: (e as Error).message }, 'review failed');
    throw e;
  }
}

const LABELS = { p0: `${BRAND.slug}:needs-work`, clean: `${BRAND.slug}:matches-issue` } as const;

/** Steps 3 to 5 of the review flow. */
async function publish(
  gh: GitHubWriter,
  ref: PullRef,
  result: ReviewResult,
  config: RemitConfig,
  reviewId: string,
  checkRunId: number | undefined,
  botLogin?: string,
): Promise<void> {
  const issueRef = { owner: ref.owner, repo: ref.repo, number: ref.number };
  if (config.surfaces.sticky_comment)
    await upsertSticky(gh, issueRef, 'summary', renderComment(result, { reviewId }), botLogin);
  if (config.mode === 'rework') {
    const rework = renderRework(result, { mention: config.rework.mention });
    if (rework) await upsertSticky(gh, issueRef, 'rework', withMarker('rework', rework), botLogin);
  }
  if (checkRunId !== undefined) {
    const model = checkRun(result, reviewId);
    const output = { title: model.title, summary: model.summary.slice(0, 65_000) };
    const batches = model.annotationBatches.length ? model.annotationBatches : [[]];
    for (const [i, batch] of batches.entries()) {
      const last = i === batches.length - 1;
      await gh.updateCheckRun(ref.owner, ref.repo, checkRunId, {
        ...(last ? { status: 'completed' as const, conclusion: model.conclusion } : {}),
        output: { ...output, annotations: batch },
      });
    }
  }
  if (config.surfaces.inline_comments) {
    const comments = result.findings
      .filter((f) => (f.priority === 'P0' || f.priority === 'P1') && f.type !== 'requirement')
      .flatMap((f) =>
        f.locations
          .filter((l) => l.lines[1] > 0)
          .slice(0, 1)
          .map((l) => ({
            path: l.file,
            line: l.lines[1],
            body: `**${BRAND.name} ${f.id}** (${f.priority}): ${sanitize(f.reasons.map((x) => x.text).join(' '), 600)}`,
          })),
      )
      .slice(0, 20);
    await gh.createReviewComments(ref, result.input.headSha, comments);
  }
  if (config.surfaces.labels) {
    const p0 = result.findings.some((f) => f.priority === 'P0');
    const done =
      result.requirementVerdicts.length > 0 && result.requirementVerdicts.every((v) => v.status === 'done');
    await gh.addLabels(issueRef, p0 ? [LABELS.p0] : done ? [LABELS.clean] : []);
  }
}
