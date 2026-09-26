/**
 * The GitHub Action (BUILD_PROMPT 10.3): reads the PR from the event payload and reviews it through the GitHub API
 * only (it never checks out or runs PR code), upserts the sticky comment, writes the job summary, emits annotations
 * as workflow commands, and exits according to the mode. Fork PRs on `pull_request` get no secrets, so they are
 * skipped with a notice.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import {
  annotations,
  BRAND,
  type Calibration,
  checkTitle,
  parseConfig,
  type RemitConfig,
  renderComment,
  renderRework,
  type ReviewResult,
} from '@remit/core';
import { ingestPullRequest, runReview } from '@remit/pipeline';
import { type GitHubWriter, LiveGitHub, providersFromEnv, upsertSticky, withMarker } from '@remit/providers';
import { z } from 'zod';

export interface ActionIo {
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  /** For tests: a GitHub client instead of LiveGitHub. */
  github?: GitHubWriter;
  calibration?: Calibration;
  providers?: typeof providersFromEnv;
}

const input = (env: Record<string, string | undefined>, name: string) =>
  env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`]?.trim() ?? '';

const Event = z.object({
  pull_request: z
    .object({
      number: z.number().int(),
      head: z.object({ repo: z.object({ full_name: z.string() }).nullable() }),
      base: z.object({ repo: z.object({ full_name: z.string() }) }),
    })
    .optional(),
  repository: z.object({
    name: z.string(),
    owner: z.object({ login: z.string() }),
    default_branch: z.string().optional(),
  }),
});

/** Workflow command escaping (GitHub docs: "Workflow commands"). */
export function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
export function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export function annotationCommands(r: ReviewResult): string[] {
  return annotations(r).map((a) => {
    const level =
      a.annotation_level === 'failure' ? 'error' : a.annotation_level === 'warning' ? 'warning' : 'notice';
    return `::${level} file=${escapeProperty(a.path)},line=${a.start_line},endLine=${a.end_line},title=${escapeProperty(a.title)}::${escapeData(a.message)}`;
  });
}

/** Exit code per mode (6.9): gate fails only on a gate decision of fail; other modes never fail the job. */
export function exitCode(r: ReviewResult): number {
  return r.summary.mode === 'gate' && r.summary.gateDecision === 'fail' ? 1 : 0;
}

async function loadConfig(
  gh: GitHubWriter,
  owner: string,
  repo: string,
  path: string,
): Promise<{ config: RemitConfig; errors: string[] }> {
  const branch = await gh.getDefaultBranch(owner, repo);
  const file = await gh.getContent(owner, repo, path, branch);
  return file && 'content' in file ? parseConfig(file.content) : parseConfig('');
}

export async function runAction(io: ActionIo): Promise<number> {
  const { env, out } = io;
  const notice = (m: string) => out(`::notice title=${BRAND.name}::${escapeData(m)}\n`);
  const eventName = env.GITHUB_EVENT_NAME ?? '';
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') {
    notice(`${BRAND.name} runs on pull_request or pull_request_target events; got "${eventName}".`);
    return 0;
  }
  const event = Event.parse(JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? '', 'utf8')));
  if (!event.pull_request) {
    notice('The event has no pull request.');
    return 0;
  }
  const owner = event.repository.owner.login;
  const repo = event.repository.name;
  const fork = event.pull_request.head.repo?.full_name !== event.pull_request.base.repo.full_name;
  const keys = {
    TYPESAFE_API_KEY: input(env, 'typesafe-api-key'),
    ANTHROPIC_API_KEY: input(env, 'anthropic-api-key'),
    OPENAI_COMPATIBLE_API_KEY: input(env, 'openai-compatible-api-key'),
    OPENAI_COMPATIBLE_BASE_URL: input(env, 'openai-compatible-base-url'),
  };
  if (eventName === 'pull_request' && fork && !keys.TYPESAFE_API_KEY) {
    notice(
      'This PR comes from a fork, and GitHub does not pass secrets to fork PRs on pull_request, so the review is skipped. See docs/github-action.md for the pull_request_target setup.',
    );
    return 0;
  }
  const token = input(env, 'github-token') || env.GITHUB_TOKEN || '';
  const gh =
    io.github ?? new LiveGitHub({ token, ...(env.GITHUB_API_URL ? { baseUrl: env.GITHUB_API_URL } : {}) });
  const loaded = await loadConfig(gh, owner, repo, input(env, 'config-path') || `.${BRAND.slug}.yml`);
  const config: RemitConfig = { ...loaded.config };
  const mode = input(env, 'mode');
  if (mode) {
    if (!['comment_only', 'rework', 'gate'].includes(mode))
      throw new Error(`mode "${mode}" is not comment_only, rework or gate.`);
    config.mode = mode as RemitConfig['mode'];
  }
  const budget = input(env, 'budget-usd');
  if (budget) {
    const usd = Number(budget);
    if (!(usd > 0)) throw new Error(`budget-usd "${budget}" is not a positive number.`);
    config.budgets = { ...config.budgets, max_usd_per_review: usd };
  }
  const ref = { owner, repo, number: event.pull_request.number };
  const ingest = await ingestPullRequest(gh, ref);
  // Linked issues are read only inside the PR's own account (9.7).
  const foreign = ingest.input.issues.filter((i) => i.ref.owner.toLowerCase() !== owner.toLowerCase());
  if (foreign.length) {
    ingest.input.issues = ingest.input.issues.filter((i) => !foreign.includes(i));
    ingest.input.issueRefs = ingest.input.issues.map((i) => i.ref);
    if (!ingest.input.issues.length) ingest.input.linkStrength = 'none';
    for (const i of foreign)
      ingest.warnings.push(
        `Issue ${i.ref.owner}/${i.ref.repo}#${i.ref.number} is outside this account, so it was not used.`,
      );
  }
  const p = (io.providers ?? providersFromEnv)(config, { ...keys, REMIT_CACHE_MODE: 'live' });
  const reviewId = `action_${env.GITHUB_RUN_ID ?? 'local'}_${env.GITHUB_RUN_ATTEMPT ?? '1'}`;
  const result = await runReview(ingest.input, {
    ...(p.jev ? { jev: p.jev } : {}),
    ...(p.llm ? { llm: p.llm } : {}),
    ...(io.calibration ? { calibration: io.calibration } : {}),
    config,
    reviewId,
    costs: p.costs,
    contents: ingest.contents,
  });
  result.warnings.unshift(...loaded.errors, ...ingest.warnings, ...p.notes);
  const issueRef = { owner, repo, number: ref.number };
  const comment = renderComment(result, { reviewId });
  if (config.surfaces.sticky_comment) await upsertSticky(gh, issueRef, 'summary', comment);
  if (config.mode === 'rework') {
    const rework = renderRework(result, { mention: config.rework.mention });
    if (rework) await upsertSticky(gh, issueRef, 'rework', withMarker('rework', rework));
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${comment}\n`);
  for (const line of annotationCommands(result)) out(`${line}\n`);
  out(`${BRAND.name}: ${checkTitle(result)}\n`);
  const code = exitCode(result);
  if (config.mode === 'gate' && result.summary.gateDecision === 'refused')
    notice('Gate mode was refused (no calibration evidence), so this job does not fail.');
  return code;
}
