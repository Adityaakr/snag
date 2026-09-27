import { join } from 'node:path';
import { FakeLlm } from '@remit/providers';
import { describe, expect, it } from 'vitest';
import {
  baselineMetrics,
  baselineNote,
  runSinglePass,
  SINGLE_PASS_SYSTEM,
  singlePassFlags,
  singlePassMessage,
} from './baselines.js';
import { SEEDS_ROOT, seedItems } from './mutations/generate.js';
import { loadSeed } from './mutations/seed.js';

const items = async () => seedItems(loadSeed(join(SEEDS_ROOT, 'ts-job-intervals')));
type Status = 'done' | 'partial' | 'missing' | 'contradicted' | 'uncertain';
const req = (id: string, status: Status) => ({
  id,
  text: id,
  status,
  confidence: 0.9,
  evidence: [{ file: 'src/schedule.ts', lines: { start: 1, end: 2 } }],
});

describe('single_pass baseline', () => {
  it('uses the B.2 prompt, fences data, and scores the remit_requirements variant by id', async () => {
    const all = await items();
    const clean = all.find((i) => i.id.endsWith('.clean'));
    const drop = all.find((i) => i.operator === 'drop_requirement' && i.target === 'R1');
    if (!clean || !drop) throw new Error('missing items');
    const llm = new FakeLlm({
      [`single_pass_remit_requirements:${clean.id}`]: [
        { requirements: ['R1', 'R2', 'R3', 'R4'].map((r) => req(r, 'done')), unexplained: [] },
      ],
      [`single_pass_remit_requirements:${drop.id}`]: [
        {
          requirements: [req('R1', 'missing'), req('R2', 'missing'), req('R3', 'done'), req('R4', 'done')],
          unexplained: [],
        },
      ],
    });
    const outcomes = [
      await runSinglePass(clean, llm, 'remit_requirements'),
      await runSinglePass(drop, llm, 'remit_requirements'),
    ];
    expect(llm.calls[0]?.system).toBe(SINGLE_PASS_SYSTEM);
    expect(llm.calls[0]?.messages[0]?.content).toContain('<requirements>\nR1: Job intervals accept');
    const m = baselineMetrics(outcomes, 'remit_requirements');
    expect(m.requirement).toEqual({ precision: 1, recall: 1, f1: 1 });
    expect(m.pr).toEqual({ precision: 1, recall: 1, falseAlarmRate: 0 });
  });

  it('records failures as errors and scores the own_requirements variant at PR level only', async () => {
    const [clean] = await items();
    if (!clean) throw new Error('missing');
    const bad = await runSinglePass(clean, new FakeLlm({}), 'own_requirements');
    expect(bad.error).toMatch(/no script/);
    const m = baselineMetrics([bad], 'own_requirements');
    expect(m.errors).toBe(1);
    expect(m.requirement).toBeNull();
    expect(singlePassMessage(clean)).not.toContain('<requirements>');
    expect(
      singlePassFlags({
        requirements: [],
        unexplained: [{ file: 'a', lines: { start: 1, end: 1 }, behavioral: true }],
      }),
    ).toBe(true);
    expect(singlePassFlags({ requirements: [req('R1', 'partial')], unexplained: [] }, 0.95)).toBe(false);
  });

  it('explains when a baseline cannot run', async () => {
    expect(await baselineNote('single_pass', {})).toMatch(/skipped/);
    expect(await baselineNote('single_pass', { ANTHROPIC_API_KEY: ['sk', 'x'].join('-') })).toBe('available');
    expect(await baselineNote('pr_agent', { PATH: '/nonexistent' })).toMatch(/skipped/);
    expect(await baselineNote('other', {})).toMatch(/unknown/);
  });
});
