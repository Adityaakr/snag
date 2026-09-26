/**
 * Check run model (BUILD_PROMPT 6.10, 6.9): name from BRAND, a title like "2 of 3 requirements done, 1 missing",
 * the comment markdown as summary, and annotations on unit lines batched 50 per request.
 */
import { BRAND } from '../brand.js';
import type { Finding, ReviewResult } from '../contracts/index.js';
import { renderComment } from './markdown.js';
import { plain } from './sanitize.js';

export const ANNOTATION_BATCH = 50;

export interface Annotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  title: string;
  message: string;
}

export interface CheckRunModel {
  name: string;
  conclusion: 'neutral' | 'success' | 'failure';
  title: string;
  summary: string;
  /** Annotation batches, at most 50 each (the API limit per request). */
  annotationBatches: Annotation[][];
}

/** "2 of 3 requirements done, 1 missing, 1 contradicted" or a neutral phrase when nothing was checked. */
export function checkTitle(r: ReviewResult): string {
  const total = r.requirementVerdicts.length;
  if (!r.input.issues.length) return 'No linked issue; intent not checked';
  if (!total) return 'No checkable requirements found';
  const c = r.summary.counts;
  const parts = [`${c.done ?? 0} of ${total} requirement${total === 1 ? '' : 's'} done`];
  for (const [key, word] of [
    ['missing', 'missing'],
    ['contradicted', 'contradicted'],
    ['partial', 'partial'],
    ['interpretation_mismatch', 'unclear'],
    ['uncertain', 'uncertain'],
    ['not_checkable', 'to check by hand'],
    ['deferred', 'deferred'],
    ['preexisting', 'already there'],
  ] as const) {
    if (c[key]) parts.push(`${c[key]} ${word}`);
  }
  return parts.join(', ');
}

/** Check conclusion per mode (6.9): comment_only and rework are neutral; gate fails only when it may. */
export function checkConclusion(r: ReviewResult): CheckRunModel['conclusion'] {
  if (r.summary.mode !== 'gate') return 'neutral';
  if (r.summary.gateDecision === 'fail') return 'failure';
  if (r.summary.gateDecision === 'pass') return 'success';
  return 'neutral';
}

const LEVEL: Record<Finding['priority'], Annotation['annotation_level']> = {
  P0: 'warning',
  P1: 'warning',
  P2: 'notice',
};

/** Annotations on unit lines for unit, test integrity and fact findings (requirements are in the summary). */
export function annotations(r: ReviewResult): Annotation[] {
  return r.findings
    .filter((f) => f.type === 'unit' || f.type === 'test_integrity' || f.type === 'fact')
    .flatMap((f) =>
      f.locations
        .filter((l) => l.lines[0] > 0)
        .slice(0, 1)
        .map((l) => ({
          path: l.file,
          start_line: l.lines[0],
          end_line: Math.max(l.lines[0], l.lines[1]),
          annotation_level:
            r.summary.gateDecision === 'fail' && f.priority === 'P0'
              ? ('failure' as const)
              : LEVEL[f.priority],
          title: `${BRAND.name} ${f.id}`,
          message: plain(f.reasons.map((x) => x.text).join(' '), 600),
        })),
    );
}

export function checkRun(r: ReviewResult, reviewId: string): CheckRunModel {
  const all = annotations(r);
  const annotationBatches: Annotation[][] = [];
  for (let i = 0; i < all.length; i += ANNOTATION_BATCH)
    annotationBatches.push(all.slice(i, i + ANNOTATION_BATCH));
  return {
    name: BRAND.checkName,
    conclusion: checkConclusion(r),
    title: checkTitle(r),
    summary: renderComment(r, { reviewId }),
    annotationBatches,
  };
}
