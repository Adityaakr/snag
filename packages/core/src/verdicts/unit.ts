/**
 * Unit rules and test integrity (BUILD_PROMPT 6.7). First match wins.
 */
import type { ChangeUnit, UnitVerdict } from '../contracts/index.js';
import type { Thresholds } from '../config/schema.js';
import type { Calibrator } from './calibration.js';
import { type Reason, REASONS } from './reasons.js';
import { type ReverseSignal, TEST_WEAKENING } from './requirement.js';

export interface UnitOutcome {
  verdict: UnitVerdict;
  /** Confidence behind the role, for findings. */
  confidence: number;
  /** Present when the unit is a test with a loosened assertion (model or fact). */
  integrity?: { loosened: number; factIds: string[]; confidence: number };
}

const inBand = (x: number) => x >= 0.4 && x <= 0.6;

export function unitVerdict(
  unit: ChangeUnit,
  reverse: ReverseSignal | undefined,
  t: Thresholds,
  cal: Calibrator,
): UnitOutcome {
  const reasons: Reason[] = [];
  const answers = reverse?.answers ?? [];
  const weakFacts =
    unit.kind === 'test' ? unit.facts.filter((f) => f.severity === 'high' && TEST_WEAKENING.has(f.kind)) : [];
  const loosens =
    reverse?.loosensTest !== undefined ? cal.value('reverse.loosens_test', reverse.loosensTest) : 0;
  const integrity =
    unit.kind === 'test' && (loosens >= t.loosens || weakFacts.length)
      ? { loosened: loosens, factIds: weakFacts.map((f) => f.id), confidence: weakFacts.length ? 1 : loosens }
      : undefined;
  if (integrity) {
    for (const f of weakFacts) reasons.push(REASONS.testLoosened(f.detail));
    if (!weakFacts.length) reasons.push(REASONS.testLoosenedModel(loosens));
  }
  const done = (
    role: UnitVerdict['role'],
    confidence: number,
    extra: Partial<UnitVerdict> = {},
  ): UnitOutcome => {
    const verdict: UnitVerdict = { unitId: unit.id, role, answers, reasons, ...extra };
    if (integrity) verdict.testIntegrity = { loosened: integrity.loosened, factIds: integrity.factIds };
    return { verdict, confidence, ...(integrity ? { integrity } : {}) };
  };

  if (unit.filtered) {
    reasons.unshift(REASONS.unitIgnored(unit.filtered));
    return done('ignored', 1);
  }
  if (!reverse) {
    reasons.unshift(REASONS.unitNoAnswers());
    return done('uncertain', 0);
  }
  const serves = cal.value('reverse.serves', reverse.servesRequirementProbability);
  const plumbing = cal.value('reverse.plumbing', reverse.plumbing);
  const behavior = cal.value('reverse.behavior_change', reverse.behaviorChange);
  const runtime =
    reverse.runtimeSetting !== undefined ? cal.value('reverse.runtime_setting', reverse.runtimeSetting) : 0;

  if (reverse.servesTop !== 'none' && reverse.servesRequirementId && serves >= t.serves) {
    reasons.unshift(REASONS.unitImplements(reverse.servesRequirementId));
    return done('implements', serves, { servesRequirementId: reverse.servesRequirementId });
  }
  if (plumbing >= t.plumbing) {
    reasons.unshift(REASONS.unitSupporting());
    return done('supporting', plumbing);
  }
  if (behavior >= t.behavior || runtime >= t.behavior) {
    reasons.unshift(
      runtime >= t.behavior && runtime >= behavior
        ? REASONS.unitRuntimeSetting(runtime)
        : REASONS.unitBehavioral(behavior),
    );
    return done('unexplained_behavioral', Math.max(behavior, runtime));
  }
  if (inBand(serves) && inBand(behavior)) {
    reasons.unshift(REASONS.unitUncertain());
    return done('uncertain', Math.max(serves, behavior));
  }
  reasons.unshift(REASONS.unitBenign());
  return done('unexplained_benign', 1 - behavior);
}
