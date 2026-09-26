import type { ReviewResult } from '@remit/core';
import { describe, expect, it } from 'vitest';
import { weakLabels } from './weak-labels.js';

function result(
  head: string,
  opts: { status: string; unitHash: string; lines?: [number, number] },
): ReviewResult {
  return {
    input: { headSha: head },
    findings: [
      {
        id: 'F-R1',
        type: 'requirement',
        targetId: 'R1',
        contentKey: 'k1',
        locations: [{ file: 'src/a.ts', lines: [10, 12] }],
      },
    ],
    requirementVerdicts: [{ requirementId: 'R1', status: opts.status }],
    units: [
      { file: 'src/a.ts', contentHash: opts.unitHash, lines: { new: [opts.lines ?? [9, 14]], old: [] } },
    ],
  } as unknown as ReviewResult;
}

describe('implicit weak labels', () => {
  const meta = { repo: 'a/r', pr: 1, at: '2026-09-27T00:00:00Z' };
  it('labels a partial finding weak_agree when a later commit changes its evidence lines', () => {
    expect(
      weakLabels(
        result('h1', { status: 'partial', unitHash: 'u1' }),
        result('h2', { status: 'done', unitHash: 'u2' }),
        meta,
      ),
    ).toEqual([
      {
        repo: 'a/r',
        pr: 1,
        findingId: 'F-R1',
        contentKey: 'k1',
        login: 'remit',
        label: 'weak_agree',
        source: 'implicit',
        createdAt: meta.at,
      },
    ]);
  });
  it('ignores unchanged evidence, other lines, done findings and the same head', () => {
    expect(
      weakLabels(
        result('h1', { status: 'partial', unitHash: 'u1' }),
        result('h2', { status: 'partial', unitHash: 'u1' }),
        meta,
      ),
    ).toEqual([]);
    expect(
      weakLabels(
        result('h1', { status: 'partial', unitHash: 'u1' }),
        result('h2', { status: 'partial', unitHash: 'u2', lines: [40, 50] }),
        meta,
      ),
    ).toEqual([]);
    expect(
      weakLabels(
        result('h1', { status: 'done', unitHash: 'u1' }),
        result('h2', { status: 'done', unitHash: 'u2' }),
        meta,
      ),
    ).toEqual([]);
    expect(
      weakLabels(
        result('h1', { status: 'missing', unitHash: 'u1' }),
        result('h1', { status: 'missing', unitHash: 'u2' }),
        meta,
      ),
    ).toEqual([]);
  });
});
