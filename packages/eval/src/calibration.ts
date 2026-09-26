/**
 * Calibration (BUILD_PROMPT 11.5): (raw probability, observed outcome) pairs per question key, isotonic regression
 * by pool-adjacent-violators, identity below 50 samples, and ECE (10 bins) and Brier scores.
 */
import type { Answer, Calibration, CalibrationPoint } from '@remit/core';
import type { ItemOutcome } from './runner.js';

export const MIN_SAMPLES = 50;

export interface Pair {
  p: number;
  y: 0 | 1;
}

const answer = (answers: readonly Answer[], call: string, question: string) =>
  answers.find((a) => a.call === call && a.question === question);

/**
 * Collects pairs per question key from labeled outcomes. Keys follow D19: forward.coverage.level3 (outcome: label
 * is done), forward.coverage.missing (label is missing), forward.coverage.level2 (label is partial),
 * forward.conflict and tests.asserts_differently (label is contradicted or an interpretation mismatch),
 * reverse.behavior_change (unit label is unexplained_behavioral) and reverse.loosens_test (a test integrity label).
 */
export function collectPairs(outcomes: readonly ItemOutcome[]): Record<string, Pair[]> {
  const pairs: Record<string, Pair[]> = {};
  const add = (key: string, p: number | undefined, y: boolean) => {
    if (p === undefined || Number.isNaN(p)) return;
    pairs[key] ??= [];
    pairs[key].push({ p, y: y ? 1 : 0 });
  };
  for (const o of outcomes) {
    for (const [id, expected] of Object.entries(o.item.labels.requirements)) {
      const v = o.result.requirementVerdicts.find((x) => x.requirementId === id);
      if (!v) continue;
      const cov = answer(v.answers, 'forward.v0', 'coverage');
      const probs = cov?.probabilities;
      if (probs) {
        add('forward.coverage.level3', probs['3'], expected === 'done');
        add('forward.coverage.level2', probs['2'], expected === 'partial');
        add('forward.coverage.missing', (probs['0'] ?? 0) + (probs['1'] ?? 0), expected === 'missing');
      }
      const contradicted = expected === 'contradicted' || expected === 'interpretation_mismatch';
      add(
        'forward.conflict',
        answer(v.answers, 'forward.v0', 'conflict')?.value as number | undefined,
        contradicted,
      );
      add(
        'tests.asserts_differently',
        answer(v.answers, 'tests.v0', 'asserts_differently')?.value as number | undefined,
        contradicted,
      );
    }
    for (const l of o.item.labels.units) {
      const u = o.result.units.find((x) => x.file === l.file && (!l.symbol || x.symbol?.name === l.symbol));
      const uv = u && o.result.unitVerdicts.find((x) => x.unitId === u.id);
      if (!uv) continue;
      add(
        'reverse.behavior_change',
        answer(uv.answers, 'reverse.v0', 'behavior_change')?.value as number | undefined,
        l.role === 'unexplained_behavioral',
      );
    }
    for (const u of o.result.units.filter((x) => x.kind === 'test')) {
      const uv = o.result.unitVerdicts.find((x) => x.unitId === u.id);
      const lt = uv && answer(uv.answers, 'reverse.v0', 'loosens_test');
      if (!lt) continue;
      add(
        'reverse.loosens_test',
        lt.value as number,
        o.item.labels.testIntegrity.some(
          (t) => t.file === u.file && (!t.symbol || t.symbol === u.symbol?.name),
        ),
      );
    }
  }
  return pairs;
}

/** Isotonic regression (pool adjacent violators): a non-decreasing map from raw probability to accuracy. */
export function isotonic(pairs: readonly Pair[]): CalibrationPoint[] {
  const sorted = [...pairs].sort((a, b) => a.p - b.p);
  const blocks: { sum: number; n: number; lo: number; hi: number }[] = [];
  for (const { p, y } of sorted) {
    // Equal raw probabilities must share one block, or ties would map one x to several values.
    const last = blocks[blocks.length - 1];
    if (last && last.hi === p && last.lo === p) {
      last.sum += y;
      last.n += 1;
    } else blocks.push({ sum: y, n: 1, lo: p, hi: p });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1] as { sum: number; n: number; lo: number; hi: number };
      const a = blocks[blocks.length - 2] as { sum: number; n: number; lo: number; hi: number };
      if (a.sum / a.n <= b.sum / b.n) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, n: a.n + b.n, lo: a.lo, hi: b.hi });
    }
  }
  return blocks.flatMap((b) =>
    b.lo === b.hi
      ? [{ x: b.lo, y: b.sum / b.n }]
      : [
          { x: b.lo, y: b.sum / b.n },
          { x: b.hi, y: b.sum / b.n },
        ],
  );
}

export interface Bin {
  lo: number;
  hi: number;
  n: number;
  meanP: number;
  accuracy: number;
}

/** Ten equal-width bins for ECE and reliability diagrams. */
export function bins(pairs: readonly Pair[], count = 10): Bin[] {
  const out: Bin[] = Array.from({ length: count }, (_, i) => ({
    lo: i / count,
    hi: (i + 1) / count,
    n: 0,
    meanP: 0,
    accuracy: 0,
  }));
  for (const { p, y } of pairs) {
    const b = out[Math.min(count - 1, Math.floor(p * count))] as Bin;
    b.n++;
    b.meanP += p;
    b.accuracy += y;
  }
  for (const b of out)
    if (b.n) {
      b.meanP /= b.n;
      b.accuracy /= b.n;
    }
  return out;
}

export function ece(pairs: readonly Pair[]): number {
  if (!pairs.length) return 0;
  return bins(pairs).reduce((s, b) => s + (b.n / pairs.length) * Math.abs(b.accuracy - b.meanP), 0);
}

export function brier(pairs: readonly Pair[]): number {
  return pairs.length ? pairs.reduce((s, { p, y }) => s + (p - y) ** 2, 0) / pairs.length : 0;
}

export interface KeyFit {
  n: number;
  identity: boolean;
  /** eceAfter and brierAfter are out of sample (5-fold cross-validation). */
  eceBefore: number;
  eceAfter: number;
  brierBefore: number;
  brierAfter: number;
  points: CalibrationPoint[];
}

/** Fits one isotonic map per key; keys with fewer than 50 samples keep the identity map and say so. */
export function fitCalibration(
  pairs: Record<string, Pair[]>,
  meta: { id: string; jevModel: string; questionSet: string; labeledFindings: number; p0Precision: number },
): { calibration: Calibration; fits: Record<string, KeyFit> } {
  const maps: Record<string, CalibrationPoint[]> = {};
  const fits: Record<string, KeyFit> = {};
  for (const [key, ps] of Object.entries(pairs)) {
    const identity = ps.length < MIN_SAMPLES;
    const points = identity ? [] : isotonic(ps);
    // "After" is measured out of sample: 5-fold cross-validation, each fold mapped by a fit on the other four.
    const mapped = identity ? ps : crossValidated(ps, 5);
    if (!identity) maps[key] = points;
    fits[key] = {
      n: ps.length,
      identity,
      eceBefore: ece(ps),
      eceAfter: ece(mapped),
      brierBefore: brier(ps),
      brierAfter: brier(mapped),
      points,
    };
  }
  return { calibration: { ...meta, maps }, fits };
}

/** Every pair mapped by an isotonic fit on the other folds (fold = index mod k, after sorting by p then y). */
export function crossValidated(pairs: readonly Pair[], k: number): Pair[] {
  const sorted = [...pairs].sort((a, b) => a.p - b.p || a.y - b.y);
  const out: Pair[] = [];
  for (let fold = 0; fold < k; fold++) {
    const train = sorted.filter((_, i) => i % k !== fold);
    const points = isotonic(train);
    for (let i = fold; i < sorted.length; i += k) {
      const pair = sorted[i] as Pair;
      out.push({ p: applyPoints(points, pair.p), y: pair.y });
    }
  }
  return out;
}

function applyPoints(points: readonly CalibrationPoint[], p: number): number {
  if (!points.length) return p;
  if (p <= (points[0] as CalibrationPoint).x) return (points[0] as CalibrationPoint).y;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as CalibrationPoint;
    const b = points[i] as CalibrationPoint;
    if (p <= b.x) return b.x === a.x ? b.y : a.y + ((p - a.x) / (b.x - a.x)) * (b.y - a.y);
  }
  return (points[points.length - 1] as CalibrationPoint).y;
}
