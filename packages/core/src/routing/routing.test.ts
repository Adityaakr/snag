import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/schema.js';
import type { ChangeUnit, CodeFact, Requirement, RequirementVerdict } from '../contracts/index.js';
import type { Calibration } from '../verdicts/calibration.js';
import type { RequirementNote } from '../verdicts/requirement.js';
import type { UnitOutcome } from '../verdicts/unit.js';
import {
  gateDecision,
  requirementContentKey,
  type RoutingInput,
  routeFindings,
  unitContentKey,
} from './findings.js';

const cfg = defaultConfig();
const REQ = (id: string, quote = `quote ${id}`): Requirement => ({
  id,
  issue: { owner: 'a', repo: 'b', number: 12 },
  text: `text ${id}`,
  quote,
  source: { kind: 'body' },
  kind: 'behavior',
  explicitness: 'explicit',
  priority: 'must',
  examples: [],
  checkableInCode: true,
});
const V = (
  id: string,
  status: RequirementVerdict['status'],
  confidence: number,
  over: Partial<RequirementVerdict> = {},
) => ({
  verdict: {
    requirementId: id,
    status,
    confidence,
    calibrated: false,
    tested: 'unknown',
    evidence: [],
    testEvidence: [],
    answers: [],
    reasons: [{ template: 't', text: 'x' }],
    ...over,
  } as RequirementVerdict,
  notes: [] as RequirementNote[],
});
const unit = (id: string, over: Partial<ChangeUnit> = {}): ChangeUnit => ({
  id,
  file: `src/${id}.ts`,
  language: 'ts',
  kind: 'source',
  changeType: 'modified',
  lines: { new: [[3, 4]], old: [] },
  patch: '',
  judgeView: '',
  contentHash: `h${id}`.padEnd(40, '0'),
  tokenEstimate: 1,
  facts: [],
  ...over,
});
const U = (
  id: string,
  role: UnitOutcome['verdict']['role'],
  confidence = 0.8,
  integrity?: UnitOutcome['integrity'],
): UnitOutcome => ({
  verdict: { unitId: id, role, answers: [], reasons: [{ template: 'unit.x', text: 'u' }] },
  confidence,
  ...(integrity ? { integrity } : {}),
});
const fact = (
  id: string,
  kind: CodeFact['kind'],
  severity: CodeFact['severity'],
  unitId: string,
): CodeFact => ({ id, kind, severity, unitId, line: 7, detail: `${kind}` });

function route(over: Partial<RoutingInput>) {
  return routeFindings({
    requirements: [],
    verdicts: [],
    units: [],
    unitOutcomes: [],
    mode: 'comment_only',
    thresholds: cfg.thresholds,
    gate: cfg.gate,
    jevModel: 'jev-1.13.0',
    questionSet: 'qs-0.1.0',
    ...over,
  });
}
const one = (
  status: RequirementVerdict['status'],
  confidence: number,
  over: Partial<RequirementVerdict> = {},
  mode: RoutingInput['mode'] = 'comment_only',
) =>
  route({ requirements: [REQ('R1')], verdicts: [V('R1', status, confidence, over)], mode }).findings.find(
    (f) => f.id === 'F-R1',
  );

describe('requirement routing (6.9)', () => {
  it.each<[RequirementVerdict['status'], number, string | undefined, string | undefined]>([
    ['done', 0.9, undefined, undefined],
    ['deferred', 0.9, undefined, undefined],
    ['contradicted', 0.8, 'send_back', 'P0'],
    ['interpretation_mismatch', 0.8, 'ask_author', 'P1'],
    ['partial', 0.6, 'reviewer_attention', 'P1'],
    ['missing', 0.85, 'send_back', 'P0'],
    ['missing', 0.84, 'reviewer_attention', 'P1'],
    ['preexisting', 0.8, 'none', 'P2'],
    ['uncertain', 0.5, 'reviewer_attention', 'P2'],
    ['not_checkable', 0.7, 'reviewer_attention', 'P2'],
  ])('%s at %s routes to %s %s', (status, conf, routeTo, priority) => {
    const f = one(status, conf);
    expect(f?.route).toBe(routeTo);
    expect(f?.priority).toBe(priority);
  });

  it('sends partial requirements back in rework mode', () => {
    expect(one('partial', 0.6, {}, 'rework')).toMatchObject({ route: 'send_back', priority: 'P1' });
  });

  it('raises priority one level on a claim mismatch (P1 becomes P0 send_back)', () => {
    expect(one('partial', 0.6, { claimMismatch: { sentence: 'done' } })).toMatchObject({
      priority: 'P0',
      route: 'send_back',
    });
    expect(one('missing', 0.9, { claimMismatch: { sentence: 'done' } })).toMatchObject({ priority: 'P0' });
  });

  it('adds untested and ambiguity notes with suffixed ids and stable content keys', () => {
    const v = V('R3', 'done', 0.9);
    v.notes = [{ kind: 'untested' }, { kind: 'ambiguity', readings: ['a', 'b'], confidence: 0.7 }];
    const { findings } = route({ requirements: [REQ('R3', 'Only recent orders')], verdicts: [v] });
    expect(findings.map((f) => [f.id, f.type, f.route, f.priority])).toEqual([
      ['F-R3-ambiguity', 'ambiguity', 'ask_author', 'P2'],
      ['F-R3-untested', 'requirement', 'reviewer_attention', 'P2'],
    ]);
    expect(findings[0]?.reasons[0]?.text).toBe('The issue can be read more than one way: "a" or "b".');
    expect(findings[0]?.contentKey).toBe(requirementContentKey(REQ('R3', 'only  recent orders')));
  });
});

describe('unit, test integrity and fact routing', () => {
  it('routes unexplained units, lowering confidence when forward and reverse disagree', () => {
    const v = V('R1', 'done', 0.8);
    const { findings } = route({
      requirements: [REQ('R1')],
      verdicts: [{ ...v, disagreeingUnit: 'U2' }],
      units: [unit('U1'), unit('U2'), unit('U3'), unit('U4')],
      unitOutcomes: [
        U('U1', 'unexplained_behavioral', 0.81),
        U('U2', 'unexplained_benign', 0.9),
        U('U3', 'implements'),
        U('U4', 'uncertain', 0.5),
      ],
    });
    expect(findings.map((f) => [f.id, f.priority, f.route])).toEqual([
      ['F-U1', 'P1', 'reviewer_attention'],
      ['F-U2', 'P2', 'reviewer_attention'],
      ['F-U4', 'P2', 'reviewer_attention'],
    ]);
    expect(findings[1]?.confidence).toBeCloseTo(0.8);
    expect(findings[1]?.reasons.map((r) => r.template)).toContain('check.disagree');
    expect(findings[0]?.contentKey).toBe(unitContentKey(unit('U1')));
  });

  it('makes a test integrity finding P0 send_back when the test is requirement evidence, P1 otherwise', () => {
    const t9 = unit('U9', { kind: 'test', facts: [fact('X1', 'assertion_weakened', 'high', 'U9')] });
    const t8 = unit('U8', { kind: 'test', facts: [] });
    const withEvidence = V('R1', 'uncertain', 0.5, {
      testEvidence: [{ unitId: 'U9', file: 'x', lines: [[1, 2]], probability: 0.9 }],
    });
    const { findings } = route({
      requirements: [REQ('R1')],
      verdicts: [withEvidence],
      units: [t9, t8],
      unitOutcomes: [
        U('U9', 'implements', 0.8, { loosened: 0, factIds: ['X1'], confidence: 1 }),
        U('U8', 'supporting', 0.7, { loosened: 0.75, factIds: [], confidence: 0.75 }),
      ],
    });
    expect(findings.find((f) => f.id === 'F-X1')).toMatchObject({
      type: 'test_integrity',
      priority: 'P0',
      route: 'send_back',
      locations: [{ file: 'src/U9.ts', lines: [7, 7] }],
    });
    expect(findings.find((f) => f.id === 'F-U8-integrity')).toMatchObject({
      type: 'test_integrity',
      priority: 'P1',
    });
  });

  it('routes other facts by severity and raises expected_value_changed on evidence tests', () => {
    const u = unit('U5', {
      kind: 'config',
      facts: [
        fact('X2', 'threshold_lowered', 'high', 'U5'),
        fact('X3', 'suppression_added', 'warn', 'U5'),
        fact('X4', 'dependency_added', 'info', 'U5'),
      ],
    });
    const t = unit('U9', { kind: 'test', facts: [fact('X5', 'expected_value_changed', 'warn', 'U9')] });
    const ev = V('R1', 'done', 0.9, {
      testEvidence: [{ unitId: 'U9', file: 'x', lines: [[1, 1]], probability: 0.8 }],
    });
    const { findings } = route({
      requirements: [REQ('R1')],
      verdicts: [ev],
      units: [u, t],
      unitOutcomes: [U('U5', 'supporting'), U('U9', 'implements')],
    });
    expect(findings.map((f) => [f.id, f.priority, f.route])).toEqual([
      ['F-X2', 'P1', 'reviewer_attention'],
      ['F-X5', 'P1', 'reviewer_attention'],
      ['F-X3', 'P2', 'reviewer_attention'],
      ['F-X4', 'P2', 'none'],
    ]);
  });

  it('sorts findings P0 first with numeric ids and counts statuses, roles and priorities', () => {
    const { findings, summary } = route({
      requirements: [REQ('R2'), REQ('R10')],
      verdicts: [V('R10', 'contradicted', 0.9), V('R2', 'contradicted', 0.8)],
      units: [unit('U1')],
      unitOutcomes: [U('U1', 'unexplained_behavioral')],
    });
    expect(findings.map((f) => f.id)).toEqual(['F-R2', 'F-R10', 'F-U1']);
    expect(summary).toEqual({
      mode: 'comment_only',
      counts: { contradicted: 2, unexplained_behavioral: 1, P0: 2, P1: 1 },
    });
  });
});

describe('gate mode (6.9)', () => {
  const cal = (over: Partial<Calibration> = {}): Calibration => ({
    id: 'c',
    jevModel: 'jev-1.13.0',
    questionSet: 'qs-0.1.0',
    maps: {},
    labeledFindings: 200,
    p0Precision: 0.85,
    ...over,
  });
  const p0 = (confidence: number) => ({
    id: 'F-R1',
    type: 'requirement' as const,
    targetId: 'R1',
    priority: 'P0' as const,
    route: 'send_back' as const,
    confidence,
    locations: [],
    reasons: [],
    contentKey: 'k',
  });
  const base = { gate: cfg.gate, jevModel: 'jev-1.13.0', questionSet: 'qs-0.1.0' };

  it('refuses without a matching calibration, with too few labels, or with low precision', () => {
    expect(gateDecision([p0(0.99)], base)).toMatchObject({
      decision: 'refused',
      warning: expect.stringMatching(/no calibration/),
    });
    expect(gateDecision([p0(0.99)], { ...base, calibration: cal({ jevModel: 'jev-1.14.0' }) }).decision).toBe(
      'refused',
    );
    expect(gateDecision([p0(0.99)], { ...base, calibration: cal({ labeledFindings: 199 }) })).toMatchObject({
      decision: 'refused',
      warning: expect.stringMatching(/199 labeled findings/),
    });
    expect(gateDecision([p0(0.99)], { ...base, calibration: cal({ p0Precision: 0.84 }) })).toMatchObject({
      decision: 'refused',
      warning: expect.stringMatching(/precision is 0.84/),
    });
  });

  it('fails at a P0 confidence of 0.9 and passes below it', () => {
    expect(gateDecision([p0(0.9)], { ...base, calibration: cal() }).decision).toBe('fail');
    expect(gateDecision([p0(0.89)], { ...base, calibration: cal() }).decision).toBe('pass');
  });

  it('records the decision and the refusal warning in the summary', () => {
    const r = route({ mode: 'gate', requirements: [REQ('R1')], verdicts: [V('R1', 'contradicted', 0.95)] });
    expect(r.summary.gateDecision).toBe('refused');
    expect(r.warnings[0]).toMatch(/Gate mode refused/);
    expect(route({ mode: 'comment_only' }).summary.gateDecision).toBeUndefined();
  });
});
