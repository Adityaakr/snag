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
  /** `auroc` ranks items by their strongest P0 or P1 finding (11.8: corpus A has no target, only AUROC). */
  pr: Prf & { falseAlarmRate: number; cleanItems: number; problemItems: number; auroc: number | null };
  p0Precision: { value: number; p0: number; correct: number };
  /** Per G.1 operator: `recall` is the share of items whose injected problem was detected (see `detected`). */
  operators: Record<string, { items: number; passed: number; detected: number; recall: number }>;
  /** Corpus C: findings re-produced on replay that humans labeled; strong and weak labels kept apart (10.4). */
  feedback: {
    agree: number;
    disagree: number;
    weakAgree: number;
    weakDisagree: number;
    agreement: number | null;
  };
  /** Corpus A slices by label source and strength: items, labeled problems, and items with a P0. */
  slices: Record<string, { items: number; problem: number; flagged: number }>;
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

const PRIORITY_SCORE: Record<string, number> = { P0: 2, P1: 1 };

/** An item's PR-level score: 2 + confidence for its strongest P0, 1 + confidence for a P1, else 0. */
export function prScore(o: ItemOutcome): number {
  let best = 0;
  for (const f of o.result.findings) {
    const base = PRIORITY_SCORE[f.priority];
    if (base !== undefined) best = Math.max(best, base + f.confidence);
  }
  return best;
}

/** Area under the ROC curve (ties count half); null without both classes. */
export function auroc(scored: readonly { score: number; problem: boolean }[]): number | null {
  const pos = scored.filter((s) => s.problem);
  const neg = scored.filter((s) => !s.problem);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

type Finding = ItemOutcome['result']['findings'][number];

/** A P0 is correct when it points at something labeled as a problem in this item. */
export function p0IsCorrect(o: ItemOutcome, f: Finding): boolean {
  const l = o.item.labels;
  const status = l.requirements[f.targetId];
  if (
    f.type === 'requirement' &&
    status !== undefined &&
    (PROBLEM_STATUSES as readonly string[]).includes(status)
  )
    return true;
  if ((l.claimMismatch ?? []).includes(f.targetId)) return true;
  const unit = o.result.units.find((u) => u.id === f.targetId || u.facts.some((x) => `F-${x.id}` === f.id));
  const where = (file: string, symbol?: string) =>
    unit
      ? unit.file === file && (!symbol || unit.symbol?.name === symbol)
      : f.locations.some((x) => x.file === file);
  if (f.type === 'test_integrity') return l.testIntegrity.some((t) => where(t.file, t.symbol));
  if (f.type === 'unit')
    return l.units.some((u) => u.role === 'unexplained_behavioral' && where(u.file, u.symbol));
  if (f.type === 'fact')
    return l.facts.some(
      (x) => (!x.file || where(x.file, x.symbol)) && unit?.facts.some((y) => y.kind === x.kind),
    );
  return false;
}

/** Whether an operator's injected problem was detected (the G.1 "Expected" column). */
export function detected(o: ItemOutcome): boolean {
  const c = o.comparison;
  const target = c.requirements.find((r) => r.id === o.item.target);
  const problem = (s: string | undefined) =>
    s !== undefined && (PROBLEM_STATUSES as readonly string[]).includes(s);
  switch (o.item.operator) {
    case 'drop_requirement':
    case 'flip_condition':
    case 'partial_requirement':
      return problem(target?.actual);
    case 'unwire':
      return problem(target?.actual) && c.facts.every((x) => x.found);
    case 'weaken_assertion':
      return c.facts.every((x) => x.found) && c.testIntegrity.every((x) => x.found);
    case 'skip_test':
      return c.facts.every((x) => x.found);
    case 'inject_config':
      return c.units.every((u) => u.actual === 'unexplained_behavioral');
    case 'inject_refactor':
      return c.p0p1 === 0;
    case 'claim_all_done':
      return c.claimMismatch.every((x) => x.found);
    default:
      return c.passed;
  }
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
  const slices: Metrics['slices'] = {};
  const feedback = { agree: 0, disagree: 0, weakAgree: 0, weakDisagree: 0 };
  const scored: { score: number; problem: boolean }[] = [];

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
      if (p0IsCorrect(o, f)) p0Correct++;
    }
    if (o.item.operator) {
      operators[o.item.operator] ??= { items: 0, passed: 0, detected: 0, recall: 0 };
      const op = operators[o.item.operator] as Metrics['operators'][string];
      op.items++;
      if (c.passed) op.passed++;
      if (detected(o)) op.detected++;
    }
    if (o.item.meta?.source) {
      const key = `${o.item.meta.source}:${o.item.meta.strength ?? ''}`;
      slices[key] ??= { items: 0, problem: 0, flagged: 0 };
      const sl = slices[key] as Metrics['slices'][string];
      sl.items++;
      if (c.pr.expected === 'problem') sl.problem++;
      if (c.pr.predictedProblem) sl.flagged++;
    }
    scored.push({ score: prScore(o), problem: c.pr.expected === 'problem' });
    const fb = o.item.labels.feedback;
    if (fb)
      for (const f of o.result.findings) {
        const label = fb[f.contentKey];
        if (label === 'agree') feedback.agree++;
        else if (label === 'disagree') feedback.disagree++;
        else if (label === 'weak_agree') feedback.weakAgree++;
        else if (label === 'weak_disagree') feedback.weakDisagree++;
      }
  }
  for (const op of Object.values(operators)) op.recall = op.items ? op.detected / op.items : 0;

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
      auroc: auroc(scored),
    },
    p0Precision: { value: p0 ? p0Correct / p0 : 0, p0, correct: p0Correct },
    operators,
    feedback: {
      ...feedback,
      agreement:
        feedback.agree + feedback.disagree ? feedback.agree / (feedback.agree + feedback.disagree) : null,
    },
    slices,
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
