import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCorpus } from './corpora/files.js';
import { loadSeed } from './mutations/seed.js';
import { OracleJev, refMatches } from './oracle.js';
import { runItem } from './runner.js';

const SEEDS = join(import.meta.dirname, '..', '..', '..', 'eval', 'corpora', 'mutations', 'seeds');

describe('OracleJev', () => {
  it('refuses test-split seeds, so training data can never come from them', async () => {
    const [item] = await loadCorpus('mutations', 'dev');
    const testSeed = loadSeed(join(SEEDS, 'ts-list-pagination')).seed;
    expect(testSeed.split).toBe('test');
    expect(() => new OracleJev(item as never, testSeed)).toThrow(/refuses seed ts-list-pagination/);
  });

  it('records label-decided targets and steers the pipeline to the labeled verdicts', async () => {
    const items = await loadCorpus('mutations', 'dev');
    const drop = items.find((i) => i.id.endsWith('ts-job-intervals.drop_requirement.R1'));
    if (!drop) throw new Error('fixture item missing');
    const oracle = new OracleJev(drop, loadSeed(join(SEEDS, 'ts-job-intervals')).seed);
    const out = await runItem(drop, { mode: 'live', jev: oracle });
    expect(out.result.requirementVerdicts.find((v) => v.requirementId === 'R1')?.status).toBe('missing');
    const cov = oracle.records.find(
      (r) => r.call === 'forward' && r.targetId === 'R1' && r.qid === 'coverage',
    );
    expect(cov?.target).toEqual({ probabilities: { '0': 1 } });
    const conflict = oracle.records.find(
      (r) => r.call === 'forward' && r.targetId === 'R2' && r.qid === 'conflict',
    );
    expect(conflict?.target).toEqual({ noul: 0 });
    expect(oracle.records.every((r) => r.seedId === 'ts-job-intervals')).toBe(true);
  });

  it('matches units to seed refs by file and symbol, or by test titles', () => {
    expect(refMatches({ file: 'a.ts', symbol: 'parse' }, { file: 'a.ts', symbol: 'parse' })).toBe(true);
    expect(
      refMatches({ file: 'a.ts', titles: ['x', 'parses hours'] }, { file: 'a.ts', symbol: 'parses hours' }),
    ).toBe(true);
    expect(refMatches({ file: 'b.ts', symbol: 'parse' }, { file: 'a.ts', symbol: 'parse' })).toBe(false);
    // Exact names only (label audit): substrings must not match.
    expect(
      refMatches(
        { file: 'src/parser.rs', symbol: 'get' },
        { file: 'src/parser.rs', symbol: 'Config/get_bool' },
      ),
    ).toBe(false);
    expect(
      refMatches(
        { file: 'src/lib.rs', symbol: 'parse_errors_name_the_input' },
        { file: 'src/lib.rs', symbol: 'parse' },
      ),
    ).toBe(false);
  });

  it('applies adjudications: excluded labels are not recorded, relabels replace the target', async () => {
    const items = await loadCorpus('mutations', 'dev');
    const flip = items.find((i) => i.id.endsWith('py-csv-import.flip_condition.R4'));
    if (!flip) throw new Error('fixture item missing');
    const oracle = new OracleJev(flip, loadSeed(join(SEEDS, 'py-csv-import')).seed);
    await runItem(flip, { mode: 'live', jev: oracle });
    const diff = oracle.records.filter((r) => r.targetId === 'R4' && r.qid === 'asserts_differently');
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.every((r) => 'noul' in r.target && r.target.noul === 0)).toBe(true);
    expect(oracle.records.some((r) => r.targetId === 'R4' && r.qid === 'asserts_as_stated')).toBe(false);
  });

  it('leaves conflict unlabeled for the targeted requirement of partial and unwire items', async () => {
    const items = await loadCorpus('mutations', 'dev');
    const partial = items.find((i) => i.id.endsWith('ts-job-intervals.partial_requirement.R1'));
    if (!partial) throw new Error('fixture item missing');
    const oracle = new OracleJev(partial, loadSeed(join(SEEDS, 'ts-job-intervals')).seed);
    await runItem(partial, { mode: 'live', jev: oracle });
    expect(oracle.records.some((r) => r.targetId === 'R1' && r.qid === 'conflict')).toBe(false);
    expect(oracle.records.some((r) => r.targetId === 'R1' && r.qid === 'coverage')).toBe(true);
  });
});
