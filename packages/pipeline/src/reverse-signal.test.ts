import { describe, expect, it } from 'vitest';
import { reverseSignal } from './review.js';

const serves = (probabilities: Record<string, number>) => {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';
  return { type: 'choice' as const, choice, confidence: 0.3, probabilities };
};

describe('reverseSignal', () => {
  it('a unit implementing several requirements serves the requested work with P = 1 - P(none)', () => {
    // client/retry.py in py-retry-backoff: one hunk implements R1, R3 and R4; the single-choice answer splits.
    const s = reverseSignal({
      serves: serves({ R1: 0.05, R2: 0.02, R3: 0.45, R4: 0.45, none: 0.03 }),
      plumbing: { type: 'noul', noul: 0.05 },
      behavior_change: { type: 'noul', noul: 0.97 },
    } as never);
    expect(s.servesRequirementProbability).toBeCloseTo(0.97, 10);
    expect(['R3', 'R4']).toContain(s.servesRequirementId);
    expect(s.servesTop).not.toBe('none');
  });

  it('a unit that serves nothing keeps a low probability', () => {
    const s = reverseSignal({
      serves: serves({ R1: 0.05, R2: 0.05, none: 0.9 }),
      plumbing: { type: 'noul', noul: 0.1 },
      behavior_change: { type: 'noul', noul: 0.9 },
    } as never);
    expect(s.servesRequirementProbability).toBeCloseTo(0.1, 10);
    expect(s.servesTop).toBe('none');
  });
});
