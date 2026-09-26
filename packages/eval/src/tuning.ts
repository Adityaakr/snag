/**
 * Threshold tuning on dev (BUILD_PROMPT 11.5): coordinate descent over a grid, minimizing the cost-weighted
 * objective (a false P0 costs 3, a missed problem 2, a false P1 1; the weights live in config `eval`).
 */
import type { Calibration, RemitConfig, Thresholds } from '@remit/core';
import type { EvalItem } from './item.js';
import { p0IsCorrect } from './metrics.js';
import { type ItemOutcome, type RunOptions, runItems } from './runner.js';

export const TUNABLE: readonly (keyof Thresholds)[] = [
  'full',
  'partial',
  'missing',
  'contradicted',
  'behavior',
  'serves',
  'loosens',
];
export const GRID = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];

export interface Objective {
  cost: number;
  falseP0: number;
  missed: number;
  falseP1: number;
}

export function objective(outcomes: readonly ItemOutcome[], weights: RemitConfig['eval']): Objective {
  let falseP0 = 0;
  let missed = 0;
  let falseP1 = 0;
  for (const o of outcomes) {
    for (const f of o.result.findings) if (f.priority === 'P0' && !p0IsCorrect(o, f)) falseP0++;
    if (o.comparison.pr.expected === 'problem' && !o.comparison.pr.predictedProblem) missed++;
    if (o.comparison.pr.expected === 'clean')
      falseP1 += o.result.findings.filter((f) => f.priority === 'P1').length;
  }
  return {
    cost:
      weights.cost_false_p0 * falseP0 +
      weights.cost_missed_problem * missed +
      weights.cost_false_p1 * falseP1,
    falseP0,
    missed,
    falseP1,
  };
}

export function withThresholds(items: readonly EvalItem[], t: Partial<Thresholds>): EvalItem[] {
  return items.map((i) => ({ ...i, config: { ...i.config, thresholds: { ...i.config.thresholds, ...t } } }));
}

export interface TuneResult {
  thresholds: Partial<Thresholds>;
  before: Objective;
  after: Objective;
  evaluations: number;
  steps: { key: string; value: number; cost: number }[];
}

/** One or more coordinate-descent passes; ties keep the current value, so defaults win unless beaten. */
export async function tuneThresholds(
  items: readonly EvalItem[],
  opts: RunOptions & { calibration?: Calibration },
  weights: RemitConfig['eval'],
  {
    keys = TUNABLE,
    grid = GRID,
    passes = 1,
  }: { keys?: readonly (keyof Thresholds)[]; grid?: readonly number[]; passes?: number } = {},
): Promise<TuneResult> {
  let evaluations = 0;
  const score = async (t: Partial<Thresholds>) => {
    evaluations++;
    return objective((await runItems(withThresholds(items, t), opts)).outcomes, weights);
  };
  const current: Partial<Thresholds> = {};
  const before = await score(current);
  let best = before;
  const steps: TuneResult['steps'] = [];
  for (let pass = 0; pass < passes; pass++) {
    for (const key of keys) {
      for (const value of grid) {
        const candidate = { ...current, [key]: value };
        const s = await score(candidate);
        if (s.cost < best.cost) {
          best = s;
          current[key] = value;
          steps.push({ key, value, cost: s.cost });
        }
      }
    }
  }
  return { thresholds: current, before, after: best, evaluations, steps };
}
