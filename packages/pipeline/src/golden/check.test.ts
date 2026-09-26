import { describe, expect, it } from 'vitest';
import { checkExpected, listScenarios, loadScenario, runScenario } from './harness.js';

describe('checkExpected', () => {
  it.each(listScenarios())('%s passes its own expectations', async (name) => {
    const s = loadScenario(name);
    const { result } = await runScenario(s);
    expect(checkExpected(result, s.expected)).toEqual([]);
  });

  it('reports every kind of mismatch', async () => {
    const s = loadScenario('three_reqs_one_missing');
    const { result } = await runScenario(s);
    const failures = checkExpected(result, {
      requirements: { R1: 'done', R2: 'done', R3: 'done' },
      requirementIds: ['R1'],
      units: [{ file: 'src/reports/export.ts', symbol: 'buildCsv', role: 'supporting' }],
      facts: [{ kind: 'test_skipped', severity: 'high' }],
      findings: [
        { id: 'F-R3', priority: 'P1', route: 'none', reason: 'nope' },
        { id: 'F-R9', priority: 'P0' },
      ],
      noFindingsOfPriority: ['P0'],
      noFindings: true,
      claimMismatch: ['R1'],
      reasons: { R1: 'Implemented but never called.' },
      warnings: ['absent warning'],
      tested: { R1: 'differently' },
      filtered: [{ file: 'src/reports/export.ts', reason: 'lockfile' }],
    });
    expect(failures.length).toBe(15);
  });
});
