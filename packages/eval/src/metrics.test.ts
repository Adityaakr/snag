import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auroc, computeMetrics, detected, prScore } from './metrics.js';
import { SEEDS_ROOT, seedItems } from './mutations/generate.js';
import { loadSeed } from './mutations/seed.js';
import { renderReportMarkdown, targetRows } from './report.js';
import { runItems } from './runner.js';

describe('auroc', () => {
  it('ranks, counts ties half, and needs both classes', () => {
    expect(
      auroc([
        { score: 2, problem: true },
        { score: 1, problem: false },
      ]),
    ).toBe(1);
    expect(
      auroc([
        { score: 1, problem: true },
        { score: 1, problem: false },
      ]),
    ).toBe(0.5);
    expect(
      auroc([
        { score: 0, problem: true },
        { score: 1, problem: false },
      ]),
    ).toBe(0);
    expect(auroc([{ score: 1, problem: true }])).toBeNull();
  });
});

describe('operator detection and targets', () => {
  it('scores every operator and reports every applicable target honestly', async () => {
    const items = await seedItems(loadSeed(join(SEEDS_ROOT, 'ts-job-intervals')));
    const { outcomes } = await runItems(items, { mode: 'simulated' });
    for (const o of outcomes) expect(typeof detected(o)).toBe('boolean');
    for (const o of outcomes) expect(prScore(o)).toBeGreaterThanOrEqual(0);
    const m = computeMetrics(outcomes);
    expect(Object.keys(m.operators).sort()).toEqual([
      'claim_all_done',
      'drop_requirement',
      'flip_condition',
      'inject_config',
      'inject_refactor',
      'partial_requirement',
      'skip_test',
      'unwire',
      'weaken_assertion',
    ]);
    for (const v of Object.values(m.operators)) expect(v.recall).toBe(v.detected / v.items);
    const info = {
      corpus: 'mutations',
      split: 'dev',
      mode: 'live' as const,
      gitSha: 'abc',
      startedAt: 'now',
      jevModel: 'j',
      stoppedForBudget: false,
    };
    const rows = targetRows(info, m);
    expect(rows.map((r) => r.name)).toEqual(
      expect.arrayContaining(['Recall: drop_requirement', 'P0 precision', 'Latency p50', 'Cost p50']),
    );
    expect(rows.every((r) => ['yes', 'no', 'n/a'].includes(r.met))).toBe(true);
    expect(targetRows({ ...info, corpus: 'golden', mode: 'scripted' }, m)[0]?.name).toBe('Golden accuracy');
    expect(renderReportMarkdown(info, m, outcomes)).toContain('## Targets (11.8)');
  });
});
