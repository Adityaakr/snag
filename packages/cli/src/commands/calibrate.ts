/**
 * `remit calibrate [--mode simulated|live] [--passes n] [--limit n] [--out <dir>]` (BUILD_PROMPT 10.1, 11.5): fits
 * calibration and tunes thresholds on the dev split only, then stores eval/calibration/<jev-model>/<question-set>.json.
 * A calibration fitted in simulated mode is stored under `simulated-jev` and never applies to a real model.
 */
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CALIBRATION_ROOT,
  calibrateOnDev,
  type EvalItem,
  loadCorpus,
  type ProviderMode,
  writeCalibration,
} from '@remit/eval';
import { loadConfig } from '../config.js';
import { CliError, EXIT } from '../errors.js';
import type { Io } from '../io.js';
import { buildProviders } from '../providers.js';

export type DevLoader = (corpus: string) => EvalItem[];

export async function calibrateCommand(argv: string[], io: Io, loadDev?: DevLoader): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      mode: { type: 'string' },
      passes: { type: 'string', default: '1' },
      limit: { type: 'string' },
      out: { type: 'string' },
      config: { type: 'string' },
    },
  });
  const config = loadConfig(io.cwd, values.config);
  const mode = (values.mode ?? (io.env.TYPESAFE_API_KEY ? 'live' : 'simulated')) as ProviderMode;
  if (mode !== 'simulated' && mode !== 'live')
    throw new CliError(`--mode ${mode} is not simulated or live.`, 'Omit --mode to pick automatically.');
  const passes = Number(values.passes);
  if (!(Number.isInteger(passes) && passes > 0))
    throw new CliError('--passes must be a positive integer.', 'Pass --passes 2.');
  const limit = values.limit ? Number(values.limit) : undefined;
  const load = loadDev ?? ((c: string) => loadCorpus(c, 'dev'));
  // Corpus A needs LLM extraction, so it joins only live runs.
  const items = [...load('mutations'), ...(mode === 'live' ? load('swebench') : [])].slice(0, limit);
  if (!items.length)
    throw new CliError('No dev items to calibrate on.', 'Build corpus B with `pnpm remit mutate --all`.');
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
      'Live calibration needs TYPESAFE_API_KEY.',
      'Add it to .env, or pass --mode simulated.',
      EXIT.provider,
    );
  const jevModel = mode === 'simulated' ? 'simulated-jev' : (p?.jev?.model ?? config.jev.model);
  let sha = 'unknown';
  try {
    sha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: io.cwd, encoding: 'utf8' }).trim();
  } catch {}
  const result = await calibrateOnDev(
    items,
    {
      mode,
      ...(p?.jev ? { jev: p.jev } : {}),
      ...(p?.llm ? { llm: p.llm } : {}),
      maxUsd: Number(io.env.EVAL_MAX_USD ?? 20),
    },
    config.eval,
    { id: `cal-${new Date().toISOString().slice(0, 10)}-${sha}`, jevModel },
    { passes },
  );
  const path = writeCalibration(values.out ? resolve(io.cwd, values.out) : CALIBRATION_ROOT, result);
  const keys = Object.entries(result.fits)
    .map(
      ([k, f]) =>
        `${k} n=${f.n}${f.identity ? ' identity' : ` ECE ${f.eceBefore.toFixed(2)}->${f.eceAfter.toFixed(2)}`}`,
    )
    .join('; ');
  io.out(
    `${mode === 'simulated' ? 'Simulated (not a real measurement). ' : ''}Calibrated on ${items.length} dev items: ${keys}.\n` +
      `Tuning cost ${result.tuning.before.cost} -> ${result.tuning.after.cost} over ${result.tuning.evaluations} runs; thresholds ${JSON.stringify(result.tuning.thresholds)}.\n` +
      `P0 precision ${result.p0PrecisionBefore.toFixed(2)} -> ${result.calibration.p0Precision.toFixed(2)}. Wrote ${path}\n`,
  );
  return EXIT.ok;
}
