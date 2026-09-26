/**
 * Data minimization (BUILD_PROMPT 9.9): the review result kept by default has no code (unit patches, judge views,
 * before and after text, test titles), no issue text, quotes, reason text, claim sentences or fact details; ids, verdicts, answers, hashes, paths and line ranges stay.
 */
import type { ReviewResult } from '@remit/core';

export const NOT_RETAINED = '[not retained]';

export function redactResult(r: ReviewResult): ReviewResult {
  const out = structuredClone(r);
  for (const q of out.requirements) {
    q.text = NOT_RETAINED;
    q.quote = NOT_RETAINED;
    q.examples = [];
    // Readings are short rewordings of the issue, so they count as issue text.
    if (q.openQuestion) q.openQuestion.readings = q.openQuestion.readings.map(() => NOT_RETAINED);
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
  for (const u of out.units) {
    // Code never stays by default: patches, judge views and before/after text are dropped.
    u.patch = '';
    u.judgeView = '';
    delete u.before;
    delete u.after;
    if (u.testTitles) u.testTitles = u.testTitles.map(() => NOT_RETAINED);
    for (const f of u.facts) f.detail = f.kind;
  }
  for (const c of out.claims) c.sentence = NOT_RETAINED;
  return out;
}
