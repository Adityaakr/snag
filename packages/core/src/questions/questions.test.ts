import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Requirement } from '../contracts/index.js';
import { estimateTokens } from '../tokens.js';
import { claimsQuestions, claimsState } from './claims.js';
import { forwardQuestions, forwardState } from './forward.js';
import { preexistingQuestions, preexistingState } from './preexisting.js';
import { rerankBatches } from './rerank.js';
import { reverseQuestions, reverseState } from './reverse.js';
import { testsQuestions, testsState } from './tests.js';
import type { Question } from './types.js';

const spec = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'BUILD_PROMPT.md'), 'utf8');
function section(title: string): string {
  const start = spec.indexOf(title);
  expect(start, title).toBeGreaterThan(-1);
  return spec.slice(start, spec.indexOf('\n### ', start + 5));
}

/** Every instruction, criterion and level of a question must appear verbatim in its Appendix C section. */
function expectVerbatim(sec: string, qs: Record<string, Question>, skip: string[] = []) {
  for (const [id, q] of Object.entries(qs)) {
    if (skip.includes(id)) continue;
    const instructions = q.instructions.replace(/\[\d+\]/g, '[{i}]');
    expect(sec, `${id} instructions`).toContain(instructions);
    if (q.type === 'noul' && q.criteria) {
      expect(sec, `${id} true`).toContain(q.criteria.true);
      expect(sec, `${id} false`).toContain(q.criteria.false);
    }
    if (q.type === 'score') for (const level of q.criteria) expect(sec, `${id} level`).toContain(level);
  }
}

const req: Requirement = {
  id: 'R1',
  issue: { owner: 'a', repo: 'b', number: 1 },
  text: 'GET /users/:id returns 404 for unknown ids.',
  quote: 'returns 404 for unknown ids',
  source: { kind: 'body' },
  kind: 'behavior',
  explicitness: 'explicit',
  priority: 'must',
  examples: [
    { input: '/users/999', expected: '404', quote: 'x' },
    { input: '/users/abc', expected: '404', quote: 'y' },
  ],
  checkableInCode: true,
};

describe('question sets qs-0.1.0 match Appendix C', () => {
  it('forward.v0 (C.2)', () => {
    const sec = section('### C.2 `forward.v0`');
    const qs = forwardQuestions([{ id: 'U4', file: 'src/api/users.ts', symbol: 'getUser' }]);
    expectVerbatim(sec, qs);
    expect(Object.keys(qs)).toEqual(['coverage', 'conflict', 'evidence']);
    expect(qs.evidence.criteria).toEqual({
      U4: '`candidates` entry U4 (src/api/users.ts, getUser)',
      none: 'No entry in `candidates` implements any part of `requirement.text`.',
    });
    expect(sec).toContain('`` `candidates` entry {id} ({file}, {symbol}) ``');
    const state = forwardState(req, [
      { id: 'U4', file: 'src/api/users.ts', symbol: 'getUser', change: '+ return 404', after: 'code' },
    ]);
    expect(Object.keys(state)).toEqual(['requirement', 'candidates']);
    expect(state.requirement.examples).toEqual([
      { input: '/users/999', expected: '404' },
      { input: '/users/abc', expected: '404' },
    ]);
  });

  it('tests.v0 (C.3) with example questions and no implementation code in state', () => {
    const sec = section('### C.3 `tests.v0`');
    const qs = testsQuestions([{ id: 'U9', file: 'test/users.test.ts' }], 7);
    expectVerbatim(sec, qs as Record<string, Question>);
    expect(Object.keys(qs)).toEqual([
      'asserts_as_stated',
      'asserts_differently',
      'test_evidence',
      ...[0, 1, 2, 3, 4].flatMap((i) => [`example_${i}_checked`, `example_${i}_contradicted`]),
    ]);
    expect((qs.test_evidence as { criteria: Record<string, string> }).criteria.none).toBe(
      'No entry in `tests` checks it.',
    );
    const state = testsState(req, [
      { id: 'U9', file: 'test/users.test.ts', titles: ['returns 404'], change: '+ expect(404)' },
    ]);
    expect(Object.keys(state)).toEqual(['requirement', 'tests']);
    expect(JSON.stringify(state)).not.toContain('after');
  });

  it('reverse.v0 (C.4) asks loosens_test of tests and runtime_setting of config and CI only', () => {
    const sec = section('### C.4 `reverse.v0`');
    const test = reverseQuestions([req], 'test');
    expectVerbatim(sec, test as Record<string, Question>);
    expect(Object.keys(test)).toEqual(['serves', 'plumbing', 'behavior_change', 'loosens_test']);
    expect(Object.keys(reverseQuestions([req], 'config'))).toEqual([
      'serves',
      'plumbing',
      'behavior_change',
      'runtime_setting',
    ]);
    expect(Object.keys(reverseQuestions([req], 'ci'))).toContain('runtime_setting');
    expect(Object.keys(reverseQuestions([req], 'source'))).toEqual(['serves', 'plumbing', 'behavior_change']);
    expect(sec).toContain(`Test units only. ${(test.loosens_test as Question).instructions}`);
    expect(sec).toContain(
      `Config and CI units only. ${(reverseQuestions([req], 'ci').runtime_setting as Question).instructions}`,
    );
    const serves = (test.serves as { criteria: Record<string, string> }).criteria;
    expect(serves.R1).toBe('`requirements` entry R1: GET /users/:id returns 404 for unknown ids.');
    expect(serves.none).toBe('The change does not directly implement any entry in `requirements`.');
    const long = { ...req, text: 'x'.repeat(300) };
    expect(
      (reverseQuestions([long], 'source').serves as { criteria: Record<string, string> }).criteria.R1,
    ).toHaveLength('`requirements` entry R1: '.length + 160);
    expect(
      Object.keys(
        reverseState(
          [req],
          { id: 'U7', file: 'config/defaults.ts', symbol: 'DEFAULTS', kind: 'config', change: 'd' },
          [{ id: 'U3', file: 'f', symbol: 's' }],
        ),
      ),
    ).toEqual(['requirements', 'change', 'other_changes']);
  });

  it('preexisting.v0 (C.5)', () => {
    const sec = section('### C.5 `preexisting.v0`');
    expectVerbatim(sec, preexistingQuestions());
    expect(preexistingState(req, [{ file: 'f', symbol: 's', code: 'c' }])).toEqual({
      requirement: { text: req.text, quote: req.quote },
      base_code: [{ file: 'f', symbol: 's', code: 'c' }],
    });
  });

  it('claims.v0 (C.6)', () => {
    const sec = section('### C.6 `claims.v0`');
    const qs = claimsQuestions([req]);
    expectVerbatim(sec, qs);
    expect(qs.about.criteria.none).toBe('`sentence` is not about any entry in `requirements`.');
    expect(claimsState('All done.', [req])).toEqual({
      sentence: 'All done.',
      requirements: [{ id: 'R1', text: req.text }],
    });
  });

  it('rerank.v0 (C.7) packs candidates by tokens within the limits', () => {
    const sec = section('### C.7 `rerank.v0`');
    expect(sec).toContain(
      '"Is the code change below relevant to implementing or testing `requirement.text`? Change {id} in {file}: {judge view, truncated to fit}"',
    );
    const candidates = Array.from({ length: 30 }, (_, i) => ({
      id: `U${i}`,
      file: `f${i}.ts`,
      judgeView: 'x'.repeat(3000),
    }));
    const batches = rerankBatches(req, candidates, { perQuestion: 32_000, perRequest: 5_000 });
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((b) => Object.keys(b.questions))).toEqual(candidates.map((c) => `c_${c.id}`));
    for (const b of batches) {
      const total =
        estimateTokens(b.state) + Object.values(b.questions).reduce((n, q) => n + estimateTokens(q), 0);
      expect(total).toBeLessThanOrEqual(5_000);
      expect(b.state).toEqual({ requirement: { text: req.text, quote: req.quote } });
    }
    const first = Object.values(batches[0]?.questions ?? {})[0];
    expect(
      first?.instructions.startsWith(
        'Is the code change below relevant to implementing or testing `requirement.text`? Change U0 in f0.ts: ',
      ),
    ).toBe(true);
    const huge = rerankBatches(req, [{ id: 'U1', file: 'f', judgeView: 'y'.repeat(200_000) }]);
    expect(estimateTokens(Object.values(huge[0]?.questions ?? {})[0])).toBeLessThan(32_000);
  });
});
