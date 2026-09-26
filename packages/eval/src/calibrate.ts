/**
 * `remit calibrate` (BUILD_PROMPT 10.1, 11.5): fit isotonic maps from dev labels, tune thresholds on dev with the maps
 * applied, measure P0 precision under both, and store the result at
 * eval/calibration/<jev-model>/<question-set>.json. Keys with fewer than 50 samples keep the identity map.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Calibration, QUESTION_SET_VERSION, type RemitConfig } from '@remit/core';
import { collectPairs, fitCalibration, type KeyFit } from './calibration.js';
import { EVAL_ROOT } from './corpora/files.js';
import type { EvalItem } from './item.js';
import { computeMetrics } from './metrics.js';
import { type RunOptions, runItems } from './runner.js';
import { type TuneResult, tuneThresholds, withThresholds } from './tuning.js';

export const CALIBRATION_ROOT = join(EVAL_ROOT, 'calibration');

export interface CalibrateResult {
  calibration: Calibration;
  fits: Record<string, KeyFit>;
  tuning: TuneResult;
  p0Before: { value: number; p0: number; correct: number };
}

export async function calibrateOnDev(
  items: readonly EvalItem[],
  opts: RunOptions,
  weights: RemitConfig['eval'],
  meta: { id: string; jevModel: string },
  tuneOpts: Parameters<typeof tuneThresholds>[3] = {},
): Promise<CalibrateResult> {
  const raw = await runItems(items, opts);
  const before = computeMetrics(raw.outcomes);
  const { calibration: maps, fits } = fitCalibration(collectPairs(raw.outcomes), {
    ...meta,
    questionSet: QUESTION_SET_VERSION,
    labeledFindings: 0,
    p0Precision: 0,
  });
  const tuning = await tuneThresholds(items, { ...opts, calibration: maps }, weights, tuneOpts);
  const final = computeMetrics(
    (await runItems(withThresholds(items, tuning.thresholds), { ...opts, calibration: maps })).outcomes,
  );
  const calibration: Calibration = {
    ...maps,
    labeledFindings: final.p0Precision.p0,
    p0Precision: final.p0Precision.value,
    ...(Object.keys(tuning.thresholds).length
      ? { thresholds: tuning.thresholds as Record<string, number> }
      : {}),
  };
  return { calibration, fits, tuning, p0Before: before.p0Precision };
}

export function calibrationPath(root: string, jevModel: string, questionSet = QUESTION_SET_VERSION): string {
  return join(root, jevModel.replace(/[^\w.-]+/g, '_'), `${questionSet}.json`);
}

export function writeCalibration(root: string, result: CalibrateResult): string {
  const path = calibrationPath(root, result.calibration.jevModel, result.calibration.questionSet);
  mkdirSync(join(path, '..'), { recursive: true });
  const fits = Object.fromEntries(
    Object.entries(result.fits).map(([k, f]) => [
      k,
      {
        n: f.n,
        identity: f.identity,
        eceBefore: f.eceBefore,
        eceAfter: f.eceAfter,
        brierBefore: f.brierBefore,
        brierAfter: f.brierAfter,
      },
    ]),
  );
  writeFileSync(
    path,
    `${JSON.stringify({ ...result.calibration, fits, tuning: { before: result.tuning.before, after: result.tuning.after, steps: result.tuning.steps } }, null, 2)}\n`,
  );
  return path;
}

/** The stored calibration for a Jev model and the current question set, if any. */
export function loadCalibration(root: string, jevModel: string): Calibration | undefined {
  const path = calibrationPath(root, jevModel);
  if (!existsSync(path)) return undefined;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Calibration & { fits?: unknown; tuning?: unknown };
  const { fits: _f, tuning: _t, ...calibration } = raw;
  return calibration;
}
