/**
 * Checks the fetched corpus A raw files against the study's published totals (docs/eval-corpus-a.md). Runs only
 * after `pnpm eval:fetch-a`; the raw files are gitignored.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORPORA_ROOT } from './files.js';
import { labelCorpusA, readCorpusARaw, TOOL_NAMES } from './swebench.js';

const rawDir = join(CORPORA_ROOT, 'swebench', 'raw');

describe.skipIf(!existsSync(join(rawDir, 'swebench_verified.jsonl')))('corpus A raw data', () => {
  it('matches the PatchDiff paper totals', () => {
    const raw = readCorpusARaw(rawDir);
    expect(raw.swebench).toHaveLength(500);
    const resolved = TOOL_NAMES.map((t) => raw.tools[t]?.resolved.size);
    expect(resolved).toEqual([265, 311, 301]);
    const divergent = TOOL_NAMES.map(
      (t) => Object.values(raw.tools[t]?.rq2 ?? {}).filter((x) => x.length).length,
    );
    expect(divergent).toEqual([72, 91, 97]);
    const functionality = TOOL_NAMES.map(
      (t) => Object.values(raw.tools[t]?.rq1 ?? {}).filter((x) => x.difference === 'functionality').length,
    );
    expect(functionality).toEqual([19, 26, 23]);
    expect(raw.rq34).toHaveLength(77);
    expect(raw.rq34.filter((r) => r.correctness.startsWith('incorrect_'))).toHaveLength(22);
    expect(raw.rq34.filter((r) => r.correctness.startsWith('correct_'))).toHaveLength(4);
    expect(raw.rq34.filter((r) => r.correctness === 'uncertain')).toHaveLength(51);
    const { counts } = labelCorpusA(raw);
    const excluded = Object.values(counts.excluded).reduce((a, b) => a + b, 0);
    expect(counts.problem + counts.clean - counts.gold + excluded).toBe(877);
  });
});
