/**
 * Candidate retrieval (BUILD_PROMPT 6.5): for each requirement, choose which units go into its forward-call
 * state. Pure: the rerank step is returned as a request; the pipeline asks Jev and calls `applyRerank`.
 */
import type { ChangeUnit, Requirement } from '@remit/core';
import { Bm25 } from './bm25.js';
import { stringLiterals, tokenize } from './tokenize.js';

export const MAX_CANDIDATES = 40;
export const RERANK_POOL = 80;
export const STATE_OVERHEAD = 1500;

export interface Ranked {
  unit: ChangeUnit;
  score: number;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** The document text a unit is indexed by: path segments, symbol, string literals, test titles, judge view. */
export function unitDocument(u: ChangeUnit): string[] {
  return [
    ...tokenize(u.file),
    ...tokenize(u.symbol?.name ?? ''),
    ...stringLiterals(u.judgeView).flatMap(tokenize),
    ...(u.testTitles ?? []).flatMap(tokenize),
    ...tokenize(u.judgeView),
  ];
}

/** The query text: requirement text, quote and example values. */
export function requirementQuery(r: Requirement): string {
  return [r.text, r.quote, ...r.examples.flatMap((e) => [e.input, e.expected])].join(' ');
}

const wordIn = (hay: string, needle: string) =>
  new RegExp(`(^|[^A-Za-z0-9_])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_])`, 'i').test(
    hay,
  );

/** A BM25 index over a pool of units with the 6.5 boosts. */
export class Retriever {
  private readonly bm25: Bm25;

  constructor(readonly pool: readonly ChangeUnit[]) {
    this.bm25 = new Bm25(pool.map(unitDocument));
  }

  /** Units ordered by BM25 plus boosts, highest first (ties by unit order). */
  rank(r: Requirement): Ranked[] {
    const q = requirementQuery(r);
    const qTokens = tokenize(q);
    const qSet = new Set(qTokens);
    const mentioned = this.pool.filter((u) => {
      const base = basename(u.file);
      const stem = base.replace(/\.[^.]+$/, '');
      return q.includes(u.file) || wordIn(q, base) || (stem.length >= 4 && wordIn(q, stem));
    });
    const mentionedDirs = new Set(mentioned.map((u) => dirname(u.file)));
    return this.pool
      .map((unit, i) => {
        let score = this.bm25.score(qTokens, i);
        if (mentioned.includes(unit)) score += 2.0;
        if (unit.symbol && unit.symbol.name.length >= 3 && wordIn(q, unit.symbol.name)) score += 1.5;
        if (
          unit.kind === 'test' &&
          new Set((unit.testTitles ?? []).flatMap(tokenize).filter((t) => qSet.has(t))).size >= 2
        )
          score += 1.0;
        if (!mentioned.includes(unit) && mentionedDirs.has(dirname(unit.file))) score += 0.5;
        return { unit, score, i };
      })
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map(({ unit, score }) => ({ unit, score }));
  }
}

export type Selection =
  | { kind: 'all'; units: ChangeUnit[] }
  | { kind: 'ranked'; units: ChangeUnit[]; rest: ChangeUnit[] }
  | { kind: 'rerank'; pool: ChangeUnit[]; rest: ChangeUnit[] };

/**
 * Chooses candidates within `budget` tokens (6.5 steps 3 and 4). `sizeOf` is the token cost of a unit's entry in
 * the state. If every unit fits, all go in; otherwise units fill the budget in rank order (at least 1, at most
 * 40); if more than 40 units score above zero, the top 80 are returned for `rerank.v0` first.
 */
export function selectCandidates(
  ranked: readonly Ranked[],
  budget: number,
  sizeOf: (u: ChangeUnit) => number,
): Selection {
  const total = ranked.reduce((n, r) => n + sizeOf(r.unit), 0);
  if (total <= budget) return { kind: 'all', units: ranked.map((r) => r.unit) };
  const positive = ranked.filter((r) => r.score > 0);
  if (positive.length > MAX_CANDIDATES) {
    const pool = ranked.slice(0, RERANK_POOL).map((r) => r.unit);
    return { kind: 'rerank', pool, rest: ranked.slice(RERANK_POOL).map((r) => r.unit) };
  }
  const { chosen, rest } = fill(
    ranked.map((r) => r.unit),
    budget,
    sizeOf,
  );
  return { kind: 'ranked', units: chosen, rest };
}

/** Fills the budget in order: at least one unit, at most 40. */
export function fill(
  order: readonly ChangeUnit[],
  budget: number,
  sizeOf: (u: ChangeUnit) => number,
): { chosen: ChangeUnit[]; rest: ChangeUnit[] } {
  const chosen: ChangeUnit[] = [];
  let used = 0;
  let i = 0;
  for (; i < order.length && chosen.length < MAX_CANDIDATES; i++) {
    const u = order[i] as ChangeUnit;
    const s = sizeOf(u);
    if (chosen.length && used + s > budget) break;
    chosen.push(u);
    used += s;
  }
  return { chosen, rest: order.slice(i) };
}

/** Reorders the rerank pool by `noul` relevance (highest first) and fills the budget (C.7 selection). */
export function applyRerank(
  pool: readonly ChangeUnit[],
  relevance: ReadonlyMap<string, number>,
  rest: readonly ChangeUnit[],
  budget: number,
  sizeOf: (u: ChangeUnit) => number,
) {
  const order = [...pool].sort((a, b) => (relevance.get(b.id) ?? 0) - (relevance.get(a.id) ?? 0));
  const { chosen, rest: left } = fill(order, budget, sizeOf);
  return { units: chosen, rest: [...left, ...rest] };
}

/** The widen pass (6.5 step 5): the next tranche in rank order, or every unit when all fit. */
export function widen(
  allRanked: readonly ChangeUnit[],
  used: readonly ChangeUnit[],
  budget: number,
  sizeOf: (u: ChangeUnit) => number,
): ChangeUnit[] {
  const total = allRanked.reduce((n, u) => n + sizeOf(u), 0);
  if (total <= budget) return [...allRanked];
  const seen = new Set(used.map((u) => u.id));
  return fill(
    allRanked.filter((u) => !seen.has(u.id)),
    budget,
    sizeOf,
  ).chosen;
}

/** A base-version symbol for `preexisting.v0` retrieval (6.5 step 7). */
export interface BaseSymbol {
  file: string;
  symbol: string;
  code: string;
}

/** BM25 over base symbols, filled up to `budget` tokens (default 12k). */
export function selectBaseCode(
  r: Requirement,
  symbols: readonly BaseSymbol[],
  budget = 12_000,
  sizeOf = (s: BaseSymbol) => Math.ceil(JSON.stringify(s).length / 3),
): BaseSymbol[] {
  const index = new Bm25(
    symbols.map((s) => [...tokenize(s.file), ...tokenize(s.symbol), ...tokenize(s.code)]),
  );
  const q = tokenize(requirementQuery(r));
  const order = symbols
    .map((s, i) => ({ s, score: index.score(q, i), i }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const out: BaseSymbol[] = [];
  let used = 0;
  for (const { s, score } of order) {
    if (score <= 0 && out.length) break;
    const size = sizeOf(s);
    if (out.length && used + size > budget) break;
    out.push(s);
    used += size;
  }
  return out;
}
