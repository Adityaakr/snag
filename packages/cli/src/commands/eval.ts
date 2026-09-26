/**
 * `remit eval <corpus> [--split dev|test] [--baseline single_pass|pr_agent] [--limit n] [--gate] [--mode ...]`
 * (BUILD_PROMPT 10.1, 11). Golden always runs scripted and must be 100%. Other corpora run live when keys exist,
 * else on the simulated Jev and are marked "not a real measurement". The test split runs only with --gate.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BRAND } from '@remit/core';
import {
  computeMetrics,
  type EvalItem,
  goldenItems,
  type ProviderMode,
  runItems,
  summaryLine,
  writeReport,
} from '@remit/eval';
import { loadConfig } from '../config.js';
import { CliError, EXIT } from '../errors.js';
import type { Io } from '../io.js';
import { buildProviders } from '../providers.js';

export type ItemLoader = (corpus: string, split: string) => EvalItem[];

function gitSha(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export async function evalCommand(argv: string[], io: Io, loadItems?: ItemLoader): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      split: { type: 'string', default: 'dev' },
      baseline: { type: 'string' },
      limit: { type: 'string' },
      gate: { type: 'boolean', default: false },
      mode: { type: 'string' },
      config: { type: 'string' },
      'no-log': { type: 'boolean', default: false },
    },
  });
  const corpus = positionals[0];
  if (!corpus || !['golden', 'mutations', 'swebench', 'shadow'].includes(corpus)) {
    throw new CliError(
      'remit eval needs a corpus: golden, mutations, swebench or shadow.',
      `Run \`${BRAND.slug} eval golden\` or \`${BRAND.slug} eval mutations --split dev\`.`,
    );
  }
  const split = corpus === 'golden' ? 'all' : (values.split as string);
  if (!['dev', 'test', 'all'].includes(split))
    throw new CliError(
      `--split ${split} is not dev or test.`,
      'Use --split dev (tuning) or --split test --gate (the frozen check).',
    );
  if (split === 'test' && !values.gate)
    throw new CliError(
      'The test split runs only with --gate (BUILD_PROMPT 11.2).',
      `Run \`pnpm eval:test --gate\`, and log the run in .agent/EXPERIMENTS.md.`,
    );
  const limit = values.limit ? Number(values.limit) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0))
    throw new CliError(`--limit ${values.limit} is not a positive integer.`, 'Pass --limit 20.');

  const config = loadConfig(io.cwd, values.config);
  const keys = Boolean(io.env.TYPESAFE_API_KEY);
  const mode = (values.mode ??
    (corpus === 'golden' ? 'scripted' : keys ? 'live' : 'simulated')) as ProviderMode;
  if (!['scripted', 'simulated', 'live'].includes(mode))
    throw new CliError(
      `--mode ${mode} is not scripted, simulated or live.`,
      'Omit --mode to pick automatically.',
    );
  const items =
    corpus === 'golden'
      ? goldenItems()
      : (loadItems ?? (await import('@remit/eval')).loadCorpus)(corpus, split);
  if (!items.length)
    throw new CliError(
      `Corpus ${corpus} (${split}) has no items.`,
      corpus === 'shadow'
        ? 'Shadow items come from stored feedback (M8); export them first.'
        : `Build it with \`pnpm eval:build\`.`,
    );

  const maxUsd = Number(io.env.EVAL_MAX_USD ?? 20);
  const p =
    mode === 'live'
      ? buildProviders(config, {
          ...io.env,
          REMIT_CACHE_MODE: io.env.REMIT_CACHE_MODE ?? 'replay_or_live',
          REMIT_CACHE_DIR: io.env.REMIT_CACHE_DIR ?? join(io.cwd, 'eval', 'cassettes'),
        })
      : undefined;
  if (mode === 'live' && !p?.jev)
    throw new CliError(
      'Live mode needs TYPESAFE_API_KEY.',
      'Add it to .env, or omit --mode to use the simulated stand-in.',
      EXIT.provider,
    );
  const { outcomes, stoppedForBudget } = await runItems(items, {
    mode,
    ...(p?.jev ? { jev: p.jev } : {}),
    ...(p?.llm ? { llm: p.llm } : {}),
    ...(limit ? { limit } : {}),
    maxUsd,
  });
  const metrics = computeMetrics(outcomes);
  const baselines: Record<string, { note: string }> = {};
  if (values.baseline)
    baselines[values.baseline] = {
      note: await (await import('@remit/eval')).baselineNote(values.baseline, io.env),
    };
  const info = {
    corpus,
    split,
    mode,
    gitSha: gitSha(io.cwd),
    startedAt: new Date().toISOString(),
    jevModel: mode === 'simulated' ? 'simulated-jev' : config.jev.model,
    stoppedForBudget,
    baselines,
  };
  const dir = writeReport(join(io.cwd, 'eval', 'reports'), info, metrics, outcomes);
  const line = summaryLine(info, metrics, dir.replace(`${io.cwd}/`, ''));
  const experiments = join(io.cwd, '.agent', 'EXPERIMENTS.md');
  if (!values['no-log'] && existsSync(experiments)) appendFileSync(experiments, `${line}\n`);
  io.out(`${line}\n`);
  if (corpus === 'golden') {
    const failed = outcomes.filter((o) => !o.comparison.passed);
    for (const f of failed)
      io.out(`FAILED ${f.item.id}: ${(f.comparison.goldenFailures ?? []).join('; ')}\n`);
    io.out(
      failed.length
        ? `Golden accuracy ${outcomes.length - failed.length}/${outcomes.length}.\n`
        : `Golden accuracy 100% (${outcomes.length}/${outcomes.length}).\n`,
    );
    return failed.length ? EXIT.gateFailure : EXIT.ok;
  }
  return stoppedForBudget ? EXIT.budget : EXIT.ok;
}
