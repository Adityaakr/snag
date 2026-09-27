/**
 * Requirement verdict rules (BUILD_PROMPT 6.7). Pure: when a rule needs the widen pass or `preexisting.v0`, the
 * engine returns a request instead of calling anything, and the pipeline re-runs it with the new answers.
 * Rules are first-match; adjustments apply afterwards.
 */
import type { Answer, ChangeUnit, Evidence, Requirement, RequirementVerdict } from '../contracts/index.js';
import type { Thresholds } from '../config/schema.js';
import type { Calibrator } from './calibration.js';
import { type Reason, REASONS } from './reasons.js';

/** High-severity facts that mean a test was weakened. */
export const TEST_WEAKENING = new Set([
  'assertion_removed',
  'assertion_weakened',
  'test_skipped',
  'test_focused',
  'test_deleted',
]);

/** How much a confidence drops when forward and reverse checks disagree. */
export const CONFIDENCE_STEP = 0.1;

export interface ForwardSignal {
  /** Coverage level probabilities c0..c3. */
  levels: [number, number, number, number];
  confidence: number;
  conflict: number;
  evidence: { unitId: string; probability: number } | null;
  answers: Answer[];
}

export interface TestsSignal {
  hasCandidates: boolean;
  assertsAsStated: number;
  assertsDifferently: number;
  examplesChecked: number[];
  examplesContradicted: number[];
  evidence: { unitId: string; probability: number } | null;
  answers: Answer[];
}

export interface ClaimSignal {
  sentence: string;
  claimsDone: number;
  claimsDeferred: number;
  /** Requirement id the sentence is about, or null for `none`. */
  about: string | null;
  aboutProbability: number;
}

export interface ReverseSignal {
  /** Top `serves` option: a requirement id or `none`. */
  servesTop: string;
  /** Probability that the unit serves some requirement: 1 - P(none) (the most likely requirement is `servesRequirementId`). */
  servesRequirementProbability: number;
  servesRequirementId: string | null;
  plumbing: number;
  behaviorChange: number;
  loosensTest?: number;
  runtimeSetting?: number;
  answers: Answer[];
}

export interface UnitContext {
  unit: ChangeUnit;
  reverse?: ReverseSignal;
}

export interface RequirementContext {
  requirement: Requirement;
  forward?: ForwardSignal;
  tests?: TestsSignal;
  claims: ClaimSignal[];
  /** True once the widen pass ran (or nothing was left to widen with). */
  widened: boolean;
  preexisting?: { alreadyImplemented: number; answers: Answer[] };
  units: ReadonlyMap<string, UnitContext>;
  thresholds: Thresholds;
  calibrator: Calibrator;
  /** Extra answers to keep with the verdict (for example issue.v0). */
  extraAnswers?: Answer[];
}

export type RequirementNote =
  | { kind: 'untested' }
  | { kind: 'ambiguity'; readings: string[]; confidence: number }
  | { kind: 'examples_not_checked'; indexes: number[] };

export type RequirementOutcome =
  | { kind: 'need'; need: 'widen' | 'preexisting' }
  | { kind: 'verdict'; verdict: RequirementVerdict; notes: RequirementNote[]; disagreeingUnit?: string };

const clamp = (x: number) => Math.min(1, Math.max(0, x));

function evidenceFor(
  ctx: RequirementContext,
  pick: { unitId: string; probability: number } | null | undefined,
): Evidence[] {
  if (!pick) return [];
  const u = ctx.units.get(pick.unitId)?.unit;
  if (!u) return [];
  return [
    {
      unitId: u.id,
      file: u.file,
      lines: u.lines.new.length ? u.lines.new : u.lines.old,
      probability: pick.probability,
    },
  ];
}

/** Claims about this requirement above the 6.7 thresholds. */
function claimsAbout(
  ctx: RequirementContext,
  field: 'claimsDone' | 'claimsDeferred',
): ClaimSignal | undefined {
  return ctx.claims.find(
    (c) => c[field] >= 0.7 && c.about === ctx.requirement.id && c.aboutProbability >= 0.6,
  );
}

export function requirementVerdict(ctx: RequirementContext): RequirementOutcome {
  const t = ctx.thresholds;
  const cal = ctx.calibrator;
  const r = ctx.requirement;
  const answers = [
    ...(ctx.extraAnswers ?? []),
    ...(ctx.forward?.answers ?? []),
    ...(ctx.tests?.answers ?? []),
    ...(ctx.preexisting?.answers ?? []),
  ];
  const reasons: Reason[] = [];
  const notes: RequirementNote[] = [];

  const chk = r.signals ? cal.value('issue.checkable_in_code', r.signals.checkable) : undefined;
  const amb = r.signals ? cal.value('issue.ambiguous', r.signals.ambiguous) : 0;
  const f = ctx.forward;
  const [rc0, rc1, rc2, rc3] = f?.levels ?? [0, 0, 0, 0];
  const c3 = cal.value('forward.coverage.level3', rc3);
  const c2 = cal.value('forward.coverage.level2', rc2);
  const missingP = cal.value('forward.coverage.missing', rc0 + rc1);
  const cc = f?.confidence ?? 0;
  const k = f ? cal.value('forward.conflict', f.conflict) : 0;
  const ta = ctx.tests ? cal.value('tests.asserts_as_stated', ctx.tests.assertsAsStated) : 0;
  const td = ctx.tests ? cal.value('tests.asserts_differently', ctx.tests.assertsDifferently) : 0;
  const xc = Math.max(
    0,
    ...(ctx.tests?.examplesContradicted ?? []).map((x) => cal.value('tests.example_contradicted', x)),
  );
  const contra = Math.max(k, td, xc);

  let status: RequirementVerdict['status'];
  let confidence: number;

  const deferredClaim = claimsAbout(ctx, 'claimsDeferred');
  if (chk !== undefined && chk < t.checkable) {
    status = 'not_checkable';
    confidence = 1 - chk;
    reasons.push(REASONS.notCheckable());
  } else if (deferredClaim && c3 < t.full) {
    status = 'deferred';
    confidence = deferredClaim.claimsDeferred;
    reasons.push(REASONS.deferred(deferredClaim.sentence));
  } else if (!f) {
    status = 'uncertain';
    confidence = 0;
    reasons.push(REASONS.noForward());
  } else if (r.kind === 'non_goal') {
    // A non-goal ("don't change the public API") has nothing to cover: it is broken by a conflict, else respected.
    if (k >= t.contradicted) {
      status = 'contradicted';
      confidence = k;
      reasons.push(REASONS.contradicted(k));
    } else {
      status = 'done';
      confidence = 1 - k;
      reasons.push(REASONS.nonGoalRespected());
    }
  } else if (contra >= t.contradicted) {
    confidence = contra;
    if (amb >= t.ambiguous) {
      status = 'interpretation_mismatch';
      reasons.push(REASONS.interpretationMismatch(contra));
    } else {
      status = 'contradicted';
      reasons.push(REASONS.contradicted(contra));
    }
  } else if (c3 >= t.full && cc >= t.min_confidence) {
    status = 'done';
    confidence = c3;
    reasons.push(REASONS.done(c3));
  } else if (rc2 >= Math.max(rc0, rc1, rc3) && c2 >= t.partial && cc >= t.min_confidence) {
    // "c2 is the largest level" compares the raw distribution; the threshold uses the calibrated value.
    status = 'partial';
    confidence = c2;
    reasons.push(REASONS.partial(c2));
  } else if (missingP >= t.missing) {
    if (!ctx.widened) return { kind: 'need', need: 'widen' };
    if (!ctx.preexisting) return { kind: 'need', need: 'preexisting' };
    const already = cal.value('preexisting.already_implemented', ctx.preexisting.alreadyImplemented);
    if (already >= t.preexisting) {
      status = 'preexisting';
      confidence = already;
      reasons.push(REASONS.preexisting(already));
    } else {
      status = 'missing';
      confidence = missingP;
      reasons.push(REASONS.missing(missingP));
    }
  } else {
    status = 'uncertain';
    confidence = Math.max(c3, missingP, c2, contra);
    reasons.push(REASONS.uncertain());
  }

  // Tested flag.
  let tested: RequirementVerdict['tested'];
  if (!ctx.tests?.hasCandidates) tested = 'unknown';
  else if (ta >= 0.6) tested = 'as_stated';
  else if (td >= t.contradicted) tested = 'differently';
  else tested = 'untested';

  const evidence = evidenceFor(ctx, f?.evidence);
  const testEvidence = evidenceFor(ctx, ctx.tests?.evidence);

  // Dead implementation: done, but the implementing unit is never referenced.
  if (
    status === 'done' &&
    evidence.some((e) =>
      ctx.units.get(e.unitId)?.unit.facts.some((x) => x.kind === 'new_symbol_unreferenced'),
    )
  ) {
    status = 'partial';
    reasons.push(REASONS.deadImplementation());
  }

  // Loosened evidence: the covering test was weakened.
  if (status === 'done') {
    const loosened = testEvidence.some((e) => {
      const u = ctx.units.get(e.unitId);
      const weakFact = u?.unit.facts.some((x) => x.severity === 'high' && TEST_WEAKENING.has(x.kind));
      const lt = u?.reverse?.loosensTest;
      return weakFact || (lt !== undefined && cal.value('reverse.loosens_test', lt) >= t.loosens);
    });
    if (loosened) {
      status = 'uncertain';
      reasons.push(REASONS.loosenedEvidence());
    }
  }

  if (status === 'done' && r.kind === 'behavior' && tested === 'untested') notes.push({ kind: 'untested' });

  const unchecked = (ctx.tests?.examplesChecked ?? []).flatMap((p, i) => (p < 0.5 ? [i] : []));
  if (ctx.tests?.hasCandidates && unchecked.length && (status === 'partial' || status === 'done')) {
    notes.push({ kind: 'examples_not_checked', indexes: unchecked });
    reasons.push(REASONS.exampleNotChecked(unchecked));
  }

  if (amb >= t.ambiguous && status !== 'interpretation_mismatch')
    notes.push({ kind: 'ambiguity', readings: r.openQuestion?.readings ?? [], confidence: amb });

  const verdict: RequirementVerdict = {
    requirementId: r.id,
    status,
    confidence: clamp(confidence),
    calibrated: cal.calibrated,
    tested,
    evidence,
    testEvidence,
    answers,
    reasons,
  };

  const doneClaim = claimsAbout(ctx, 'claimsDone');
  if (doneClaim && (status === 'missing' || status === 'partial' || status === 'contradicted')) {
    verdict.claimMismatch = { sentence: doneClaim.sentence };
    verdict.reasons.push(REASONS.claimMismatch(doneClaim.sentence));
  }

  // Forward and reverse consistency.
  let disagreeingUnit: string | undefined;
  const ev = evidence[0];
  if (ev) {
    const rev = ctx.units.get(ev.unitId)?.reverse;
    if (rev && rev.servesTop === 'none' && cal.value('reverse.plumbing', rev.plumbing) < t.plumbing) {
      verdict.confidence = clamp(verdict.confidence - CONFIDENCE_STEP);
      verdict.reasons.push(REASONS.forwardReverseDisagree());
      disagreeingUnit = ev.unitId;
    }
  }

  return { kind: 'verdict', verdict, notes, ...(disagreeingUnit ? { disagreeingUnit } : {}) };
}
