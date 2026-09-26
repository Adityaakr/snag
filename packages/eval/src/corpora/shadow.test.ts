import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../metrics.js';
import { SEEDS_ROOT, seedItems } from '../mutations/generate.js';
import { loadSeed } from '../mutations/seed.js';
import { runItems } from '../runner.js';
import { type ShadowRecord, ShadowRecordSchema, shadowItem, shadowPrLabel } from './shadow.js';

async function record(): Promise<ShadowRecord> {
  const [clean] = await seedItems(loadSeed(join(SEEDS_ROOT, 'ts-job-intervals')));
  if (!clean) throw new Error('no item');
  return {
    format: 'remit-shadow-1',
    reviewId: 'rev_1',
    repo: 'acme/scheduler',
    prNumber: 7,
    baseSha: clean.input.baseSha,
    headSha: 'abcdef1234567890',
    linkStrength: 'closing',
    issueRefs: clean.input.issueRefs,
    issues: clean.input.issues,
    pr: clean.input.pr,
    diffText: clean.input.diffText,
    findings: [
      { id: 'F-R1', contentKey: 'k1', type: 'requirement', priority: 'P0', targetId: 'R1' },
      { id: 'F-U2', contentKey: 'k2', type: 'unit', priority: 'P2', targetId: 'U2' },
    ],
    feedback: [{ findingId: 'F-R1', contentKey: 'k1', label: 'disagree', source: 'dashboard' }],
  };
}

describe('corpus C export format', () => {
  it('derives PR labels from strong feedback only', async () => {
    const r = await record();
    const [fb] = r.feedback;
    const [, minor] = r.findings;
    if (!fb || !minor) throw new Error('fixture');
    expect(shadowPrLabel(r)).toBe('clean');
    expect(shadowPrLabel({ ...r, feedback: [{ ...fb, label: 'agree' }] })).toBe('problem');
    expect(
      shadowPrLabel({ ...r, feedback: [{ ...fb, label: 'weak_agree', source: 'implicit' }] }),
    ).toBeNull();
    expect(
      shadowPrLabel({
        ...r,
        findings: [minor],
        feedback: [{ findingId: 'F-U2', contentKey: 'k2', label: 'disagree', source: 'slash' }],
      }),
    ).toBe('clean');
    expect(shadowPrLabel({ ...r, findings: [], feedback: [] })).toBeNull();
    expect(() => ShadowRecordSchema.parse({ ...r, format: 'other' })).toThrow();
  });

  it('turns a record into a replayable item and counts feedback on replay', async () => {
    const item = shadowItem(await record());
    expect(item?.id).toBe('acme/scheduler#7@abcdef123456');
    expect(item?.labels.pr).toBe('clean');
    expect(shadowItem({ ...(await record()), feedback: [] })).toBeNull();
    if (!item) throw new Error('item');
    const first = await runItems([item], { mode: 'simulated' });
    const keys = (first.outcomes[0]?.result.findings ?? []).map((f) => f.contentKey);
    const labeled = {
      ...item,
      labels: {
        ...item.labels,
        feedback: Object.fromEntries(keys.map((k, i) => [k, i % 2 ? 'weak_agree' : 'agree'] as const)),
      },
    };
    const m = computeMetrics((await runItems([labeled], { mode: 'simulated' })).outcomes);
    expect(m.feedback.agree + m.feedback.weakAgree).toBe(keys.length);
    expect(m.feedback.agreement).toBe(keys.length ? 1 : null);
  });
});
