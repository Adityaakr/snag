/**
 * Corpus C `shadow` (BUILD_PROMPT 11.1, M8): real reviews with human feedback. This file defines the export format;
 * M8 writes records from the `reviews`, `findings` and `feedback` tables. Only reviews whose payloads were retained
 * (issue snapshots and the diff) can be replayed, so only those are exported.
 */
import { ConfigSchema, IssueSnapshotSchema, IssueRefSchema } from '@remit/core';
import { z } from 'zod';
import type { EvalItem } from '../item.js';

export const FEEDBACK_LABELS = ['agree', 'disagree', 'weak_agree', 'weak_disagree'] as const;

export const ShadowRecordSchema = z
  .object({
    format: z.literal('remit-shadow-1'),
    reviewId: z.string(),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    prNumber: z.number().int().positive(),
    baseSha: z.string(),
    headSha: z.string(),
    linkStrength: z.enum(['closing', 'weak', 'none']),
    issueRefs: z.array(IssueRefSchema),
    issues: z.array(IssueSnapshotSchema),
    pr: z.object({ title: z.string(), body: z.string() }),
    diffText: z.string(),
    /** The findings as reviewed, keyed for feedback by content key (stable across re-runs, section 5). */
    findings: z.array(
      z.object({
        id: z.string(),
        contentKey: z.string(),
        type: z.string(),
        priority: z.string(),
        targetId: z.string(),
      }),
    ),
    feedback: z.array(
      z.object({
        findingId: z.string(),
        contentKey: z.string(),
        label: z.enum(FEEDBACK_LABELS),
        source: z.enum(['slash', 'dashboard', 'implicit']),
        reason: z.string().optional(),
      }),
    ),
    /** The repository config in effect for the review. */
    config: z.unknown().optional(),
  })
  .strict();
export type ShadowRecord = z.infer<typeof ShadowRecordSchema>;

/**
 * PR label from strong feedback only (weak labels are kept separate, 10.4): a problem when a human agreed with any
 * P0 or P1 finding; clean when every P0 and P1 finding was disagreed with. Otherwise the record has no PR label.
 */
export function shadowPrLabel(r: ShadowRecord): 'problem' | 'clean' | null {
  const strong = new Map(
    r.feedback
      .filter((f) => f.label === 'agree' || f.label === 'disagree')
      .map((f) => [f.contentKey, f.label]),
  );
  const serious = r.findings.filter((f) => f.priority === 'P0' || f.priority === 'P1');
  if (serious.some((f) => strong.get(f.contentKey) === 'agree')) return 'problem';
  if (serious.length && serious.every((f) => strong.get(f.contentKey) === 'disagree')) return 'clean';
  if (
    !serious.length &&
    r.findings.length &&
    r.findings.every((f) => strong.get(f.contentKey) === 'disagree')
  )
    return 'clean';
  return null;
}

/** An eval item from a shadow record, or null when feedback does not decide the PR label. */
export function shadowItem(r: ShadowRecord): EvalItem | null {
  const record = ShadowRecordSchema.parse(r);
  const pr = shadowPrLabel(record);
  if (!pr) return null;
  const feedback = Object.fromEntries(record.feedback.map((f) => [f.contentKey, f.label]));
  return {
    id: `${record.repo}#${record.prNumber}@${record.headSha.slice(0, 12)}`,
    corpus: 'shadow',
    seedId: `${record.repo}#${record.prNumber}`,
    input: {
      mode: 'github',
      repo: record.repo,
      prNumber: record.prNumber,
      baseSha: record.baseSha,
      headSha: record.headSha,
      linkStrength: record.linkStrength,
      issueRefs: record.issueRefs,
      issues: record.issues,
      pr: record.pr,
      diffText: record.diffText,
    },
    config: ConfigSchema.parse(record.config ?? {}),
    labels: {
      requirements: {},
      requirementsAccept: {},
      units: [],
      facts: [],
      testIntegrity: [],
      claimMismatch: [],
      pr,
      feedback,
    },
    annotatedBy: 'human',
  };
}
