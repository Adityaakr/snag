/**
 * Runs evaluation items through the real review pipeline and compares each result with its labels.
 * Provider modes: `scripted` (the item's recorded answers, golden only), `simulated` (SimulatedJev, not a real
 * measurement) and `live` (the given providers, normally CachedJev/CachedLlm over eval cassettes).
 */
import type { ReviewResult } from '@remit/core';
import { checkExpected, runReview } from '@remit/pipeline';
import { CostTracker, FakeJev, FakeLlm, type JevProvider, type LlmProvider } from '@remit/providers';
import { type EvalItem, PROBLEM_STATUSES, treeContentSource, treeReferenceIndex } from './item.js';
import { SimulatedJev } from './simulated.js';

export type ProviderMode = 'scripted' | 'simulated' | 'live';

export interface RunOptions {
  mode: ProviderMode;
  jev?: JevProvider;
  llm?: LlmProvider;
  limit?: number;
  concurrency?: number;
  /** Stops the run when total cost passes this (EVAL_MAX_USD, default $20). */
  maxUsd?: number;
}

export interface Comparison {
  requirements: { id: string; expected: string; actual: string | undefined }[];
  units: { file: string; symbol?: string; expected: string; actual: string | undefined }[];
  facts: { kind: string; file?: string; found: boolean }[];
  testIntegrity: { file: string; symbol?: string; found: boolean }[];
  pr: { expected: 'problem' | 'clean'; predictedProblem: boolean };
  /** P0 or P1 findings; counted as false alarms when the item is clean (11.4 noise budget). */
  p0p1: number;
  goldenFailures?: string[];
  /** True when every labeled expectation holds. */
  passed: boolean;
}

export interface ItemOutcome {
  item: EvalItem;
  result: ReviewResult;
  comparison: Comparison;
  latencyMs: number;
  costUsd: number;
}

function unitOf(r: ReviewResult, file: string, symbol?: string) {
  return r.units.find((u) => u.file === file && (!symbol || u.symbol?.name === symbol));
}

/** Compares one result with the item's labels. */
export function compare(item: EvalItem, r: ReviewResult): Comparison {
  const status = new Map(r.requirementVerdicts.map((v) => [v.requirementId, v.status]));
  const requirements = Object.entries(item.labels.requirements).map(([id, expected]) => ({
    id,
    expected,
    actual: status.get(id),
  }));
  const units = item.labels.units.map((l) => {
    const u = unitOf(r, l.file, l.symbol);
    return {
      file: l.file,
      ...(l.symbol ? { symbol: l.symbol } : {}),
      expected: l.role,
      actual: u ? r.unitVerdicts.find((v) => v.unitId === u.id)?.role : undefined,
    };
  });
  const facts = item.labels.facts.map((f) => {
    const pool = f.file
      ? r.units
          .filter((u) => u.file === f.file && (!f.symbol || u.symbol?.name === f.symbol))
          .flatMap((u) => u.facts)
      : r.units.flatMap((u) => u.facts);
    return { kind: f.kind, ...(f.file ? { file: f.file } : {}), found: pool.some((x) => x.kind === f.kind) };
  });
  const testIntegrity = item.labels.testIntegrity.map((t) => {
    const u = unitOf(r, t.file, t.symbol);
    const found = Boolean(
      u &&
        r.findings.some(
          (f) =>
            f.type === 'test_integrity' && (f.targetId === u.id || u.facts.some((x) => `F-${x.id}` === f.id)),
        ),
    );
    return { file: t.file, ...(t.symbol ? { symbol: t.symbol } : {}), found };
  });
  const predictedProblem = r.findings.some((f) => f.priority === 'P0');
  const goldenFailures = item.expected ? checkExpected(r, item.expected) : undefined;
  const passed = goldenFailures
    ? goldenFailures.length === 0
    : requirements.every((x) => x.actual === x.expected) &&
      units.every((x) => x.actual === x.expected) &&
      facts.every((x) => x.found) &&
      testIntegrity.every((x) => x.found);
  return {
    requirements,
    units,
    facts,
    testIntegrity,
    pr: { expected: item.labels.pr, predictedProblem },
    p0p1: r.findings.filter((f) => f.priority === 'P0' || f.priority === 'P1').length,
    ...(goldenFailures ? { goldenFailures } : {}),
    passed,
  };
}

/** Runs one item. */
export async function runItem(item: EvalItem, opts: RunOptions): Promise<ItemOutcome> {
  let jev: JevProvider | undefined;
  let llm: LlmProvider | undefined;
  if (opts.mode === 'scripted') {
    if (!item.scripts)
      throw new Error(`item ${item.id} has no scripted answers; use --mode simulated or live`);
    jev = new FakeJev(item.scripts.jev, 'jev-1.13.0', item.id);
    llm = new FakeLlm(item.scripts.llm);
  } else if (opts.mode === 'simulated') {
    jev = new SimulatedJev();
    llm = item.scripts ? new FakeLlm(item.scripts.llm) : undefined;
  } else {
    jev = opts.jev;
    llm = opts.llm ?? (item.scripts ? new FakeLlm(item.scripts.llm) : undefined);
  }
  const costs = new CostTracker(item.config.budgets.max_usd_per_review);
  const started = Date.now();
  const result = await runReview(item.input, {
    ...(jev ? { jev } : {}),
    ...(llm ? { llm } : {}),
    config: item.config,
    reviewId: `eval_${item.id}`,
    costs,
    ...(item.trees
      ? { contents: treeContentSource(item.trees), references: treeReferenceIndex(item.trees) }
      : {}),
    now: () => 0,
  });
  return {
    item,
    result,
    comparison: compare(item, result),
    latencyMs: Date.now() - started,
    costUsd: costs.usage.costUsd,
  };
}

/** Runs many items with bounded concurrency and a total dollar cap. */
export async function runItems(
  items: readonly EvalItem[],
  opts: RunOptions,
): Promise<{ outcomes: ItemOutcome[]; stoppedForBudget: boolean }> {
  const list = opts.limit ? items.slice(0, opts.limit) : [...items];
  const outcomes: ItemOutcome[] = [];
  let spent = 0;
  let stoppedForBudget = false;
  const max = opts.maxUsd ?? 20;
  const width = Math.max(1, opts.concurrency ?? 4);
  for (let i = 0; i < list.length; i += width) {
    if (spent >= max) {
      stoppedForBudget = true;
      break;
    }
    const batch = await Promise.all(list.slice(i, i + width).map((it) => runItem(it, opts)));
    for (const o of batch) {
      outcomes.push(o);
      spent += o.costUsd;
    }
  }
  return { outcomes, stoppedForBudget };
}

/** True when a requirement status counts as a problem (11.4). */
export const isProblem = (s: string | undefined) =>
  s !== undefined && (PROBLEM_STATUSES as readonly string[]).includes(s);
