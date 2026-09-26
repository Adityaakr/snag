/**
 * Routing (BUILD_PROMPT 6.9): turns verdicts into findings with stable ids, priorities and routes, and decides
 * the mode outcome. Finding ids are stable for the same content; `contentKey` survives re-runs and new pushes.
 */
import { createHash } from 'node:crypto';
import type { Thresholds, RemitConfig } from '../config/schema.js';
import type {
  ChangeUnit,
  Finding,
  Priority,
  Requirement,
  RequirementVerdict,
  ReviewMode,
  ReviewResult,
  Route,
} from '../contracts/index.js';
import { normalizeForMatch } from '../extract/validate.js';
import type { Calibration } from '../verdicts/calibration.js';
import { type Reason, REASONS } from '../verdicts/reasons.js';
import { CONFIDENCE_STEP, type RequirementNote, TEST_WEAKENING } from '../verdicts/requirement.js';
import type { UnitOutcome } from '../verdicts/unit.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);

export function requirementContentKey(r: Requirement): string {
  return `req:${sha(`${r.issue.owner}/${r.issue.repo}#${r.issue.number}|${normalizeForMatch(r.quote).toLowerCase()}`)}`;
}

export function unitContentKey(u: ChangeUnit): string {
  return `unit:${u.contentHash.slice(0, 32)}`;
}

const RAISE: Record<Priority, Priority> = { P2: 'P1', P1: 'P0', P0: 'P0' };

export interface RoutingInput {
  requirements: Requirement[];
  verdicts: { verdict: RequirementVerdict; notes: RequirementNote[]; disagreeingUnit?: string }[];
  units: ChangeUnit[];
  unitOutcomes: UnitOutcome[];
  mode: ReviewMode;
  thresholds: Thresholds;
  gate: RemitConfig['gate'];
  calibration?: Calibration;
  jevModel: string;
  questionSet: string;
}

function locationsOf(v: RequirementVerdict): Finding['locations'] {
  return v.evidence.flatMap((e) => e.lines.map((l) => ({ file: e.file, lines: l })));
}

function unitLocations(u: ChangeUnit): Finding['locations'] {
  const ranges = u.lines.new.length ? u.lines.new : u.lines.old;
  return ranges.length ? ranges.map((l) => ({ file: u.file, lines: l })) : [{ file: u.file, lines: [0, 0] }];
}

const findingId = (targetId: string, suffix?: string) => `F-${targetId}${suffix ? `-${suffix}` : ''}`;

/** Requirement status to route and priority before adjustments. */
function requirementRoute(
  v: RequirementVerdict,
  mode: ReviewMode,
  t: Thresholds,
): { route: Route; priority: Priority } | null {
  switch (v.status) {
    case 'done':
    case 'deferred':
      return null;
    case 'contradicted':
      return { route: 'send_back', priority: 'P0' };
    case 'interpretation_mismatch':
      return { route: 'ask_author', priority: 'P1' };
    case 'partial':
      return { route: mode === 'rework' ? 'send_back' : 'reviewer_attention', priority: 'P1' };
    case 'missing':
      return v.confidence >= t.missing_send_back
        ? { route: 'send_back', priority: 'P0' }
        : { route: 'reviewer_attention', priority: 'P1' };
    case 'preexisting':
      return { route: 'none', priority: 'P2' };
    default:
      return { route: 'reviewer_attention', priority: 'P2' };
  }
}

export interface RoutingResult {
  findings: Finding[];
  summary: ReviewResult['summary'];
  warnings: string[];
}

export function routeFindings(input: RoutingInput): RoutingResult {
  const findings: Finding[] = [];
  const warnings: string[] = [];
  const reqById = new Map(input.requirements.map((r) => [r.id, r]));
  const unitById = new Map(input.units.map((u) => [u.id, u]));
  const evidenceTests = new Set(input.verdicts.flatMap((v) => v.verdict.testEvidence.map((e) => e.unitId)));
  const disagreeing = new Set(input.verdicts.flatMap((v) => (v.disagreeingUnit ? [v.disagreeingUnit] : [])));

  for (const { verdict: v, notes } of input.verdicts) {
    const req = reqById.get(v.requirementId);
    if (!req) continue;
    const key = requirementContentKey(req);
    const base = requirementRoute(v, input.mode, input.thresholds);
    if (base) {
      let { route, priority } = base;
      if (v.claimMismatch) {
        priority = RAISE[priority];
        if (priority === 'P0') route = 'send_back';
      }
      findings.push({
        id: findingId(req.id),
        type: 'requirement',
        targetId: req.id,
        priority,
        route,
        confidence: v.confidence,
        locations: locationsOf(v),
        reasons: v.reasons,
        contentKey: key,
      });
    }
    for (const n of notes) {
      if (n.kind === 'untested') {
        findings.push({
          id: findingId(req.id, 'untested'),
          type: 'requirement',
          targetId: req.id,
          priority: 'P2',
          route: 'reviewer_attention',
          confidence: v.confidence,
          locations: locationsOf(v),
          reasons: [REASONS.untested()],
          contentKey: key,
        });
      } else if (n.kind === 'ambiguity') {
        findings.push({
          id: findingId(req.id, 'ambiguity'),
          type: 'ambiguity',
          targetId: req.id,
          priority: 'P2',
          route: 'ask_author',
          confidence: n.confidence,
          locations: [],
          reasons: [REASONS.ambiguous(n.readings)],
          contentKey: key,
        });
      }
    }
  }

  for (const o of input.unitOutcomes) {
    const u = unitById.get(o.verdict.unitId);
    if (!u) continue;
    const key = unitContentKey(u);
    const lower = disagreeing.has(u.id);
    const conf = Math.max(0, o.confidence - (lower ? CONFIDENCE_STEP : 0));
    const reasons: Reason[] = lower
      ? [...o.verdict.reasons, REASONS.forwardReverseDisagree()]
      : o.verdict.reasons;
    const unitReasons = reasons.filter((r) => !r.template.startsWith('test.'));
    if (o.verdict.role === 'unexplained_behavioral') {
      findings.push({
        id: findingId(u.id),
        type: 'unit',
        targetId: u.id,
        priority: 'P1',
        route: 'reviewer_attention',
        confidence: conf,
        locations: unitLocations(u),
        reasons: unitReasons,
        contentKey: key,
      });
    } else if (o.verdict.role === 'uncertain' || o.verdict.role === 'unexplained_benign') {
      findings.push({
        id: findingId(u.id),
        type: 'unit',
        targetId: u.id,
        priority: 'P2',
        route: 'reviewer_attention',
        confidence: conf,
        locations: unitLocations(u),
        reasons: unitReasons,
        contentKey: key,
      });
    }
    const integrityFacts = new Set(o.integrity?.factIds ?? []);
    if (o.integrity) {
      const isEvidence = evidenceTests.has(u.id);
      const firstFact = o.integrity.factIds[0];
      const f = firstFact ? u.facts.find((x) => x.id === firstFact) : undefined;
      findings.push({
        id: firstFact ? findingId(firstFact) : findingId(u.id, 'integrity'),
        type: 'test_integrity',
        targetId: firstFact ?? u.id,
        priority: isEvidence ? 'P0' : 'P1',
        route: isEvidence ? 'send_back' : 'reviewer_attention',
        confidence: o.integrity.confidence,
        locations: f?.line ? [{ file: u.file, lines: [f.line, f.line] }] : unitLocations(u),
        reasons: reasons.filter((r) => r.template.startsWith('test.')),
        contentKey: `${key}:integrity`,
      });
    }
    for (const fact of u.facts) {
      if (integrityFacts.has(fact.id)) continue;
      if (TEST_WEAKENING.has(fact.kind) && fact.severity === 'high' && u.kind === 'test') continue;
      // expected_value_changed is high when that test is requirement evidence (6.4.2).
      const severity =
        fact.kind === 'expected_value_changed' && evidenceTests.has(u.id) ? 'high' : fact.severity;
      const priority: Priority = severity === 'high' ? 'P1' : 'P2';
      findings.push({
        id: findingId(fact.id),
        type: 'fact',
        targetId: fact.id,
        priority,
        route: severity === 'info' ? 'none' : 'reviewer_attention',
        confidence: 1,
        locations: fact.line ? [{ file: u.file, lines: [fact.line, fact.line] }] : unitLocations(u),
        reasons: [REASONS.fact(fact.detail)],
        contentKey: `${key}:${fact.kind}:${sha(fact.detail)}`,
      });
    }
  }

  const order: Record<Priority, number> = { P0: 0, P1: 1, P2: 2 };
  findings.sort(
    (a, b) => order[a.priority] - order[b.priority] || a.id.localeCompare(b.id, 'en', { numeric: true }),
  );

  const counts: Record<string, number> = {};
  const bump = (k: string) => {
    counts[k] = (counts[k] ?? 0) + 1;
  };
  for (const { verdict } of input.verdicts) bump(verdict.status);
  for (const o of input.unitOutcomes) bump(o.verdict.role);
  for (const f of findings) {
    bump(f.priority);
    if (f.type === 'test_integrity') bump('test_integrity');
  }

  const summary: ReviewResult['summary'] = { counts, mode: input.mode };
  if (input.mode === 'gate') {
    const g = gateDecision(findings, input);
    summary.gateDecision = g.decision;
    if (g.warning) warnings.push(g.warning);
  }
  return { findings, summary, warnings };
}

/**
 * Gate mode only switches on with calibration evidence (6.9): a calibration for this Jev model and question set,
 * at least `min_labeled_findings` labeled findings and measured P0 precision of at least `min_precision`.
 */
export function gateDecision(
  findings: Finding[],
  input: Pick<RoutingInput, 'gate' | 'calibration' | 'jevModel' | 'questionSet'>,
): { decision: 'pass' | 'fail' | 'refused'; warning?: string } {
  const c = input.calibration;
  const g = input.gate;
  if (!c || c.jevModel !== input.jevModel || c.questionSet !== input.questionSet) {
    return {
      decision: 'refused',
      warning: `Gate mode refused: there is no calibration for ${input.jevModel} and ${input.questionSet}. Remit stays comment only until it is measured.`,
    };
  }
  if (c.labeledFindings < g.min_labeled_findings) {
    return {
      decision: 'refused',
      warning: `Gate mode refused: the calibration has ${c.labeledFindings} labeled findings; ${g.min_labeled_findings} are required.`,
    };
  }
  if (c.p0Precision < g.min_precision) {
    return {
      decision: 'refused',
      warning: `Gate mode refused: measured P0 precision is ${c.p0Precision.toFixed(2)}; ${g.min_precision.toFixed(2)} is required.`,
    };
  }
  return {
    decision: findings.some((f) => f.priority === 'P0' && f.confidence >= g.threshold) ? 'fail' : 'pass',
  };
}
