import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip, FakeHttp } from '@remit/providers';
import { describe, expect, it } from 'vitest';
import {
  type CorpusARaw,
  corpusAItems,
  instanceRef,
  labelAgentPatch,
  labelCorpusA,
  MAX_PATCH_BYTES,
  parseRq34,
  readCorpusARaw,
  TOOLS,
} from './swebench.js';
import { deriveRq2, fetchCorpusA, HF_ROWS, writeCorpusA, ZENODO_ZIP } from './swebench-fetch.js';

const patch = (f: string) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-a\n+b\n`;
const row = (id: string) => ({
  instance_id: id,
  repo: 'acme/widgets',
  base_commit: '1'.repeat(40),
  patch: patch('widgets/core.py'),
  problem_statement: `Bug in ${id}\nIt should return 0.`,
});

function raw(): CorpusARaw {
  const ids = [
    'acme__widgets-1',
    'acme__widgets-2',
    'acme__widgets-3',
    'acme__widgets-4',
    'acme__widgets-5',
    'acme__widgets-6',
    'acme__widgets-7',
    'acme__widgets-8',
    'acme__widgets-9',
  ];
  const preds = new Map(ids.map((id) => [id, patch('widgets/agent.py')]));
  preds.delete('acme__widgets-8');
  preds.set('acme__widgets-9', 'x'.repeat(MAX_PATCH_BYTES + 1));
  return {
    swebench: ids.map(row),
    rq34: [
      {
        tool: 'OpenHands',
        instance_id: 'acme__widgets-1',
        diff_pattern: 'divergent',
        correctness: 'incorrect_partial',
      },
      {
        tool: 'OpenHands',
        instance_id: 'acme__widgets-2',
        diff_pattern: 'divergent',
        correctness: 'correct_invaliddt',
      },
      {
        tool: 'OpenHands',
        instance_id: 'acme__widgets-3',
        diff_pattern: 'noalignment',
        correctness: 'uncertain',
      },
    ],
    tools: {
      OpenHands: {
        preds,
        resolved: new Set([...ids, 'other__repo-1']),
        rq1: {
          'acme__widgets-4': { difference: 'functionality' },
          'acme__widgets-6': { difference: 'coding_conventions' },
        },
        rq2: {
          'acme__widgets-5': ['t.py::test_x'],
          'acme__widgets-7': [],
          'acme__widgets-8': [],
          'acme__widgets-9': [],
        },
      },
    },
  };
}

describe('corpus A labels (docs/eval.md mapping)', () => {
  it('maps each study outcome to a PR label, source and strength', () => {
    const r = raw();
    const l = (id: string) => labelAgentPatch('OpenHands', id, r);
    expect(l('acme__widgets-1')).toMatchObject({
      label: 'problem',
      source: 'rq34_manual',
      strength: 'strong',
    });
    expect(l('acme__widgets-2')).toMatchObject({ label: 'clean', source: 'rq34_manual', strength: 'strong' });
    expect(l('acme__widgets-3')).toMatchObject({ label: 'problem', source: 'rq34_manual', strength: 'weak' });
    expect(l('acme__widgets-4')).toMatchObject({
      label: 'problem',
      source: 'rq1_devtests',
      strength: 'medium',
    });
    expect(l('acme__widgets-5')).toMatchObject({
      label: 'problem',
      source: 'rq2_divergent',
      strength: 'weak',
    });
    expect(l('acme__widgets-6')).toEqual({ exclude: 'coding_conventions_only' });
    expect(l('acme__widgets-7')).toMatchObject({ label: 'clean', source: 'rq2_no_divergence' });
    expect(labelAgentPatch('CodeStory', 'acme__widgets-1', r)).toEqual({ exclude: 'not_plausible' });
    const openHands = r.tools.OpenHands;
    if (!openHands) throw new Error('fixture has OpenHands');
    const noTests = { ...r, tools: { OpenHands: { ...openHands, rq2: {} } } };
    expect(labelAgentPatch('OpenHands', 'acme__widgets-7', noTests)).toEqual({
      exclude: 'not_tested_by_patchdiff',
    });
  });

  it('labels gold patches clean and counts exclusions', () => {
    const { entries, counts } = labelCorpusA(raw());
    expect(counts.gold).toBe(9);
    expect(
      entries.filter((e) => e.tool === 'gold').every((e) => e.label === 'clean' && e.strength === 'strong'),
    ).toBe(true);
    expect(counts.excluded).toEqual({
      coding_conventions_only: 1,
      empty_patch: 1,
      oversized_patch: 1,
      not_in_swebench_verified: 1,
    });
    expect(counts.problem).toBe(4);
    expect(counts.clean).toBe(9 + 2);
  });

  it('builds review items without the benchmark test patch', () => {
    const { items } = corpusAItems(raw());
    const it1 = items.find((i) => i.id === 'OpenHands:acme__widgets-1');
    expect(it1?.input.diffText).toContain('widgets/agent.py');
    expect(it1?.input.issues[0]?.title).toBe('Bug in acme__widgets-1');
    expect(it1?.input.issues[0]?.body).toBe('It should return 0.');
    expect(it1?.labels.pr).toBe('problem');
    expect(it1?.meta).toMatchObject({
      tool: 'OpenHands',
      source: 'rq34_manual',
      correctness: 'incorrect_partial',
    });
    expect(it1?.seedId).toBe('acme__widgets-1');
    expect(instanceRef('django__django-17087', 'django/django')).toEqual({
      owner: 'django',
      repo: 'django',
      number: 17087,
    });
  });

  it('parses RQ34.csv strictly', () => {
    expect(
      parseRq34('tool,instance_id,diff_pattern,correctness\nCodeStory,a__b-1,absent,uncertain\n'),
    ).toHaveLength(1);
    expect(() => parseRq34('a,b\n')).toThrow(/header/);
    expect(() => parseRq34('tool,instance_id,diff_pattern,correctness\nNope,a,b,c\n')).toThrow(/bad row/);
  });
});

describe('fetchCorpusA', () => {
  it('fetches rows and archive entries through the HTTP provider, derives RQ2, and builds split items', async () => {
    const ids = ['acme__widgets-1', 'acme__widgets-2'];
    const zipFiles: Record<string, string> = {
      'PatchDiff/results/RQ34.csv':
        'tool,instance_id,diff_pattern,correctness\nOpenHands,acme__widgets-1,divergent,incorrect_partial\n',
    };
    for (const [tool, dir] of Object.entries(TOOLS)) {
      zipFiles[`PatchDiff/data/tool_results/${dir}/all_preds.jsonl`] = ids
        .map((id) =>
          JSON.stringify({ instance_id: id, model_name_or_patch: 'x', model_patch: patch('a.py') }),
        )
        .join('\n');
      zipFiles[`PatchDiff/data/tool_results/${dir}/results.json`] = JSON.stringify({ resolved: ids });
      zipFiles[`PatchDiff/results/RQ1_${tool}_runall.json`] = '{}';
      zipFiles[`PatchDiff/results/RQ2_${tool}_difftests.json`] = JSON.stringify({
        'acme__widgets-2': [
          { idx: 1, differential_tests: [] },
          { idx: 2, differential_tests: ['t::a', 't::a'] },
        ],
      });
    }
    const page = (offset: number, rows: unknown[]) => [
      `${HF_ROWS}&offset=${offset}&length=100`,
      JSON.stringify({ rows: rows.map((r) => ({ row: r })), num_rows_total: 2 }),
    ];
    const http = new FakeHttp({
      ...Object.fromEntries([
        page(
          0,
          ids.map((id) => ({ ...row(id), difficulty: 'easy' })),
        ),
      ]),
      [ZENODO_ZIP]: buildZip(zipFiles),
    });
    const dir = mkdtempSync(join(tmpdir(), 'remit-corpus-a-'));
    const rawDir = join(dir, 'raw');
    const hashes = await fetchCorpusA(http, rawDir);
    expect(Object.keys(hashes)).toContain('patchdiff/derived/RQ2_CodeStory_divergent.json');
    const first = JSON.parse(
      readFileSync(join(rawDir, 'swebench_verified.jsonl'), 'utf8').split('\n')[0] as string,
    );
    expect(Object.keys(first).sort()).toEqual([
      'base_commit',
      'instance_id',
      'patch',
      'problem_statement',
      'repo',
    ]);
    const loaded = readCorpusARaw(rawDir);
    expect(loaded.tools.OpenHands?.rq2['acme__widgets-2']).toEqual(['t::a']);
    const out = writeCorpusA(rawDir, join(dir, 'corpora'));
    expect(out.counts.problem).toBe(3 + 1);
    // 2 gold, OpenHands:1 (manual), and :2 for each tool (divergent); CodeStory:1 and LearnByInteract:1 were never tested.
    expect(out.counts.excluded).toEqual({ not_tested_by_patchdiff: 2 });
    expect(out.perSplit.dev + out.perSplit.test).toBe(2 + 4);
    const files = ['dev', 'test'].flatMap((s) => {
      try {
        return readdirSync(join(dir, 'corpora', 'swebench', s));
      } catch {
        return [];
      }
    });
    expect(files).toHaveLength(6);
  });

  it('dedupes differentiating tests per instance', () => {
    expect(
      deriveRq2('{"a":[{"differential_tests":["y","x"]},{"differential_tests":["x"]}],"b":[{}]}'),
    ).toEqual({ a: ['x', 'y'], b: [] });
  });
});
