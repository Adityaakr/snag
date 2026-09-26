/**
 * Implicit weak labels (BUILD_PROMPT 10.4): a later commit that changes the evidence lines of a missing or partial
 * finding is a `weak_agree` for that finding. Weak labels are stored apart from human labels (source `implicit`).
 */
import type { ReviewResult } from '@remit/core';
import type { FeedbackRecord } from './store.js';

const overlaps = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1];

export function weakLabels(
  previous: ReviewResult,
  next: ReviewResult,
  meta: { repo: string; pr: number; at: string },
): FeedbackRecord[] {
  if (previous.input.headSha === next.input.headSha) return [];
  const oldHashes = new Set(previous.units.map((u) => u.contentHash));
  const out: FeedbackRecord[] = [];
  for (const f of previous.findings) {
    const status = previous.requirementVerdicts.find((v) => v.requirementId === f.targetId)?.status;
    if (f.type !== 'requirement' || (status !== 'missing' && status !== 'partial')) continue;
    const touched = f.locations.some((loc) =>
      next.units.some(
        (u) =>
          u.file === loc.file &&
          !oldHashes.has(u.contentHash) &&
          u.lines.new.some((r) => overlaps(r, loc.lines)),
      ),
    );
    if (touched)
      out.push({
        repo: meta.repo,
        pr: meta.pr,
        findingId: f.id,
        contentKey: f.contentKey,
        login: 'remit',
        label: 'weak_agree',
        source: 'implicit',
        createdAt: meta.at,
      });
  }
  return out;
}
