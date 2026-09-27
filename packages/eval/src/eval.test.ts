import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bins, brier, ece, fitCalibration, isotonic, MIN_SAMPLES, type Pair } from './calibration.js';
import { goldenItems } from './corpora/golden.js';
import { loadCorpus, saveItem } from './corpora/files.js';
import { computeMetrics } from './metrics.js';
import { renderReportHtml, renderReportMarkdown, summaryLine, worstItems, writeReport } from './report.js';
import { failureWarnings, runItem, runItems } from './runner.js';

describe('golden corpus (corpus D)', () => {
  it('loads all 18 scenarios with labels and scripts, and every one passes', async () => {
    const items = goldenItems();
    expect(items).toHaveLength(18);
    const { outcomes } = await runItems(items, { mode: 'scripted' });
    expect(
      outcomes.filter((o) => !o.comparison.passed).map((o) => [o.item.id, o.comparison.goldenFailures]),
    ).toEqual([]);
    const m = computeMetrics(outcomes);
    expect(m.passed).toBe(18);
    expect(m.requirement.f1).toBe(1);
    expect(m.p0Precision.value).toBe(1);
  });

  it('stops for budget on spend charged outside the per-item trackers (live providers)', async () => {
    const items = goldenItems();
    let external = 0;
    const { outcomes, stoppedForBudget } = await runItems(items, {
      mode: 'scripted',
      concurrency: 2,
      maxUsd: 1,
      spentUsd: () => {
        external += 0.4;
        return external;
      },
    });
    // Checks happen before each batch of 2: 0.4 and 0.8 pass, 1.2 stops.
    expect(outcomes).toHaveLength(4);
    expect(stoppedForBudget).toBe(true);
  });

  it('marks reviews with provider or budget failures as incomplete, and ordinary notes as complete', async () => {
    const [item] = goldenItems();
    if (!item) throw new Error('no golden items');
    const out = await runItem(item, { mode: 'scripted' });
    expect(out.incomplete).toBeUndefined();
    const warnings = [
      'forward R1: openai_compatible: budget of $0.50 reached ($0.51 spent); stopping further calls',
      'Budget reached: openai_compatible: budget of $0.50 reached',
      'reverse U2: jev: circuit open after 5 consecutive failures; failing fast',
      'This PR edits .remit.yml; the change applies after it is merged into the default branch.',
    ];
    expect(failureWarnings({ ...out.result, warnings })).toHaveLength(3);
  });

  it('labels PRs with expected problems, including high-severity facts, as problem', () => {
    const byId = Object.fromEntries(goldenItems().map((i) => [i.id, i.labels.pr]));
    expect(byId['golden/three_reqs_one_missing']).toBe('problem');
    expect(byId['golden/python_detectors']).toBe('problem');
    expect(byId['golden/supporting_changes']).toBe('clean');
  });
});

describe('simulated mode', () => {
  it('runs without scripts for Jev and is never called a real measurement', async () => {
    const item = goldenItems().find((i) => i.id === 'golden/misread_self_consistent');
    if (!item) throw new Error('missing');
    const o = await runItem(item, { mode: 'simulated' });
    expect(o.result.requirementVerdicts).toHaveLength(1);
    const md = renderReportMarkdown(
      {
        corpus: 'golden',
        split: 'all',
        mode: 'simulated',
        gitSha: 'abc',
        startedAt: 't',
        jevModel: 'simulated-jev',
      },
      computeMetrics([o]),
      [o],
    );
    expect(md).toContain('Not a real measurement');
  });
});

describe('calibration (11.5)', () => {
  it('fits a non-decreasing isotonic map', () => {
    const pairs: Pair[] = [
      { p: 0.1, y: 0 },
      { p: 0.2, y: 1 },
      { p: 0.3, y: 0 },
      { p: 0.8, y: 1 },
      { p: 0.9, y: 1 },
    ];
    const pts = isotonic(pairs);
    for (let i = 1; i < pts.length; i++) expect((pts[i]?.y ?? 0) >= (pts[i - 1]?.y ?? 0)).toBe(true);
    expect(pts[pts.length - 1]?.y).toBe(1);
  });

  it('computes ECE, Brier and ten bins', () => {
    const perfect: Pair[] = [
      { p: 0, y: 0 },
      { p: 1, y: 1 },
    ];
    expect(ece(perfect)).toBe(0);
    expect(brier(perfect)).toBe(0);
    expect(brier([{ p: 1, y: 0 }])).toBe(1);
    expect(bins(perfect)).toHaveLength(10);
    expect(ece([])).toBe(0);
  });

  it('keeps identity below 50 samples and improves ECE above', () => {
    const few = Array.from({ length: MIN_SAMPLES - 1 }, (_, i) => ({ p: 0.9, y: (i % 2) as 0 | 1 }));
    const many = Array.from({ length: 200 }, (_, i) => ({ p: 0.9, y: (i % 2) as 0 | 1 }));
    const { calibration, fits } = fitCalibration(
      { few, many },
      { id: 'c', jevModel: 'jev-1.13.0', questionSet: 'qs-0.1.0', labeledFindings: 0, p0Precision: 0 },
    );
    expect(fits.few?.identity).toBe(true);
    expect(calibration.maps.few).toBeUndefined();
    expect(fits.many?.identity).toBe(false);
    expect(fits.many?.eceAfter).toBeLessThan(fits.many?.eceBefore ?? 1);
  });
});

describe('reports (11.9) and stored corpora', () => {
  it('writes markdown, HTML with Satoshi and reliability diagrams, metrics and dumps', async () => {
    const items = goldenItems().slice(0, 3);
    const { outcomes } = await runItems(items, { mode: 'scripted' });
    const m = computeMetrics(outcomes);
    const root = mkdtempSync(join(tmpdir(), 'remit-report-'));
    try {
      const info = {
        corpus: 'golden',
        split: 'all',
        mode: 'scripted' as const,
        gitSha: 'abcdef123456',
        startedAt: '2026-09-26T00:00:00.000Z',
        jevModel: 'jev-1.13.0',
      };
      const dir = writeReport(root, info, m, outcomes);
      const html = readFileSync(join(dir, 'report.html'), 'utf8');
      expect(html).toContain('api.fontshare.com/v2/css?f[]=satoshi');
      expect(html).toContain('<table>');
      expect(readFileSync(join(dir, 'report.md'), 'utf8')).toContain('## Summary');
      expect(JSON.parse(readFileSync(join(dir, 'metrics.json'), 'utf8')).realMeasurement).toBe(false);
      expect(summaryLine(info, m, 'eval/reports/x')).toMatch(
        /golden\/all scripted \(not a real measurement\): 3\/3 items correct/,
      );
      expect(
        renderReportHtml(
          info,
          {
            ...m,
            calibration: {
              k: {
                n: 2,
                ece: 0,
                eceCalibrated: null,
                brier: 0,
                bins: [{ lo: 0.9, hi: 1, n: 2, meanP: 0.95, accuracy: 1 }],
              },
            },
          },
          outcomes,
        ),
      ).toContain('Reliability diagram for k');
      expect(worstItems(outcomes)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('saves and loads items per corpus and split', () => {
    const root = mkdtempSync(join(tmpdir(), 'remit-corpus-'));
    try {
      const item = {
        ...(goldenItems()[0] as ReturnType<typeof goldenItems>[number]),
        corpus: 'mutations' as const,
        id: 'mutations/seed-a/drop_requirement:R1',
      };
      saveItem(item, 'dev', root);
      const loaded = loadCorpus('mutations', 'dev', root);
      expect(loaded.map((i) => i.id)).toEqual([item.id]);
      expect(loaded[0]?.config.mode).toBe('comment_only');
      expect(loadCorpus('mutations', 'test', root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
