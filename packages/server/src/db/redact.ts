/**
 * Data minimization (BUILD_PROMPT 9.9): the review result kept by default has no issue text, quotes, reason text,
 * claim sentences or fact details; ids, verdicts, answers, hashes, paths and line ranges stay.
 */
import type { ReviewResult } from '@remit/core';

export const NOT_RETAINED = '[not retained]';

export function redactResult(r: ReviewResult): ReviewResult {
  const out = structuredClone(r);
  for (const q of out.requirements) {
    q.text = NOT_RETAINED;
    q.quote = NOT_RETAINED;
    q.examples = [];
  }
  const clean = (reasons: { template: string; text: string }[]) => {
    for (const x of reasons) x.text = x.template;
  };
  for (const f of out.findings) clean(f.reasons);
  for (const v of out.requirementVerdicts) {
    clean(v.reasons);
    if (v.claimMismatch) v.claimMismatch.sentence = NOT_RETAINED;
  }
  for (const v of out.unitVerdicts) clean(v.reasons);
  for (const u of out.units) for (const f of u.facts) f.detail = f.kind;
  for (const c of out.claims) c.sentence = NOT_RETAINED;
  return out;
}
