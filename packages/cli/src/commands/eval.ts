/**
 * `remit eval <corpus> [--split dev|test] [--baseline single_pass|pr_agent] [--limit n] [--gate] [--mode ...]`
 * (BUILD_PROMPT 10.1, 11). Golden always runs scripted and must be 100%. Other corpora run live when keys exist,
 * else on the simulated Jev and are marked "not a real measurement". The test split runs only with --gate.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BRAND } from '@remit/core';
import {
  appendEvalRun,
  baselineMetrics,
  baselineNote,
  computeMetrics,
  type EvalItem,
  goldenItems,
  type ProviderMode,
  type RunInfo,
  runItems,
  measureStability,
  runSinglePass,
  summaryLine,
  writeReport,
} from '@remit/eval';
import { loadConfig } from '../config.js';
import { CliError, EXIT } from '../errors.js';
import type { Io } from '../io.js';
import { jevConfigured } from '@remit/providers';
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
      seeds: { type: 'string' },
      ids: { type: 'string' },
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
  if (values.gate && values['no-log'])
    throw new CliError(
      '--no-log cannot be used with --gate: every test-split run is logged (BUILD_PROMPT 11.2).',
      'Drop --no-log.',
    );
  const limit = values.limit ? Number(values.limit) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0))
    throw new CliError(`--limit ${values.limit} is not a positive integer.`, 'Pass --limit 20.');

  const config = loadConfig(io.cwd, values.config);
  const keys = jevConfigured(io.env);
  const mode = (values.mode ??
    (corpus === 'golden' ? 'scripted' : keys ? 'live' : 'simulated')) as ProviderMode;
  if (!['scripted', 'simulated', 'live'].includes(mode))
    throw new CliError(
      `--mode ${mode} is not scripted, simulated or live.`,
      'Omit --mode to pick automatically.',
    );
  const loaded =
    corpus === 'golden'
      ? goldenItems()
      : (loadItems ?? (await import('@remit/eval')).loadCorpus)(corpus, split);
  const items = selectItems(loaded, values.seeds, values.ids);
  if (loaded.length && !items.length)
    throw new CliError(
      `No ${corpus} (${split}) items match --seeds ${values.seeds ?? '(any)'} --ids ${values.ids ?? '(any)'}.`,
      'Check the seed ids (eval/corpora/mutations/seeds) and item id suffixes.',
    );
  if (!items.length)
    throw new CliError(
      `Corpus ${corpus} (${split}) has no items.`,
      corpus === 'shadow'
        ? 'Shadow items come from stored feedback (M8); export them first.'
        : corpus === 'swebench'
          ? 'Fetch and build it with `pnpm eval:fetch-a`.'
          : 'Build it with `pnpm remit mutate --all`.',
    );

  const maxUsd = Number(io.env.EVAL_MAX_USD ?? 20);
  const p =
    mode === 'live'
      ? buildProviders(
          config,
          {
            ...io.env,
            REMIT_CACHE_MODE: io.env.REMIT_CACHE_MODE ?? 'replay_or_live',
            REMIT_CACHE_DIR: io.env.REMIT_CACHE_DIR ?? join(io.cwd, 'eval', 'cassettes'),
          },
          // One run-wide provider tracker: its limit is the run's cap, not the per-review budget from the config.
          { budgetUsd: maxUsd },
        )
      : undefined;
  if (mode === 'live' && !p?.jev)
    throw new CliError(
      'Live mode needs TYPESAFE_API_KEY or REMIT_JEV_BASE_URL.',
      'Add it to .env, or omit --mode to use the simulated stand-in.',
      EXIT.provider,
    );
  const { outcomes, stoppedForBudget } = await runItems(items, {
    mode,
    ...(p?.jev ? { jev: p.jev } : {}),
    ...(p?.llm ? { llm: p.llm } : {}),
    ...(limit ? { limit } : {}),
    maxUsd,
    ...(p ? { spentUsd: () => p.costs.usage.costUsd } : {}),
  });
  const metrics = computeMetrics(outcomes);
  // Stability (11.4): the second extraction must not come from the cassette the first one wrote.
  const uncachedProviders =
    mode === 'live'
      ? buildProviders(config, { ...io.env, REMIT_CACHE_MODE: 'live' }, { budgetUsd: maxUsd })
      : undefined;
  const liveSpend = () => (p?.costs.usage.costUsd ?? 0) + (uncachedProviders?.costs.usage.costUsd ?? 0);
  // The stability re-extraction spends too; it runs only while the cap has room.
  if (liveSpend() < maxUsd)
    metrics.stability = await measureStability(
      outcomes.map((o) => o.item),
      p?.llm,
      uncachedProviders?.llm ?? p?.llm,
    );
  const baselines: NonNullable<RunInfo['baselines']> = {};
  if (values.baseline) {
    const note = await baselineNote(values.baseline, io.env);
    const llm =
      values.baseline === 'single_pass' ? (p?.llm ?? buildProviders(config, io.env).llm) : undefined;
    if (llm && note === 'available') {
      const run = items.slice(0, limit ?? items.length);
      const variants = [];
      for (const variant of ['remit_requirements', 'own_requirements'] as const) {
        const outs = [];
        for (const it of run) {
          if (liveSpend() >= maxUsd) break;
          outs.push(await runSinglePass(it, llm, variant));
        }
        variants.push(baselineMetrics(outs, variant));
        const failed = outs.filter((o) => o.error);
        if (failed.length)
          io.out(
            `${values.baseline} ${variant}: ${failed.length}/${outs.length} errors (first: ${failed[0]?.error})\n`,
          );
      }
      baselines[values.baseline] = { note: `live (${llm.model})`, variants };
    } else baselines[values.baseline] = { note };
  }
  const info = {
    corpus,
    split,
    mode,
    gitSha: gitSha(io.cwd),
    startedAt: new Date().toISOString(),
    jevModel: mode === 'simulated' ? 'simulated-jev' : config.jev.model,
    stoppedForBudget: stoppedForBudget || liveSpend() >= maxUsd,
    incompleteItems: outcomes.filter((o) => o.incomplete).length,
    baselines,
    ...(mode === 'live' ? { liveSpendUsd: Number(liveSpend().toFixed(4)) } : {}),
  };
  const dir = writeReport(join(io.cwd, 'eval', 'reports'), info, metrics, outcomes);
  const line = summaryLine(info, metrics, dir.replace(`${io.cwd}/`, ''));
  const experiments = join(io.cwd, '.agent', 'EXPERIMENTS.md');
  if (!values['no-log'] && existsSync(experiments)) appendEvalRun(experiments, line);
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

/**
 * Explicit item selection: `--seeds a,b` keeps items whose seed is listed, `--ids x,y` keeps items whose id ends with
 * one of the given suffixes. Both together must match. An empty result is an error, never a silent empty run.
 */
export function selectItems<T extends { id: string; seedId?: string }>(
  items: readonly T[],
  seeds?: string,
  ids?: string,
): T[] {
  const seedSet = seeds
    ? new Set(
        seeds
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      )
    : null;
  const idList = ids
    ? ids
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : null;
  return items.filter(
    (it) =>
      (!seedSet || (it.seedId !== undefined && seedSet.has(it.seedId))) &&
      (!idList || idList.some((suffix) => it.id.endsWith(suffix))),
  );
}
