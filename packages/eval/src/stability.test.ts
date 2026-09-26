import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '@remit/core';
import { FakeLlm } from '@remit/providers';
import { describe, expect, it } from 'vitest';
import { SEEDS_ROOT, seedItems } from './mutations/generate.js';
import { loadSeed } from './mutations/seed.js';
import { appendEvalRun } from './report.js';
import { jaccard, measureStability } from './stability.js';

describe('extraction stability', () => {
  it('computes Jaccard, including the empty case', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(1);
  });

  it('samples one item per issue and reports task-list extraction as deterministic', async () => {
    const items = await seedItems(loadSeed(join(SEEDS_ROOT, 'ts-job-intervals')));
    const all = await measureStability(items, undefined, undefined, 1);
    expect(all).toEqual({ sampled: 1, measured: 1, skipped: 0, meanJaccard: 1, deterministic: true });
    const noTasks = items.slice(0, 1).map((i) => ({
      ...i,
      config: ConfigSchema.parse({ extraction: { mode: 'llm' } }),
    }));
    const skipped = await measureStability(noTasks, undefined, undefined, 1);
    expect(skipped).toMatchObject({
      sampled: 1,
      measured: 0,
      skipped: 1,
      meanJaccard: null,
      deterministic: false,
    });
    expect((await measureStability(items, undefined, undefined, 0)).sampled).toBe(0);
  });
});

describe('appendEvalRun', () => {
  it('keeps run lines under their own heading, before later sections', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'remit-exp-')), 'EXPERIMENTS.md');
    writeFileSync(p, '# Experiments\n\n## Dogfood labels\n\n| a |\n');
    appendEvalRun(p, '- run 1');
    appendEvalRun(p, '- run 2');
    expect(readFileSync(p, 'utf8')).toBe(
      '# Experiments\n\n## Dogfood labels\n\n| a |\n\n## Eval runs\n\n- run 1\n- run 2\n',
    );
    writeFileSync(p, '# E\n\n## Eval runs\n\n- old\n\n## Later\n\ntext\n');
    appendEvalRun(p, '- new');
    expect(readFileSync(p, 'utf8')).toBe('# E\n\n## Eval runs\n\n- old\n- new\n\n## Later\n\ntext\n');
  });
});

describe('extraction stability with an LLM', () => {
  it('scores disagreement between two runs', async () => {
    const [item] = await seedItems(loadSeed(join(SEEDS_ROOT, 'ts-job-intervals')));
    if (!item) throw new Error('item');
    const issue = item.input.issues[0];
    if (!issue) throw new Error('issue');
    const llmItem = { ...item, config: ConfigSchema.parse({ extraction: { mode: 'llm' } }) };
    const tasks = issue.body
      .split('\n')
      .filter((l) => l.startsWith('- [ ] '))
      .map((l) => l.slice(6));
    const req = (i: number, text: string) => ({
      id: `R${i}`,
      text,
      quote: text,
      source: { kind: 'body' },
      kind: 'behavior',
      explicitness: 'explicit',
      priority: 'must',
      examples: [],
      checkableInCode: true,
    });
    const out = (n: number) => ({
      requirements: tasks.slice(0, n).map((t, i) => req(i + 1, t)),
      openQuestions: [],
    });
    const key = `extract:${issue.ref.owner}/${issue.ref.repo}#${issue.ref.number}`;
    const a = new FakeLlm({ [key]: [out(2)] });
    const b = new FakeLlm({ [key]: [out(1)] });
    const r = await measureStability([llmItem], a, b, 1);
    expect(r).toMatchObject({ measured: 1, deterministic: false, meanJaccard: 0.5 });
  });
});
