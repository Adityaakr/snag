/**
 * Metrics (BUILD_PROMPT 11.4): requirement, unit and PR level accuracy, operator recall, calibration, operations.
 */
import { bins, brier, collectPairs, ece, type Bin } from './calibration.js';
import { NON_PROBLEM_STATUSES, PROBLEM_STATUSES } from './item.js';
import type { ItemOutcome } from './runner.js';

export interface Prf {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

function prf(tp: number, fp: number, fn: number): Prf {
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
  };
}

const pct = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] as number;
};

export interface Metrics {
  items: number;
  passed: number;
  requirement: Prf & {
    abstentionRate: number;
    confusion: Record<string, Record<string, number>>;
    labeled: number;
  };
  unitBehavioral: Prf;
  testIntegrity: Prf;
  pr: Prf & { falseAlarmRate: number; cleanItems: number; problemItems: number };
  p0Precision: { value: number; p0: number; correct: number };
  operators: Record<string, { items: number; passed: number; recall: number }>;
  calibration: Record<string, { n: number; ece: number; brier: number; bins: Bin[] }>;
  ops: {
    latencyP50: number;
    latencyP95: number;
    costP50: number;
    costTotal: number;
    jevInputTokens: number;
    llmInputTokens: number;
    llmOutputTokens: number;
    truncationRate: number;
  };
}

export function computeMetrics(outcomes: readonly ItemOutcome[]): Metrics {
  const isProblem = (s: string | undefined) =>
    s !== undefined && (PROBLEM_STATUSES as readonly string[]).includes(s);
  const isDecided = (s: string | undefined) =>
    isProblem(s) || (s !== undefined && (NON_PROBLEM_STATUSES as readonly string[]).includes(s));
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let labeled = 0;
  let abstained = 0;
  const confusion: Record<string, Record<string, number>> = {};
  let ubTp = 0;
  let ubFp = 0;
  let ubFn = 0;
  let tiTp = 0;
  let tiFp = 0;
  let tiFn = 0;
  let prTp = 0;
  let prFp = 0;
  let prFn = 0;
  let cleanItems = 0;
  let problemItems = 0;
  let falseAlarms = 0;
  let p0 = 0;
  let p0Correct = 0;
  const operators: Metrics['operators'] = {};

  for (const o of outcomes) {
    const c = o.comparison;
    for (const r of c.requirements) {
      labeled++;
      confusion[r.expected] ??= {};
      const row = confusion[r.expected] as Record<string, number>;
      row[r.actual ?? 'none'] = (row[r.actual ?? 'none'] ?? 0) + 1;
      if (!isDecided(r.actual)) abstained++;
      const exp = isProblem(r.expected);
      const act = isProblem(r.actual);
      if (exp && act) tp++;
      else if (!exp && act) fp++;
      else if (exp && !act) fn++;
    }
    for (const u of c.units) {
      const exp = u.expected === 'unexplained_behavioral';
      const act = u.actual === 'unexplained_behavioral';
      if (exp && act) ubTp++;
      else if (!exp && act) ubFp++;
      else if (exp && !act) ubFn++;
    }
    // Unlabeled units flagged behavioral count as false positives.
    const labeledUnits = new Set(o.item.labels.units.map((l) => `${l.file}#${l.symbol ?? ''}`));
    for (const uv of o.result.unitVerdicts) {
      if (uv.role !== 'unexplained_behavioral') continue;
      const u = o.result.units.find((x) => x.id === uv.unitId);
      if (u && !labeledUnits.has(`${u.file}#${u.symbol?.name ?? ''}`) && !labeledUnits.has(`${u.file}#`))
        ubFp++;
    }
    for (const t of c.testIntegrity) t.found ? tiTp++ : tiFn++;
    const labeledTi = new Set(o.item.labels.testIntegrity.map((t) => t.file));
    tiFp += o.result.findings.filter(
      (f) => f.type === 'test_integrity' && !f.locations.some((l) => labeledTi.has(l.file)),
    ).length;

    if (c.pr.expected === 'problem') {
      problemItems++;
      if (c.pr.predictedProblem) prTp++;
      else prFn++;
    } else {
      cleanItems++;
      if (c.pr.predictedProblem) prFp++;
      falseAlarms += c.p0p1;
    }
    for (const f of o.result.findings.filter((x) => x.priority === 'P0')) {
      p0++;
      const req = o.item.labels.requirements[f.targetId];
      const integrity = f.type === 'test_integrity' && f.locations.some((l) => labeledTi.has(l.file));
      if ((f.type === 'requirement' && isProblem(req)) || integrity) p0Correct++;
    }
    if (o.item.operator) {
      operators[o.item.operator] ??= { items: 0, passed: 0, recall: 0 };
      const op = operators[o.item.operator] as { items: number; passed: number; recall: number };
      op.items++;
      if (c.passed) op.passed++;
    }
  }
  for (const op of Object.values(operators)) op.recall = op.items ? op.passed / op.items : 0;

  const pairs = collectPairs(outcomes);
  const calibration: Metrics['calibration'] = {};
  for (const [k, ps] of Object.entries(pairs))
    calibration[k] = { n: ps.length, ece: ece(ps), brier: brier(ps), bins: bins(ps) };

  const truncated = outcomes.filter((o) =>
    o.result.warnings.some((w) => /overflow|could not shrink|over the \d+ token unit cap|split a/.test(w)),
  ).length;
  return {
    items: outcomes.length,
    passed: outcomes.filter((o) => o.comparison.passed).length,
    requirement: {
      ...prf(tp, fp, fn),
      abstentionRate: labeled ? abstained / labeled : 0,
      confusion,
      labeled,
    },
    unitBehavioral: prf(ubTp, ubFp, ubFn),
    testIntegrity: prf(tiTp, tiFp, tiFn),
    pr: {
      ...prf(prTp, prFp, prFn),
      falseAlarmRate: cleanItems ? falseAlarms / cleanItems : 0,
      cleanItems,
      problemItems,
    },
    p0Precision: { value: p0 ? p0Correct / p0 : 0, p0, correct: p0Correct },
    operators,
    calibration,
    ops: {
      latencyP50: pct(
        outcomes.map((o) => o.latencyMs),
        0.5,
      ),
      latencyP95: pct(
        outcomes.map((o) => o.latencyMs),
        0.95,
      ),
      costP50: pct(
        outcomes.map((o) => o.costUsd),
        0.5,
      ),
      costTotal: outcomes.reduce((s, o) => s + o.costUsd, 0),
      jevInputTokens: outcomes.reduce((s, o) => s + o.result.usage.jevInputTokens, 0),
      llmInputTokens: outcomes.reduce((s, o) => s + o.result.usage.llmInputTokens, 0),
      llmOutputTokens: outcomes.reduce((s, o) => s + o.result.usage.llmOutputTokens, 0),
      truncationRate: outcomes.length ? truncated / outcomes.length : 0,
    },
  };
}
