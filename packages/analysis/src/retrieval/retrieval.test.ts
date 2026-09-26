import type { ChangeUnit, Requirement } from '@remit/core';
import { describe, expect, it } from 'vitest';
import { Bm25 } from './bm25.js';
import {
  applyRerank,
  MAX_CANDIDATES,
  Retriever,
  requirementQuery,
  selectBaseCode,
  selectCandidates,
  unitDocument,
  widen,
} from './retrieve.js';
import { stringLiterals, tokenize } from './tokenize.js';

const unit = (id: string, file: string, over: Partial<ChangeUnit> = {}): ChangeUnit => ({
  id,
  file,
  language: 'ts',
  kind: 'source',
  changeType: 'modified',
  lines: { new: [[1, 2]], old: [] },
  patch: '',
  judgeView: '',
  contentHash: id,
  tokenEstimate: 10,
  facts: [],
  ...over,
});

const req = (text: string, over: Partial<Requirement> = {}): Requirement => ({
  id: 'R1',
  issue: { owner: 'a', repo: 'b', number: 1 },
  text,
  quote: text,
  source: { kind: 'body' },
  kind: 'behavior',
  explicitness: 'explicit',
  priority: 'must',
  examples: [],
  checkableInCode: true,
  ...over,
});

describe('tokenize', () => {
  it.each([
    ['getUserById', ['get', 'user', 'id']],
    ['report_date-filename', ['report', 'date', 'filename']],
    ['HTTPServerError 404', ['http', 'server', 'error', '404']],
    ['The export must return a CSV', ['export', 'return', 'csv']],
  ])('%s', (text, tokens) => {
    expect(tokenize(text)).toEqual(tokens);
  });

  it('finds string literals', () => {
    expect(stringLiterals(`const a = "user not found"; b('x')`)).toEqual(['user not found', 'x']);
  });
});

describe('BM25', () => {
  it('ranks documents with rarer matching terms higher', () => {
    const idx = new Bm25([
      ['csv', 'export', 'button'],
      ['logging', 'logger'],
      ['csv', 'header', 'row', 'row'],
    ]);
    const q = ['header', 'row'];
    expect(idx.score(q, 2)).toBeGreaterThan(idx.score(q, 0));
    expect(idx.score(q, 1)).toBe(0);
    expect(idx.score(q, 9)).toBe(0);
    expect(idx.size).toBe(3);
  });
});

describe('Retriever boosts (6.5)', () => {
  const pool = [
    unit('U1', 'src/reports/export.ts', {
      symbol: { name: 'buildCsv', kind: 'function', startLine: 1, endLine: 9 },
    }),
    unit('U2', 'src/reports/filename.ts'),
    unit('U3', 'src/billing/invoice.ts'),
    unit('U4', 'test/export.test.ts', { kind: 'test', testTitles: ['includes a header row in the csv'] }),
  ];
  const r = new Retriever(pool);
  const scoreOf = (text: string, id: string) => r.rank(req(text)).find((x) => x.unit.id === id)?.score ?? -1;

  it('adds 2.0 when the requirement mentions the unit path or basename', () => {
    // The mention adds 2.0 on top of whatever BM25 gives the mentioned tokens.
    expect(scoreOf('Update export.ts please', 'U1') - scoreOf('Update please', 'U1')).toBeGreaterThanOrEqual(
      2.0,
    );
    expect(scoreOf('Change src/billing/invoice.ts', 'U3')).toBeGreaterThanOrEqual(2);
  });

  it('adds 1.5 when it mentions the symbol name', () => {
    expect(scoreOf('buildCsv writes the file', 'U1')).toBeGreaterThanOrEqual(1.5);
  });

  it('adds 1.0 for a test whose titles share two or more tokens with the requirement', () => {
    const withTitles = scoreOf('header row present', 'U4');
    const oneToken = scoreOf('header present', 'U4');
    expect(withTitles - oneToken).toBeGreaterThanOrEqual(1.0);
  });

  it('adds 0.5 for units in the same directory as a mentioned file', () => {
    // U2 and U3 have the same BM25 score for this query; only U2 shares a directory with export.ts.
    expect(scoreOf('see export.ts', 'U2') - scoreOf('see export.ts', 'U3')).toBeCloseTo(0.5);
  });

  it('builds documents and queries from the right fields', () => {
    expect(
      unitDocument(
        unit('U9', 'src/a/b.ts', { judgeView: '+ return "user not found"', testTitles: ['works fine'] }),
      ),
    ).toEqual(expect.arrayContaining(['src', 'user', 'found', 'works', 'fine']));
    expect(
      requirementQuery(req('text', { quote: 'q', examples: [{ input: 'in', expected: 'out', quote: 'x' }] })),
    ).toBe('text q in out');
  });
});

describe('selecting candidates', () => {
  const units = Array.from({ length: 60 }, (_, i) => unit(`U${i}`, `src/m${i}.ts`));
  const ranked = (positive: number) => units.map((u, i) => ({ unit: u, score: i < positive ? 100 - i : 0 }));
  const size = () => 100;

  it('includes every unit when all fit (the all-in shortcut)', () => {
    expect(selectCandidates(ranked(5).slice(0, 10), 1000, size)).toMatchObject({ kind: 'all' });
  });

  it('fills the budget in rank order, at least one and at most 40', () => {
    const s = selectCandidates(ranked(10), 550, size);
    expect(s.kind).toBe('ranked');
    expect(s.kind === 'ranked' && s.units.map((u) => u.id)).toEqual(['U0', 'U1', 'U2', 'U3', 'U4']);
    const tiny = selectCandidates(ranked(10), 50, size);
    expect(tiny.kind === 'ranked' && tiny.units).toHaveLength(1);
    const big = selectCandidates(ranked(30), 100_000 - 1, () => 2000);
    expect(big.kind === 'ranked' && big.units).toHaveLength(MAX_CANDIDATES);
  });

  it('asks for rerank.v0 over the top 80 when more than 40 units score above zero', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      unit: unit(`U${i}`, `f${i}.ts`),
      score: 1 + i / 1000,
    }));
    const s = selectCandidates(many, 500, size);
    expect(s.kind).toBe('rerank');
    expect(s.kind === 'rerank' && [s.pool.length, s.rest.length]).toEqual([80, 20]);
  });

  it('applies rerank relevance and fills the budget', () => {
    const pool = units.slice(0, 5);
    const rel = new Map([
      ['U3', 0.9],
      ['U1', 0.8],
      ['U0', 0.1],
    ]);
    const r = applyRerank(pool, rel, units.slice(5, 7), 250, size);
    expect(r.units.map((u) => u.id)).toEqual(['U3', 'U1']);
    expect(r.rest.map((u) => u.id)).toEqual(['U0', 'U2', 'U4', 'U5', 'U6']);
  });

  it('widens with the next tranche, or with everything when it fits', () => {
    expect(widen(units.slice(0, 10), units.slice(0, 3), 350, size).map((u) => u.id)).toEqual([
      'U3',
      'U4',
      'U5',
    ]);
    expect(widen(units.slice(0, 4), units.slice(0, 2), 10_000, size)).toHaveLength(4);
  });
});

describe('base code retrieval', () => {
  it('ranks base symbols by BM25 and fills 12k tokens', () => {
    const syms = [
      {
        file: 'src/orders.py',
        symbol: 'recent_orders',
        code: 'def recent_orders(days=7): return [o for o in orders if o.age < days]',
      },
      { file: 'src/billing.py', symbol: 'invoice', code: 'def invoice(): pass' },
    ];
    expect(selectBaseCode(req('return recent orders'), syms).map((s) => s.symbol)).toEqual(['recent_orders']);
    expect(selectBaseCode(req('return recent orders'), syms, 1, () => 5)).toHaveLength(1);
    expect(selectBaseCode(req('nothing matches here'), syms)).toHaveLength(1);
  });
});
