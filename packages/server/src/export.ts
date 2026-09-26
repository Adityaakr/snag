/**
 * Corpus C exports (BUILD_PROMPT 11.1, M8): reviews whose payloads were retained and that carry human feedback
 * become `remit-shadow-1` records, then eval items split by a stable hash of `repo#pr`. Test-split files added after
 * the M6 freeze are appended to the manifest with `pnpm eval:freeze --append`; existing files are never rewritten.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  itemFileName,
  saveItem,
  type ShadowRecord,
  ShadowRecordSchema,
  shadowItem,
  splitOf,
} from '@remit/eval';
import type { DbStore } from './db/store.js';

export async function shadowRecords(store: DbStore, installationIds?: number[]): Promise<ShadowRecord[]> {
  const rows = await store.exportable(installationIds);
  return rows.map(({ review, input, feedback }) =>
    ShadowRecordSchema.parse({
      format: 'remit-shadow-1',
      reviewId: review.id,
      repo: review.repo,
      prNumber: review.pr,
      baseSha: input.baseSha,
      headSha: input.headSha,
      linkStrength: input.linkStrength,
      issueRefs: input.issueRefs,
      issues: input.issues,
      pr: { title: input.pr.title, body: input.pr.body },
      diffText: input.diffText,
      findings: review.result.findings.map((f) => ({
        id: f.id,
        contentKey: f.contentKey,
        type: f.type,
        priority: f.priority,
        targetId: f.targetId,
      })),
      feedback: feedback.map((f) => ({
        findingId: f.findingId,
        contentKey: f.contentKey,
        label: f.label,
        source: f.source,
        ...(f.reason ? { reason: f.reason } : {}),
      })),
    }),
  );
}

export function toJsonl(records: readonly ShadowRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
}

/** Writes eval items for records that feedback decides; frozen files are left as they are. */
export function writeShadowCorpus(records: readonly ShadowRecord[], corporaRoot: string) {
  const out = { dev: 0, test: 0, undecided: 0, unchanged: 0 };
  for (const r of records) {
    const item = shadowItem(r);
    if (!item) {
      out.undecided++;
      continue;
    }
    const split = splitOf(item.seedId as string);
    if (split === 'test' && existsSync(join(corporaRoot, 'shadow', 'test', itemFileName(item.id)))) {
      out.unchanged++;
      continue;
    }
    saveItem(item, split, corporaRoot);
    out[split]++;
  }
  return out;
}
