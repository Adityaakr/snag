/**
 * `remit review <pr-url>` and `remit review --issue <url|file> --diff <file|range> [--pr-body <file>]`
 * (BUILD_PROMPT 10.1). Exit codes: 0 ok, 1 gate failure, 2 usage or config, 3 provider or network, 4 budget
 * exceeded (partial result written).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BRAND,
  explainFinding,
  type RemitConfig,
  renderComment,
  renderJson,
  renderRework,
  renderSarif,
  renderTerminal,
  type ReviewResult,
} from '@remit/core';
import {
  estimateReview,
  ingestPullRequest,
  parsePullTarget,
  type ReviewDeps,
  type ReviewInput,
  runReview,
} from '@remit/pipeline';
import { ProviderError } from '@remit/providers';
import pino from 'pino';
import { loadConfig } from '../config.js';
import { CliError, EXIT } from '../errors.js';
import type { Io } from '../io.js';
import { buildProviders, type CliProviders } from '../providers.js';
import { loadIssue } from './extract.js';
import { loadDiff } from './units.js';

export interface PreparedReview {
  input: ReviewInput;
  deps: Omit<ReviewDeps, 'config' | 'reviewId'>;
  notes: string[];
}

function readFile(cwd: string, path: string, flag: string): string {
  try {
    return readFileSync(isAbsolute(path) ? path : join(cwd, path), 'utf8');
  } catch {
    throw new CliError(`${flag} ${path} could not be read.`, 'Check the path.');
  }
}

/** Builds the review input for local or GitHub mode. */
export async function prepareReview(
  args: { target?: string; issues: string[]; diff?: string; prBody?: string },
  io: Io,
  p: CliProviders,
  config: RemitConfig,
): Promise<PreparedReview> {
  if (args.target) {
    const ref = parsePullTarget(args.target);
    if (!ref)
      throw new CliError(
        `"${args.target}" is not a pull request URL.`,
        'Use https://github.com/owner/repo/pull/12 or owner/repo#12, or --issue and --diff for a local review.',
      );
    const ing = await ingestPullRequest(p.github, ref);
    if (ing.pr.draft && config.draft_prs === 'skip') {
      throw new CliError(
        'This PR is a draft and draft_prs is skip.',
        'Mark it ready for review, or set draft_prs: review.',
        EXIT.ok,
      );
    }
    return {
      input: ing.input,
      deps: { contents: ing.contents },
      notes: [
        ...ing.warnings,
        'Unreferenced-symbol checks need the head tree and are skipped in GitHub mode from the CLI.',
      ],
    };
  }
  if (!args.issues.length || !args.diff) {
    throw new CliError(
      `${BRAND.slug} review needs a PR URL, or --issue and --diff.`,
      `Run \`${BRAND.slug} review https://github.com/owner/repo/pull/12\` or \`${BRAND.slug} review --issue issue.md --diff main...HEAD\`.`,
    );
  }
  const issues = [];
  for (const target of args.issues) issues.push(await loadIssue(target, io.cwd, p.github));
  issues.sort((a, b) => a.ref.number - b.ref.number);
  const diff = loadDiff(args.diff, io.cwd);
  const input: ReviewInput = {
    mode: 'local',
    baseSha: diff.baseSha,
    headSha: diff.headSha,
    linkStrength: 'closing',
    issueRefs: issues.map((i) => i.ref),
    issues,
    pr: { title: '', body: args.prBody ? readFile(io.cwd, args.prBody, '--pr-body') : '' },
    diffText: diff.text,
  };
  return {
    input,
    deps: {
      ...(diff.contents ? { contents: diff.contents } : {}),
      ...(diff.references ? { references: diff.references } : {}),
      ...(diff.attributes ? { attributes: diff.attributes } : {}),
    },
    notes: [],
  };
}

/** Exit code for a finished review. */
export function exitCodeFor(r: ReviewResult): number {
  if (r.summary.gateDecision === 'fail') return EXIT.gateFailure;
  if (r.warnings.some((w) => w.startsWith('Budget reached'))) return EXIT.budget;
  return EXIT.ok;
}

export async function reviewCommand(argv: string[], io: Io, providers?: CliProviders): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      issue: { type: 'string', multiple: true },
      diff: { type: 'string' },
      'pr-body': { type: 'string' },
      json: { type: 'boolean', default: false },
      markdown: { type: 'boolean', default: false },
      sarif: { type: 'boolean', default: false },
      out: { type: 'string' },
      offline: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'budget-usd': { type: 'string' },
      explain: { type: 'string' },
      config: { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
  });
  if ([values.json, values.markdown, values.sarif].filter(Boolean).length > 1) {
    throw new CliError(
      '--json, --markdown and --sarif are exclusive on stdout.',
      'Pick one, or use --out <dir> to write all of them.',
    );
  }
  const budgetUsd = values['budget-usd'] !== undefined ? Number(values['budget-usd']) : undefined;
  if (budgetUsd !== undefined && !(Number.isFinite(budgetUsd) && budgetUsd > 0))
    throw new CliError(
      `--budget-usd ${values['budget-usd']} is not a positive number.`,
      'Pass a dollar amount such as --budget-usd 0.25.',
    );
  const config = loadConfig(io.cwd, values.config);
  const reviewId = `rv_${Date.now().toString(36)}`;
  const logger = values.verbose
    ? pino(
        { level: io.env.REMIT_LOG_LEVEL ?? 'debug', redact: ['*.apiKey', '*.authorization', '*.token'] },
        pino.destination(2),
      ).child({ reviewId })
    : undefined;
  const p =
    providers ??
    buildProviders(config, io.env, {
      offline: values.offline,
      ...(budgetUsd !== undefined ? { budgetUsd } : {}),
      ...(logger ? { logger } : {}),
    });

  try {
    const prepared = await prepareReview(
      {
        ...(positionals[0] ? { target: positionals[0] } : {}),
        issues: values.issue ?? [],
        ...(values.diff ? { diff: values.diff } : {}),
        ...(values['pr-body'] ? { prBody: values['pr-body'] } : {}),
      },
      io,
      p,
      config,
    );
    if (values['dry-run']) {
      const est = await estimateReview(prepared.input, config, prepared.deps.contents);
      io.out(
        values.json
          ? `${JSON.stringify(est, null, 2)}\n`
          : [
              `Dry run: about ${est.calls.total} calls (${est.calls.extraction} extraction, ${est.calls.issue} issue, ${est.calls.forward} forward, ${est.calls.tests} tests, ${est.calls.reverse} reverse, ${est.calls.claims} claims)`,
              `${est.requirements} requirement(s) guessed, ${est.units} unit(s) (${est.testUnits} test), ${est.sentences} PR sentence(s)`,
              `Jev input about ${est.jevInputTokens} tokens; LLM about ${est.llmInputTokens} in and ${est.llmOutputTokens} out`,
              `Estimated cost $${est.costUsd.toFixed(4)} (budget $${(budgetUsd ?? config.budgets.max_usd_per_review).toFixed(2)})`,
              ...est.notes.map((n) => `note: ${n}`),
              '',
            ].join('\n'),
      );
      return EXIT.ok;
    }
    const result = await runReview(prepared.input, {
      ...prepared.deps,
      ...(p.jev ? { jev: p.jev } : {}),
      ...(p.llm ? { llm: p.llm } : {}),
      costs: p.costs,
      config,
      reviewId,
    });
    result.warnings.unshift(...p.notes, ...prepared.notes);

    if (values.out) {
      const dir = isAbsolute(values.out) ? values.out : join(io.cwd, values.out);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'review.json'), renderJson(result));
      writeFileSync(join(dir, 'comment.md'), renderComment(result, { reviewId }));
      writeFileSync(join(dir, 'review.sarif'), `${JSON.stringify(renderSarif(result), null, 2)}\n`);
      writeFileSync(join(dir, 'terminal.txt'), renderTerminal(result));
      const rework = renderRework(result, { mention: config.rework.mention });
      if (rework) writeFileSync(join(dir, 'rework.md'), rework);
    }
    if (values.explain) {
      const text = explainFinding(result, values.explain, config.thresholds);
      if (!text)
        throw new CliError(
          `No finding ${values.explain} in this review.`,
          `Findings: ${result.findings.map((f) => f.id).join(', ') || 'none'}.`,
        );
      io.out(text);
    } else if (values.json) io.out(renderJson(result));
    else if (values.markdown) io.out(renderComment(result, { reviewId }));
    else if (values.sarif) io.out(`${JSON.stringify(renderSarif(result), null, 2)}\n`);
    else io.out(renderTerminal(result, { color: Boolean(process.stdout.isTTY) && !io.env.NO_COLOR }));
    return exitCodeFor(result);
  } catch (e) {
    if (e instanceof ProviderError)
      throw new CliError(
        e.message,
        e.fix ?? `Run \`${BRAND.slug} doctor\` to check keys and connectivity.`,
        e.kind === 'budget' ? EXIT.budget : EXIT.provider,
      );
    throw e;
  }
}
