import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/schema.js';
import type { ChangeUnit, CodeFact, Requirement } from '../contracts/index.js';
import { applyMap, type Calibration, calibrator } from './calibration.js';
import {
  type ClaimSignal,
  type ForwardSignal,
  type RequirementContext,
  type ReverseSignal,
  requirementVerdict,
  type TestsSignal,
  type UnitContext,
} from './requirement.js';
import { unitVerdict } from './unit.js';

const T = defaultConfig().thresholds;
const NOCAL = calibrator(undefined, 'jev-1.13.0', 'qs-0.1.0');

const REQ: Requirement = {
  id: 'R1',
  issue: { owner: 'a', repo: 'b', number: 1 },
  text: 'Returns 404 for unknown ids.',
  quote: 'returns 404',
  source: { kind: 'body' },
  kind: 'behavior',
  explicitness: 'explicit',
  priority: 'must',
  examples: [],
  checkableInCode: true,
  signals: { ambiguous: 0.1, checkable: 0.9 },
};

function unit(id: string, over: Partial<ChangeUnit> = {}): ChangeUnit {
  return {
    id,
    file: `src/${id}.ts`,
    language: 'ts',
    kind: 'source',
    changeType: 'modified',
    lines: { new: [[10, 20]], old: [[10, 18]] },
    patch: '',
    judgeView: '',
    contentHash: `hash-${id}`,
    tokenEstimate: 10,
    facts: [],
    ...over,
  };
}

const fact = (
  id: string,
  kind: CodeFact['kind'],
  severity: CodeFact['severity'],
  unitId: string,
): CodeFact => ({ id, kind, severity, unitId, line: 12, detail: `${kind} detail` });

const fwd = (levels: [number, number, number, number], over: Partial<ForwardSignal> = {}): ForwardSignal => ({
  levels,
  confidence: 0.8,
  conflict: 0.05,
  evidence: { unitId: 'U1', probability: 0.9 },
  answers: [],
  ...over,
});

const tests = (over: Partial<TestsSignal> = {}): TestsSignal => ({
  hasCandidates: true,
  assertsAsStated: 0.8,
  assertsDifferently: 0.05,
  examplesChecked: [],
  examplesContradicted: [],
  evidence: { unitId: 'U9', probability: 0.8 },
  answers: [],
  ...over,
});

const claim = (over: Partial<ClaimSignal> = {}): ClaimSignal => ({
  sentence: 'All done.',
  claimsDone: 0.9,
  claimsDeferred: 0.05,
  about: 'R1',
  aboutProbability: 0.9,
  ...over,
});

function ctx(over: Partial<RequirementContext> = {}): RequirementContext {
  const units = new Map<string, UnitContext>([
    ['U1', { unit: unit('U1') }],
    ['U9', { unit: unit('U9', { kind: 'test', file: 'test/u9.test.ts' }) }],
  ]);
  return {
    requirement: REQ,
    forward: fwd([0.05, 0.05, 0.1, 0.8]),
    tests: tests(),
    claims: [],
    widened: false,
    units,
    thresholds: T,
    calibrator: NOCAL,
    ...over,
  };
}

const statusOf = (c: RequirementContext) => {
  const o = requirementVerdict(c);
  return o.kind === 'need' ? `need:${o.need}` : o.verdict.status;
};
const verdictOf = (c: RequirementContext) => {
  const o = requirementVerdict(c);
  if (o.kind !== 'verdict') throw new Error('expected a verdict');
  return o;
};
const req = (over: Partial<Requirement>): Requirement => ({ ...REQ, ...over });

describe('requirement rules (6.7), first match wins, exact threshold edges', () => {
  it.each<[string, Partial<RequirementContext>, string]>([
    // 1. not checkable
    [
      'chk 0.34 < 0.35 is not_checkable',
      { requirement: req({ signals: { ambiguous: 0.1, checkable: 0.34 } }) },
      'not_checkable',
    ],
    ['chk 0.35 is checkable', { requirement: req({ signals: { ambiguous: 0.1, checkable: 0.35 } }) }, 'done'],
    ['no signals skips the checkable rule', { requirement: req({ signals: undefined as never }) }, 'done'],
    // 2. deferred
    [
      'deferred 0.7, about 0.6, c3 0.59',
      {
        forward: fwd([0.2, 0.1, 0.11, 0.59]),
        claims: [claim({ claimsDone: 0.1, claimsDeferred: 0.7, aboutProbability: 0.6 })],
      },
      'deferred',
    ],
    [
      'deferred but c3 0.6 is done',
      { forward: fwd([0.1, 0.1, 0.2, 0.6]), claims: [claim({ claimsDone: 0.1, claimsDeferred: 0.9 })] },
      'done',
    ],
    [
      'deferred 0.69 is not deferred',
      { forward: fwd([0.3, 0.1, 0.1, 0.5]), claims: [claim({ claimsDone: 0.1, claimsDeferred: 0.69 })] },
      'uncertain',
    ],
    [
      'about probability 0.59 is not deferred',
      {
        forward: fwd([0.3, 0.1, 0.1, 0.5]),
        claims: [claim({ claimsDone: 0.1, claimsDeferred: 0.9, aboutProbability: 0.59 })],
      },
      'uncertain',
    ],
    [
      'a claim about another requirement is not deferred',
      {
        forward: fwd([0.3, 0.1, 0.1, 0.5]),
        claims: [claim({ claimsDone: 0.1, claimsDeferred: 0.9, about: 'R2' })],
      },
      'uncertain',
    ],
    // 3. contradicted / interpretation mismatch
    [
      'conflict 0.7 is contradicted',
      { forward: fwd([0.05, 0.05, 0.1, 0.8], { conflict: 0.7 }) },
      'contradicted',
    ],
    ['conflict 0.69 is not', { forward: fwd([0.05, 0.05, 0.1, 0.8], { conflict: 0.69 }) }, 'done'],
    [
      'asserts_differently 0.7 is contradicted',
      { tests: tests({ assertsAsStated: 0.1, assertsDifferently: 0.7 }) },
      'contradicted',
    ],
    [
      'example contradicted 0.7 is contradicted',
      { tests: tests({ examplesContradicted: [0.1, 0.7] }) },
      'contradicted',
    ],
    [
      'contradiction with amb 0.6 is interpretation_mismatch',
      {
        requirement: req({ signals: { ambiguous: 0.6, checkable: 0.9 } }),
        forward: fwd([0.05, 0.05, 0.1, 0.8], { conflict: 0.9 }),
      },
      'interpretation_mismatch',
    ],
    [
      'contradiction with amb 0.59 is contradicted',
      {
        requirement: req({ signals: { ambiguous: 0.59, checkable: 0.9 } }),
        forward: fwd([0.05, 0.05, 0.1, 0.8], { conflict: 0.9 }),
      },
      'contradicted',
    ],
    // 4. done
    ['c3 0.6 and cc 0.5 is done', { forward: fwd([0.1, 0.1, 0.2, 0.6], { confidence: 0.5 }) }, 'done'],
    ['c3 0.59 is not done', { forward: fwd([0.2, 0.1, 0.11, 0.59]) }, 'uncertain'],
    ['cc 0.49 is not done', { forward: fwd([0.1, 0.1, 0.2, 0.6], { confidence: 0.49 }) }, 'uncertain'],
    // 5. partial
    [
      'c2 largest, 0.5, cc 0.5 is partial',
      { forward: fwd([0.1, 0.1, 0.5, 0.3], { confidence: 0.5 }) },
      'partial',
    ],
    ['c2 0.49 is not partial', { forward: fwd([0.2, 0.01, 0.49, 0.3]) }, 'uncertain'],
    [
      'c2 tied with c3 (below full) still counts as the largest level',
      { forward: fwd([0.0, 0.0, 0.5, 0.5], { confidence: 0.8 }) },
      'partial',
    ],
    ['c3 larger than c2 is not partial', { forward: fwd([0.0, 0.0, 0.45, 0.55]) }, 'uncertain'],
    ['cc 0.49 is not partial', { forward: fwd([0.1, 0.1, 0.5, 0.3], { confidence: 0.49 }) }, 'uncertain'],
    // 6. missing: widen, then preexisting, then missing
    ['c0+c1 0.7 asks for the widen pass', { forward: fwd([0.6, 0.1, 0.2, 0.1]) }, 'need:widen'],
    [
      'after widening it asks for preexisting.v0',
      { forward: fwd([0.6, 0.1, 0.2, 0.1]), widened: true },
      'need:preexisting',
    ],
    [
      'already_implemented 0.7 is preexisting',
      {
        forward: fwd([0.6, 0.1, 0.2, 0.1]),
        widened: true,
        preexisting: { alreadyImplemented: 0.7, answers: [] },
      },
      'preexisting',
    ],
    [
      'already_implemented 0.69 is missing',
      {
        forward: fwd([0.6, 0.1, 0.2, 0.1]),
        widened: true,
        preexisting: { alreadyImplemented: 0.69, answers: [] },
      },
      'missing',
    ],
    ['c0+c1 0.69 is uncertain', { forward: fwd([0.59, 0.1, 0.2, 0.11]) }, 'uncertain'],
    // 7. uncertain and no answers
    ['no forward answers is uncertain', { forward: undefined as never }, 'uncertain'],
  ])('%s', (_name, over, expected) => {
    expect(statusOf(ctx(over))).toBe(expected);
  });

  it('treats non-goals as contradicted on conflict and respected otherwise', () => {
    const ng = req({ kind: 'non_goal' });
    expect(statusOf(ctx({ requirement: ng, forward: fwd([0.9, 0.05, 0.03, 0.02], { conflict: 0.7 }) }))).toBe(
      'contradicted',
    );
    const ok = verdictOf(ctx({ requirement: ng, forward: fwd([0.9, 0.05, 0.03, 0.02], { conflict: 0.2 }) }));
    expect([ok.verdict.status, ok.verdict.confidence, ok.verdict.reasons[0]?.template]).toEqual([
      'done',
      0.8,
      'req.non_goal_respected',
    ]);
  });

  it('reports the confidence for each status', () => {
    expect(verdictOf(ctx({ forward: fwd([0.05, 0.05, 0.1, 0.8]) })).verdict.confidence).toBeCloseTo(0.8);
    expect(
      verdictOf(
        ctx({
          forward: fwd([0.6, 0.2, 0.1, 0.1]),
          widened: true,
          preexisting: { alreadyImplemented: 0.1, answers: [] },
        }),
      ).verdict.confidence,
    ).toBeCloseTo(0.8);
    expect(verdictOf(ctx({ forward: fwd([0.1, 0.1, 0.5, 0.3]) })).verdict.confidence).toBeCloseTo(0.5);
    expect(
      verdictOf(ctx({ forward: fwd([0.05, 0.05, 0.1, 0.8], { conflict: 0.85 }) })).verdict.confidence,
    ).toBeCloseTo(0.85);
    expect(verdictOf(ctx({ forward: fwd([0.3, 0.1, 0.1, 0.5]) })).verdict.confidence).toBeCloseTo(0.5);
  });
});

describe('adjustments after the rules (6.7)', () => {
  it.each<[string, Partial<RequirementContext>, string]>([
    ['no candidate tests is unknown', { tests: tests({ hasCandidates: false }) }, 'unknown'],
    ['asserts_as_stated 0.6 is as_stated', { tests: tests({ assertsAsStated: 0.6 }) }, 'as_stated'],
    [
      'asserts_differently 0.7 is differently',
      { tests: tests({ assertsAsStated: 0.59, assertsDifferently: 0.7 }) },
      'differently',
    ],
    ['otherwise untested', { tests: tests({ assertsAsStated: 0.59, assertsDifferently: 0.69 }) }, 'untested'],
  ])('tested flag: %s', (_n, over, expected) => {
    expect(verdictOf(ctx(over)).verdict.tested).toBe(expected);
  });

  it('adds an untested note only to done behavior requirements', () => {
    expect(verdictOf(ctx({ tests: tests({ assertsAsStated: 0.1 }) })).notes).toEqual([{ kind: 'untested' }]);
    expect(
      verdictOf(ctx({ requirement: req({ kind: 'docs' }), tests: tests({ assertsAsStated: 0.1 }) })).notes,
    ).toEqual([]);
  });

  it('downgrades done to partial when the implementation is never called', () => {
    const units = new Map<string, UnitContext>([
      ['U1', { unit: unit('U1', { facts: [fact('X1', 'new_symbol_unreferenced', 'warn', 'U1')] }) }],
    ]);
    const o = verdictOf(ctx({ units, tests: tests({ hasCandidates: false, evidence: null }) }));
    expect(o.verdict.status).toBe('partial');
    expect(o.verdict.reasons.map((r) => r.text)).toContain('Implemented but never called.');
  });

  it('downgrades done to uncertain when the covering test was loosened (fact or loosens_test >= 0.7)', () => {
    const testUnit = (facts: CodeFact[], loosensTest?: number): UnitContext => ({
      unit: unit('U9', { kind: 'test', facts }),
      ...(loosensTest !== undefined
        ? {
            reverse: {
              servesTop: 'R1',
              servesRequirementProbability: 0.8,
              servesRequirementId: 'R1',
              plumbing: 0.1,
              behaviorChange: 0.1,
              loosensTest,
              answers: [],
            },
          }
        : {}),
    });
    const withTest = (u: UnitContext) =>
      new Map<string, UnitContext>([
        ['U1', { unit: unit('U1') }],
        ['U9', u],
      ]);
    expect(
      verdictOf(ctx({ units: withTest(testUnit([fact('X2', 'assertion_weakened', 'high', 'U9')])) })).verdict
        .status,
    ).toBe('uncertain');
    expect(
      verdictOf(ctx({ units: withTest(testUnit([], 0.7)) })).verdict.reasons.map((r) => r.template),
    ).toContain('req.loosened_evidence');
    expect(verdictOf(ctx({ units: withTest(testUnit([], 0.69)) })).verdict.status).toBe('done');
    expect(
      verdictOf(ctx({ units: withTest(testUnit([fact('X3', 'expected_value_changed', 'warn', 'U9')])) }))
        .verdict.status,
    ).toBe('done');
  });

  it('adds an ambiguity note at amb >= 0.6 except on interpretation mismatches', () => {
    const amb = req({
      signals: { ambiguous: 0.6, checkable: 0.9 },
      openQuestion: { readings: ['last 7 days', 'last 30 days'] },
    });
    expect(verdictOf(ctx({ requirement: amb })).notes).toEqual([
      { kind: 'ambiguity', readings: ['last 7 days', 'last 30 days'], confidence: 0.6 },
    ]);
    expect(
      verdictOf(ctx({ requirement: amb, forward: fwd([0.05, 0.05, 0.1, 0.8], { conflict: 0.9 }) })).notes,
    ).toEqual([]);
    expect(
      verdictOf(ctx({ requirement: req({ signals: { ambiguous: 0.59, checkable: 0.9 } }) })).notes,
    ).toEqual([]);
  });

  it('attaches a claim mismatch when the PR says done but the status is a problem', () => {
    const missing = {
      forward: fwd([0.6, 0.2, 0.1, 0.1]),
      widened: true,
      preexisting: { alreadyImplemented: 0.1, answers: [] },
    };
    expect(
      verdictOf(ctx({ ...missing, claims: [claim({ claimsDone: 0.7, aboutProbability: 0.6 })] })).verdict
        .claimMismatch,
    ).toEqual({ sentence: 'All done.' });
    expect(
      verdictOf(ctx({ ...missing, claims: [claim({ claimsDone: 0.69 })] })).verdict.claimMismatch,
    ).toBeUndefined();
    expect(verdictOf(ctx({ claims: [claim()] })).verdict.claimMismatch).toBeUndefined();
    expect(
      verdictOf(ctx({ forward: fwd([0.05, 0.05, 0.1, 0.8], { conflict: 0.9 }), claims: [claim()] })).verdict
        .claimMismatch,
    ).toBeDefined();
  });

  it('lowers confidence one step when forward and reverse disagree', () => {
    const rev = (plumbing: number): ReverseSignal => ({
      servesTop: 'none',
      servesRequirementProbability: 0.2,
      servesRequirementId: 'R1',
      plumbing,
      behaviorChange: 0.5,
      answers: [],
    });
    const units = (p: number) =>
      new Map<string, UnitContext>([
        ['U1', { unit: unit('U1'), reverse: rev(p) }],
        ['U9', { unit: unit('U9', { kind: 'test' }) }],
      ]);
    const o = verdictOf(ctx({ units: units(0.59) }));
    expect(o.verdict.confidence).toBeCloseTo(0.7);
    expect(o.disagreeingUnit).toBe('U1');
    expect(verdictOf(ctx({ units: units(0.6) })).disagreeingUnit).toBeUndefined();
  });

  it('reports examples no test checks, and evidence with line ranges', () => {
    const o = verdictOf(
      ctx({ forward: fwd([0.1, 0.1, 0.5, 0.3]), tests: tests({ examplesChecked: [0.9, 0.8, 0.2] }) }),
    );
    expect(o.notes).toContainEqual({ kind: 'examples_not_checked', indexes: [2] });
    expect(o.verdict.reasons.map((r) => r.text)).toContain('Example 3 is not checked by any test.');
    expect(o.verdict.evidence).toEqual([
      { unitId: 'U1', file: 'src/U1.ts', lines: [[10, 20]], probability: 0.9 },
    ]);
    expect(o.verdict.testEvidence[0]?.unitId).toBe('U9');
  });

  it('uses a calibration only for the matching model and question set', () => {
    const cal: Calibration = {
      id: 'cal1',
      jevModel: 'jev-1.13.0',
      questionSet: 'qs-0.1.0',
      maps: {
        'forward.coverage.level3': [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.7 },
          { x: 1, y: 1 },
        ],
      },
      labeledFindings: 300,
      p0Precision: 0.9,
    };
    const c = ctx({
      calibrator: calibrator(cal, 'jev-1.13.0', 'qs-0.1.0'),
      forward: fwd([0.2, 0.2, 0.1, 0.5]),
    });
    const o = verdictOf(c);
    expect(o.verdict.status).toBe('done');
    expect(o.verdict.calibrated).toBe(true);
    expect(
      verdictOf(
        ctx({ calibrator: calibrator(cal, 'jev-1.14.0', 'qs-0.1.0'), forward: fwd([0.2, 0.2, 0.1, 0.5]) }),
      ).verdict.calibrated,
    ).toBe(false);
    expect(applyMap(undefined, 0.3)).toBe(0.3);
    expect(
      applyMap(
        [
          { x: 0.2, y: 0.1 },
          { x: 0.8, y: 0.9 },
        ],
        0.5,
      ),
    ).toBeCloseTo(0.5);
    expect(applyMap([{ x: 0.2, y: 0.1 }], 0)).toBe(0.1);
  });
});

describe('unit rules (6.7)', () => {
  const rev = (over: Partial<ReverseSignal> = {}): ReverseSignal => ({
    servesTop: 'none',
    servesRequirementProbability: 0.1,
    servesRequirementId: 'R1',
    plumbing: 0.1,
    behaviorChange: 0.1,
    answers: [],
    ...over,
  });
  it.each<[string, ChangeUnit, ReverseSignal | undefined, string]>([
    ['filtered units are ignored', unit('U1', { filtered: 'lockfile' }), rev(), 'ignored'],
    ['no answers is uncertain', unit('U1'), undefined, 'uncertain'],
    [
      'serves 0.55 implements',
      unit('U1'),
      rev({ servesTop: 'R1', servesRequirementProbability: 0.55 }),
      'implements',
    ],
    [
      'serves 0.54 does not',
      unit('U1'),
      rev({ servesTop: 'R1', servesRequirementProbability: 0.54 }),
      'unexplained_benign',
    ],
    ['plumbing 0.6 is supporting', unit('U1'), rev({ plumbing: 0.6 }), 'supporting'],
    ['plumbing 0.59 is not', unit('U1'), rev({ plumbing: 0.59 }), 'unexplained_benign'],
    [
      'behavior 0.6 is unexplained_behavioral',
      unit('U1'),
      rev({ behaviorChange: 0.6 }),
      'unexplained_behavioral',
    ],
    [
      'runtime setting 0.6 is unexplained_behavioral',
      unit('U1', { kind: 'config' }),
      rev({ runtimeSetting: 0.6 }),
      'unexplained_behavioral',
    ],
    [
      'behavior 0.59 is not',
      unit('U1'),
      rev({ behaviorChange: 0.59, servesRequirementProbability: 0.1 }),
      'unexplained_benign',
    ],
    [
      'serves and behavior in 0.4 to 0.6 is uncertain',
      unit('U1'),
      rev({ servesRequirementProbability: 0.45, behaviorChange: 0.5 }),
      'uncertain',
    ],
    [
      'serves in band but behavior low is benign',
      unit('U1'),
      rev({ servesRequirementProbability: 0.45, behaviorChange: 0.39 }),
      'unexplained_benign',
    ],
  ])('%s', (_n, u, r, role) => {
    expect(unitVerdict(u, r, T, NOCAL).verdict.role).toBe(role);
  });

  it('flags test integrity from high facts or loosens_test >= 0.7, only on test units', () => {
    const t = (facts: CodeFact[], loosensTest?: number) =>
      unitVerdict(
        unit('U9', { kind: 'test', facts }),
        rev({ ...(loosensTest !== undefined ? { loosensTest } : {}) }),
        T,
        NOCAL,
      );
    expect(t([fact('X1', 'assertion_weakened', 'high', 'U9')]).integrity).toEqual({
      loosened: 0,
      factIds: ['X1'],
      confidence: 1,
    });
    expect(t([], 0.7).integrity).toEqual({ loosened: 0.7, factIds: [], confidence: 0.7 });
    expect(t([], 0.69).integrity).toBeUndefined();
    expect(t([fact('X2', 'expected_value_changed', 'warn', 'U9')]).integrity).toBeUndefined();
    expect(
      unitVerdict(unit('U1', { facts: [fact('X3', 'assertion_removed', 'high', 'U1')] }), rev(), T, NOCAL)
        .integrity,
    ).toBeUndefined();
    expect(t([fact('X1', 'test_skipped', 'high', 'U9')]).verdict.testIntegrity).toEqual({
      loosened: 0,
      factIds: ['X1'],
    });
  });
});

describe('remaining 6.7 threshold edges (M4 gate)', () => {
  it.each<[string, Partial<RequirementContext>, string]>([
    [
      'asserts_differently 0.69 is not contradicted',
      { tests: tests({ assertsAsStated: 0.1, assertsDifferently: 0.69 }) },
      'done',
    ],
    [
      'example contradicted 0.69 is not contradicted',
      { tests: tests({ examplesContradicted: [0.1, 0.69] }) },
      'done',
    ],
  ])('%s', (_n, over, expected) => {
    expect(statusOf(ctx(over))).toBe(expected);
  });

  it('claim mismatch: partial counts, about 0.59 or another requirement does not', () => {
    const missing = {
      forward: fwd([0.6, 0.2, 0.1, 0.1]),
      widened: true,
      preexisting: { alreadyImplemented: 0.1, answers: [] },
    };
    expect(
      verdictOf(ctx({ forward: fwd([0.1, 0.1, 0.5, 0.3]), claims: [claim()] })).verdict.claimMismatch,
    ).toEqual({ sentence: 'All done.' });
    expect(
      verdictOf(ctx({ ...missing, claims: [claim({ aboutProbability: 0.59 })] })).verdict.claimMismatch,
    ).toBeUndefined();
    expect(
      verdictOf(ctx({ ...missing, claims: [claim({ about: 'R2' })] })).verdict.claimMismatch,
    ).toBeUndefined();
  });

  it('forward and reverse agree when the evidence unit serves a requirement', () => {
    const agreeing = new Map<string, UnitContext>([
      [
        'U1',
        {
          unit: unit('U1'),
          reverse: {
            servesTop: 'R1',
            servesRequirementProbability: 0.8,
            servesRequirementId: 'R1',
            plumbing: 0.1,
            behaviorChange: 0.8,
            answers: [],
          },
        },
      ],
      ['U9', { unit: unit('U9', { kind: 'test' }) }],
    ]);
    const o = verdictOf(ctx({ units: agreeing }));
    expect(o.disagreeingUnit).toBeUndefined();
    expect(o.verdict.confidence).toBeCloseTo(0.8); // not lowered
  });

  const rev = (over: Partial<ReverseSignal>): ReverseSignal => ({
    servesTop: 'none',
    servesRequirementProbability: 0.1,
    servesRequirementId: 'R1',
    plumbing: 0.1,
    behaviorChange: 0.1,
    answers: [],
    ...over,
  });
  it.each<[string, Partial<ReverseSignal>, string]>([
    [
      'serves 0.4 and behavior 0.4 (band edges) is uncertain',
      { servesRequirementProbability: 0.4, behaviorChange: 0.4 },
      'uncertain',
    ],
    [
      'serves 0.54 and behavior 0.59 is uncertain',
      { servesRequirementProbability: 0.54, behaviorChange: 0.59 },
      'uncertain',
    ],
    [
      'serves 0.6 (upper band edge, top answer none) and behavior 0.5 is uncertain',
      { servesRequirementProbability: 0.6, behaviorChange: 0.5 },
      'uncertain',
    ],
    [
      'serves 0.39 is below the band',
      { servesRequirementProbability: 0.39, behaviorChange: 0.5 },
      'unexplained_benign',
    ],
    [
      'serves 0.61 (top answer none) is above the band',
      { servesRequirementProbability: 0.61, behaviorChange: 0.5 },
      'unexplained_benign',
    ],
    [
      'behavior 0.39 is below the band',
      { servesRequirementProbability: 0.5, behaviorChange: 0.39 },
      'unexplained_benign',
    ],
  ])('unit rule 5: %s', (_n, over, role) => {
    expect(unitVerdict(unit('U1'), rev(over), T, NOCAL).verdict.role).toBe(role);
  });
});

describe('last 6.7 edges (M4 re-audit)', () => {
  const rev = (over: Partial<ReverseSignal>): ReverseSignal => ({
    servesTop: 'none',
    servesRequirementProbability: 0.1,
    servesRequirementId: 'R1',
    plumbing: 0.1,
    behaviorChange: 0.1,
    answers: [],
    ...over,
  });

  it('unit rule 4: runtime_setting 0.6 is behavioral, 0.59 is not', () => {
    expect(
      unitVerdict(unit('U1', { kind: 'config' }), rev({ runtimeSetting: 0.6 }), T, NOCAL).verdict.role,
    ).toBe('unexplained_behavioral');
    expect(
      unitVerdict(unit('U1', { kind: 'config' }), rev({ runtimeSetting: 0.59 }), T, NOCAL).verdict.role,
    ).toBe('unexplained_benign');
  });

  it('non-goal: conflict 0.7 is contradicted, 0.69 is respected', () => {
    const ng = req({ kind: 'non_goal' });
    expect(statusOf(ctx({ requirement: ng, forward: fwd([0.9, 0.05, 0.03, 0.02], { conflict: 0.7 }) }))).toBe(
      'contradicted',
    );
    expect(
      statusOf(ctx({ requirement: ng, forward: fwd([0.9, 0.05, 0.03, 0.02], { conflict: 0.69 }) })),
    ).toBe('done');
  });

  it('an example counts as checked at 0.5 and as not checked at 0.49', () => {
    const notes = (checked: number) =>
      verdictOf(ctx({ forward: fwd([0.1, 0.1, 0.5, 0.3]), tests: tests({ examplesChecked: [checked] }) }))
        .notes;
    expect(notes(0.5).some((n) => n.kind === 'examples_not_checked')).toBe(false);
    expect(notes(0.49)).toContainEqual({ kind: 'examples_not_checked', indexes: [0] });
  });
});
