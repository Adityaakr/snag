/**
 * Line views of a change unit for the fact detectors. The raw view is the unit patch (comments included, needed
 * for suppressions and secrets); the judge view is comment-stripped (so commented-out code cannot trigger facts).
 */
import type { ChangeUnit } from '@remit/core';
import { parseDiff } from '../diff/parse.js';

export interface Line {
  content: string;
  /** New-side line for additions, old-side line for deletions. */
  line: number;
}

/** One run of consecutive changed lines: what was removed and what replaced it. */
export interface ChangeBlock {
  dels: Line[];
  adds: Line[];
}

export interface LineView {
  adds: Line[];
  dels: Line[];
  blocks: ChangeBlock[];
}

/** Builds a line view from unified diff text (a unit's patch or judge view). */
export function viewOf(patch: string): LineView {
  const view: LineView = { adds: [], dels: [], blocks: [] };
  if (!patch.includes('@@')) return view;
  for (const file of parseDiff(patch).files) {
    for (const hunk of file.hunks) {
      let block: ChangeBlock | null = null;
      for (const l of hunk.lines) {
        if (l.type === 'context') {
          block = null;
          continue;
        }
        if (!block) {
          block = { dels: [], adds: [] };
          view.blocks.push(block);
        }
        if (l.type === 'add') {
          const line = { content: l.content, line: l.newLine ?? 0 };
          view.adds.push(line);
          block.adds.push(line);
        } else {
          const line = { content: l.content, line: l.oldLine ?? 0 };
          view.dels.push(line);
          block.dels.push(line);
        }
      }
    }
  }
  return view;
}

export interface UnitViews {
  unit: ChangeUnit;
  /** The unit patch, comments and strings included. */
  raw: LineView;
  /** The comment-stripped judge view. */
  judge: LineView;
  /** The judge view with string literal contents blanked (parsed languages only), for marker detectors. */
  code: LineView;
}

/**
 * Empties string literal contents on one line, keeping the quotes: `it.skip("a .only b")` becomes `it.skip("")`.
 * Line-local, so multi-line strings are only partly blanked.
 */
export function blankStrings(content: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i] as string;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) {
        quote = null;
        out += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    out += ch;
  }
  return out;
}

function mapView(view: LineView, fn: (s: string) => string): LineView {
  const map = new Map<Line, Line>();
  const conv = (l: Line) => {
    let m = map.get(l);
    if (!m) {
      m = { content: fn(l.content), line: l.line };
      map.set(l, m);
    }
    return m;
  };
  return {
    adds: view.adds.map(conv),
    dels: view.dels.map(conv),
    blocks: view.blocks.map((b) => ({ adds: b.adds.map(conv), dels: b.dels.map(conv) })),
  };
}

export function unitViews(unit: ChangeUnit): UnitViews {
  const judge = viewOf(unit.judgeView);
  const parsed = unit.language !== 'other';
  return { unit, raw: viewOf(unit.patch), judge, code: parsed ? mapView(judge, blankStrings) : judge };
}

/** Counts regex matches in text (the regex needs the g flag). */
export function countMatches(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

/** Splits a call's argument list at top-level commas, respecting brackets and strings. */
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += text[i + 1] ?? '';
        i++;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Returns the text inside the parentheses that start at `open` (an index of '('), or null when unbalanced. */
export function parenBody(text: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** True for literal-looking expressions: numbers, strings, booleans, null-ish, and bracketed literals. */
export function isLiteral(expr: string): boolean {
  const e = expr.trim().replace(/;$/, '');
  return (
    /^-?\d[\d_]*(\.\d+)?([eE][-+]?\d+)?[a-z0-9]*$/.test(e) ||
    /^(["'`]).*\1$/.test(e) ||
    /^(true|false|null|undefined|None|True|False|NaN)$/.test(e) ||
    /^(Ok|Some|Err)\(.*\)$/.test(e) ||
    /^[[{].*[\]}]$/.test(e)
  );
}
