import { describe, expect, it } from 'vitest';
import type { ItemLabels } from '../item.js';
import { aggregate, type Prediction, scoreItem, type UnitIndex } from './score.js';

const labels = (patch: Partial<ItemLabels> = {}): ItemLabels => ({
  requirements: { R1: 'done', R2: 'done' },
  requirementsAccept: {},
  units: [],
  facts: [],
  testIntegrity: [],
  claimMismatch: [],
  pr: 'clean',
  ...patch,
});

const units: UnitIndex = (_id, file, symbol) =>
  file === 'src/config.py' && symbol === 'settings'
    ? [10, 14]
    : file === 'tests/test_x.py' && symbol === 'test_a'
      ? [5, 9]
      : undefined;

const pred = (id: string, l: ItemLabels, patch: Partial<Prediction> = {}): Prediction => ({
  id,
  labels: l,
  statuses: Object.fromEntries(Object.entries(l.requirements)),
  surfaced: [],
  failed: false,
  costUsd: 0.01,
  latencyMs: 1000,
  cached: false,
  ...patch,
});

describe('scoreItem', () => {
  const drop = labels({ requirements: { R1: 'missing', R2: 'done' }, pr: 'problem' });

  it('counts a target only when a surfaced finding reaches the user, separately from status accuracy', () => {
    const s = scoreItem(pred('m/s.drop_requirement.R1', drop, { surfaced: [] }), units);
    expect(s.requirements.correct).toBe(2); // statuses right
    expect(s.target).toEqual({ measurable: true, strict: false, any: false }); // but nothing surfaced
    expect(s.entireReview).toBe(false);
  });

  it('a wrong defect type is flagged-any but not strict, and counts against precision', () => {
    const s = scoreItem(
      pred('m/s.drop_requirement.R1', drop, {
        statuses: { R1: 'contradicted', R2: 'done' },
        surfaced: [{ id: 'f1', type: 'requirement', requirement: 'R1', status: 'contradicted' }],
      }),
      units,
    );
    expect(s.target).toEqual({ measurable: true, strict: false, any: true });
    expect(s.correctFindings).toBe(0);
    expect(s.typeMismatches).toBe(1);
  });

  it('sharing a file is not enough: the finding must overlap the labelled unit', () => {
    const inject = labels({
      units: [{ file: 'src/config.py', symbol: 'settings', role: 'unexplained_behavioral' }],
      pr: 'problem',
    });
    const far = scoreItem(
      pred('m/s.inject_config.src_config.py', inject, {
        surfaced: [{ id: 'u1', type: 'unit', file: 'src/config.py', lines: [40, 45] }],
      }),
      units,
    );
    expect(far.target?.strict).toBe(false);
    expect(far.falseFindings).toBe(1);
    const near = scoreItem(
      pred('m/s.inject_config.src_config.py', inject, {
        surfaced: [{ id: 'u1', type: 'unit', file: 'src/config.py', lines: [12, 12] }],
      }),
      units,
    );
    expect(near.target?.strict).toBe(true);
    expect(near.correctFindings).toBe(1);
  });

  it('duplicate findings do not multiply true positives', () => {
    const s = scoreItem(
      pred('m/s.drop_requirement.R1', drop, {
        surfaced: [
          { id: 'a', type: 'requirement', requirement: 'R1', status: 'missing' },
          { id: 'b', type: 'requirement', requirement: 'R1', status: 'missing' },
        ],
      }),
      units,
    );
    expect(s.correctFindings).toBe(1);
    expect(s.duplicates).toBe(1);
    expect(s.entireReview).toBe(false);
  });

  it('a defect whose location cannot be resolved is unmeasured, never found or missed', () => {
    const l = labels({
      units: [{ file: 'src/other.py', symbol: 'nope', role: 'unexplained_behavioral' }],
      pr: 'problem',
    });
    const s = scoreItem(pred('m/s.inject_config.src_other.py', l, { surfaced: [] }), units);
    expect(s.target?.measurable).toBe(false);
    expect(s.defects.unmeasurable).toBe(1);
    expect(aggregate([s]).targetRecallStrict.n).toBe(0);
    expect(aggregate([s]).targetUnmeasured).toBe(1);
  });

  it('entire review needs labelled facts and test integrity; a unit finding on a weakened test is a type mismatch', () => {
    const weak = labels({
      facts: [{ kind: 'assertion_weakened', file: 'tests/test_x.py', symbol: 'test_a' }],
      testIntegrity: [{ file: 'tests/test_x.py', symbol: 'test_a' }],
      pr: 'problem',
    });
    const asUnit = scoreItem(
      pred('m/s.weaken_assertion.tests_test_x.py', weak, {
        surfaced: [{ id: 'u', type: 'unit', file: 'tests/test_x.py', lines: [6, 6] }],
      }),
      units,
    );
    expect(asUnit.target).toEqual({ measurable: true, strict: false, any: true });
    const right = scoreItem(
      pred('m/s.weaken_assertion.tests_test_x.py', weak, {
        surfaced: [{ id: 't', type: 'test_integrity', file: 'tests/test_x.py', lines: [7, 7] }],
        facts: [{ kind: 'assertion_weakened', file: 'tests/test_x.py', line: 7 }],
      }),
      units,
    );
    expect(right.entireReview).toBe(true);
    const noFact = scoreItem(
      pred('m/s.weaken_assertion.tests_test_x.py', weak, {
        surfaced: [{ id: 't', type: 'test_integrity', file: 'tests/test_x.py', lines: [7, 7] }],
      }),
      units,
    );
    expect(noFact.entireReview).toBe(false);
  });

  it('failed reviews stay in the completion denominator and are never entirely correct', () => {
    const ok = scoreItem(pred('m/s.clean', labels()), units);
    const bad = scoreItem(pred('m/t.clean', labels(), { failed: true }), units);
    expect(bad.entireReview).toBe(false);
    const agg = aggregate([ok, bad]);
    expect(agg.completion).toMatchObject({ k: 1, n: 2 });
    expect(agg.entireReview).toMatchObject({ k: 1, n: 2 });
  });

  it('separates cached from live latency', () => {
    const live = scoreItem(pred('m/s.clean', labels(), { latencyMs: 20_000, cached: false }), units);
    const cached = scoreItem(pred('m/t.clean', labels(), { latencyMs: 3, cached: true }), units);
    const agg = aggregate([live, cached]);
    expect(agg.latencyLive).toEqual({ n: 1, p50: 20_000, p95: 20_000 });
    expect(agg.cachedItems).toBe(1);
  });

  it('a file-level fact label is checked at file level, not against some unit of that file', () => {
    // The index would return a range for any unit of the file; a symbol-less label must not use it.
    const anyUnit: UnitIndex = () => [1, 2];
    const l = labels({ facts: [{ kind: 'new_symbol_unreferenced', file: 'src/version.rs' }], pr: 'problem' });
    const s = scoreItem(
      pred('m/s.clean', l, {
        facts: [{ kind: 'new_symbol_unreferenced', file: 'src/version.rs', line: 29 }],
      }),
      anyUnit,
    );
    expect(s.entireReviewBlockers.filter((b) => b.startsWith('fact'))).toEqual([]);
  });
});
