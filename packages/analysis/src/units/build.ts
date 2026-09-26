/**
 * Diff to change units (BUILD_PROMPT 6.3). Each file's change blocks are mapped to the smallest enclosing named
 * symbol (tree-sitter), the rest are grouped by proximity, oversized units are split at hunk boundaries, and each
 * unit gets a comment-stripped judge view, bounded before/after context, a filter reason and a stable ID.
 */
import { createHash } from 'node:crypto';
import type { ChangeUnit, Language, SymbolKind, UnitKind } from '@remit/core';
import { estimateTokens } from '@remit/core';
import type { DiffFile, Hunk, HunkLine, ParsedDiff } from '../diff/parse.js';
import { renderHunk } from '../diff/render.js';
import { classifyFile } from '../files/classify.js';
import type { AttributeRule } from '../files/gitattributes.js';
import { stripComments } from '../syntax/strip.js';
import { type CodeSymbol, extractSymbols, isParsed, smallestEnclosing } from '../syntax/treesitter.js';

/** Reads file contents at the base or head side. Returns null when unavailable. */
export interface ContentSource {
  get(side: 'base' | 'head', path: string): Promise<string | null>;
}

export interface BuildUnitsOptions {
  contents?: ContentSource;
  attributes?: readonly AttributeRule[];
  /** Units over this estimate are split at hunk boundaries. Default 6000. */
  maxUnitTokens?: number;
  /** Maximum lines of before/after context per side. Default 120. */
  contextLines?: number;
  /** Hunks outside symbols merge when this many lines apart or fewer. Default 20. */
  proximity?: number;
}

export interface IgnoredFile {
  file: string;
  reason: 'too_large' | 'binary';
}

export interface BuildUnitsResult {
  units: ChangeUnit[];
  warnings: string[];
}

const CONTEXT = 3;

/** One contiguous run of added/deleted lines inside a hunk, with its index range in the hunk. */
interface Block {
  hunkIndex: number;
  from: number;
  to: number; // inclusive
  newRange: [number, number] | null;
  oldRange: [number, number] | null;
}

interface FileAnalysis {
  file: DiffFile;
  path: string;
  kind: UnitKind;
  language: Language;
  filtered?: ChangeUnit['filtered'];
  headSymbols: CodeSymbol[];
  baseSymbols: CodeSymbol[];
  headStripped: string[] | null;
  baseStripped: string[] | null;
  headLines: string[] | null;
}

function span(nums: number[]): [number, number] | null {
  if (nums.length === 0) return null;
  return [Math.min(...nums), Math.max(...nums)];
}

/** Splits a hunk into blocks of consecutive changed lines. */
export function blocksOf(hunk: Hunk, hunkIndex: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < hunk.lines.length) {
    if ((hunk.lines[i] as HunkLine).type === 'context') {
      i++;
      continue;
    }
    const from = i;
    while (i < hunk.lines.length && (hunk.lines[i] as HunkLine).type !== 'context') i++;
    const slice = hunk.lines.slice(from, i);
    blocks.push({
      hunkIndex,
      from,
      to: i - 1,
      newRange: span(slice.flatMap((l) => (l.newLine !== undefined ? [l.newLine] : []))),
      oldRange: span(slice.flatMap((l) => (l.oldLine !== undefined ? [l.oldLine] : []))),
    });
  }
  return blocks;
}

/** Builds a valid sub-hunk covering hunk lines [from, to] plus up to 3 context lines each side. */
export function sliceHunk(hunk: Hunk, from: number, to: number): Hunk {
  const start = Math.max(0, from - CONTEXT);
  const end = Math.min(hunk.lines.length - 1, to + CONTEXT);
  // Only take context lines as padding, never other changes.
  let s = from;
  while (s > start && (hunk.lines[s - 1] as HunkLine).type === 'context') s--;
  let e = to;
  while (e < end && (hunk.lines[e + 1] as HunkLine).type === 'context') e++;
  const lines = hunk.lines.slice(s, e + 1);
  // A side's start is the next line number on that side; an empty side points at the line before (git's rule).
  const oldBefore = hunk.lines.slice(0, s).filter((l) => l.type !== 'add').length;
  const newBefore = hunk.lines.slice(0, s).filter((l) => l.type !== 'del').length;
  const oldLines = lines.filter((l) => l.type !== 'add').length;
  const newLines = lines.filter((l) => l.type !== 'del').length;
  const oldFirst = hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart;
  const newFirst = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart;
  return {
    oldStart: Math.max(0, oldFirst + oldBefore - (oldLines === 0 ? 1 : 0)),
    oldLines,
    newStart: Math.max(0, newFirst + newBefore - (newLines === 0 ? 1 : 0)),
    newLines,
    section: hunk.section,
    lines,
  };
}

/** Removes whitespace outside string literals, so reformatting compares equal but `"a b"` vs `"ab"` does not. */
export function normalizeCode(text: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i++;
      } else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
    } else if (!/\s/.test(ch)) out += ch;
  }
  return out;
}

/** True when the deleted and added lines are the same code apart from whitespace (6.3 step 8). */
export function isFormattingOnly(hunks: readonly Hunk[]): boolean {
  const dels = hunks.flatMap((h) => h.lines.filter((l) => l.type === 'del').map((l) => l.content));
  const adds = hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add').map((l) => l.content));
  if (dels.length === 0 || adds.length === 0) return false;
  return normalizeCode(dels.join('\n')) === normalizeCode(adds.join('\n'));
}

const LINE_COMMENT = /^\s*(\/\/|#(?!\[)|--|;|\/\*|\*|<!--)/;

/** Line-level comment removal for files tree-sitter does not parse (config, CI, other languages). */
function stripUnparsedLine(content: string, kind: UnitKind): string {
  if (kind === 'docs') return content;
  return LINE_COMMENT.test(content) ? '' : content;
}

function renderUnitPatch(file: DiffFile, hunks: readonly Hunk[]): string {
  const header = [
    `--- ${file.oldPath === null ? '/dev/null' : `a/${file.oldPath}`}`,
    `+++ ${file.newPath === null ? '/dev/null' : `b/${file.newPath}`}`,
  ];
  return `${[...header, ...hunks.flatMap(renderHunk)].join('\n')}\n`;
}

function judgeViewOf(fa: FileAnalysis, hunks: readonly Hunk[]): string {
  const view = hunks.map((h) => ({
    ...h,
    lines: h.lines.map((l) => {
      let content = l.content;
      if (l.type === 'del' && fa.baseStripped && l.oldLine !== undefined)
        content = fa.baseStripped[l.oldLine - 1] ?? '';
      else if (l.type !== 'del' && fa.headStripped && l.newLine !== undefined)
        content = fa.headStripped[l.newLine - 1] ?? '';
      else if (!isParsed(fa.language) || (!fa.baseStripped && !fa.headStripped))
        content = stripUnparsedLine(content, fa.kind);
      return { ...l, content };
    }),
  }));
  return renderUnitPatch(fa.file, view);
}

function bounded(lines: string[] | null, start: number, end: number, max: number): string | undefined {
  if (!lines) return undefined;
  const slice = lines.slice(start - 1, Math.min(end, start - 1 + max));
  return slice.length ? slice.join('\n') : undefined;
}

function rangesOf(blocks: readonly Block[], side: 'newRange' | 'oldRange'): [number, number][] {
  const ranges = blocks
    .flatMap((b) => (b[side] ? [b[side] as [number, number]] : []))
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Reconstructs a partial file from hunks when full contents are missing; unknown lines are blank. */
function partialFromHunks(file: DiffFile, side: 'base' | 'head'): string {
  const lines: string[] = [];
  for (const h of file.hunks) {
    for (const l of h.lines) {
      const n = side === 'head' ? l.newLine : l.oldLine;
      if (n === undefined || (side === 'head' && l.type === 'del') || (side === 'base' && l.type === 'add'))
        continue;
      while (lines.length < n - 1) lines.push('');
      lines[n - 1] = l.content;
    }
  }
  return lines.join('\n');
}

async function analyzeFile(file: DiffFile, opts: BuildUnitsOptions): Promise<FileAnalysis> {
  const path = (file.newPath ?? file.oldPath) as string;
  const oldPath = file.oldPath ?? path;
  const headText =
    file.newPath !== null && !file.binary ? ((await opts.contents?.get('head', path)) ?? null) : null;
  const baseText =
    file.oldPath !== null && !file.binary ? ((await opts.contents?.get('base', oldPath)) ?? null) : null;
  const cls = classifyFile(path, {
    ...(opts.attributes ? { attributes: opts.attributes } : {}),
    ...(headText !== null ? { headText } : {}),
    binary: file.binary,
  });
  const fa: FileAnalysis = {
    file,
    path,
    kind: cls.kind,
    language: cls.language,
    ...(cls.filtered ? { filtered: cls.filtered } : {}),
    headSymbols: [],
    baseSymbols: [],
    headStripped: null,
    baseStripped: null,
    headLines: headText?.split('\n') ?? null,
  };
  if (!isParsed(cls.language) || file.binary || cls.filtered) return fa;
  const head = headText ?? (file.newPath !== null ? partialFromHunks(file, 'head') : null);
  const base = baseText ?? (file.oldPath !== null ? partialFromHunks(file, 'base') : null);
  if (head !== null) {
    fa.headSymbols = await extractSymbols(cls.language, head);
    fa.headStripped = (await stripComments(cls.language, head)).split('\n');
    fa.headLines ??= head.split('\n');
  }
  if (base !== null) {
    fa.baseSymbols = await extractSymbols(cls.language, base);
    fa.baseStripped = (await stripComments(cls.language, base)).split('\n');
  }
  return fa;
}

interface Group {
  symbol?: CodeSymbol;
  symbolSide?: 'head' | 'base';
  blocks: Block[];
}

function isRustTestModule(fa: FileAnalysis, sym: CodeSymbol): boolean {
  if (fa.language !== 'rs') return false;
  const enclosing = fa.headSymbols.filter(
    (s) => s.kind === 'module' && s.startLine <= sym.startLine && s.endLine >= sym.endLine,
  );
  return enclosing.some((m) =>
    /#\[\s*cfg\(\s*test\s*\)\s*\]/.test(
      fa.headLines?.slice(m.startLine - 1, m.startLine + 1).join('\n') ?? '',
    ),
  );
}

function groupBlocks(fa: FileAnalysis, blocks: Block[], proximity: number): Group[] {
  const bySymbol = new Map<string, Group>();
  const loose: Block[] = [];
  for (const b of blocks) {
    let sym: CodeSymbol | null = null;
    let side: 'head' | 'base' = 'head';
    if (b.newRange && fa.headSymbols.length)
      sym = smallestEnclosing(fa.headSymbols, b.newRange[0], b.newRange[1]);
    if (!sym && !b.newRange && b.oldRange && fa.baseSymbols.length) {
      sym = smallestEnclosing(fa.baseSymbols, b.oldRange[0], b.oldRange[1]);
      side = 'base';
    }
    if (!sym) {
      loose.push(b);
      continue;
    }
    const key = `${sym.kind}:${sym.name}:${sym.depth}`;
    const g = bySymbol.get(key);
    if (g) g.blocks.push(b);
    else bySymbol.set(key, { symbol: sym, symbolSide: side, blocks: [b] });
  }
  const groups = [...bySymbol.values()];
  // Proximity grouping for everything outside a symbol.
  const anchor = (b: Block) => (b.newRange ?? b.oldRange ?? [0, 0])[0];
  loose.sort((a, b) => anchor(a) - anchor(b));
  let current: Group | null = null;
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const b of loose) {
    const r = b.newRange ?? b.oldRange ?? [0, 0];
    if (current && r[0] - lastEnd <= proximity) current.blocks.push(b);
    else {
      current = { blocks: [b] };
      groups.push(current);
    }
    lastEnd = Math.max(lastEnd, r[1]);
  }
  return groups;
}

/** Turns grouped blocks into sub-hunks, merging blocks of the same hunk that share context. */
function hunksFor(file: DiffFile, blocks: readonly Block[]): Hunk[] {
  const byHunk = new Map<number, Block[]>();
  for (const b of blocks) byHunk.set(b.hunkIndex, [...(byHunk.get(b.hunkIndex) ?? []), b]);
  const out: Hunk[] = [];
  for (const [index, bs] of [...byHunk.entries()].sort((a, b) => a[0] - b[0])) {
    const hunk = file.hunks[index] as Hunk;
    const sorted = bs.sort((a, b) => a.from - b.from);
    let from = (sorted[0] as Block).from;
    let to = (sorted[0] as Block).to;
    for (const b of sorted.slice(1)) {
      // Keep blocks in one sub-hunk only when nothing from another group sits between them.
      const between = hunk.lines.slice(to + 1, b.from);
      if (between.every((l) => l.type === 'context') && between.length <= 2 * CONTEXT) to = b.to;
      else {
        out.push(sliceHunk(hunk, from, to));
        from = b.from;
        to = b.to;
      }
    }
    out.push(sliceHunk(hunk, from, to));
  }
  return out;
}

function changeTypeOf(file: DiffFile): ChangeUnit['changeType'] {
  if (file.status === 'added' || file.status === 'copied') return 'added';
  if (file.status === 'deleted') return 'deleted';
  if (file.status === 'renamed') return 'renamed';
  return 'modified';
}

function metaOnlyView(file: DiffFile): string {
  const parts: string[] = [];
  if (file.status === 'renamed' || file.status === 'copied')
    parts.push(`${file.status} ${file.oldPath} -> ${file.newPath}`);
  if (file.oldMode && file.newMode && file.oldMode !== file.newMode)
    parts.push(`mode ${file.oldMode} -> ${file.newMode}`);
  if (file.binary) parts.push('binary file changed');
  if (file.status === 'added' && file.hunks.length === 0) parts.push('empty file added');
  if (file.status === 'deleted' && file.hunks.length === 0) parts.push('empty file deleted');
  return parts.join('\n');
}

type Draft = Omit<ChangeUnit, 'id'> & { sortLine: number };

function draftUnit(
  fa: FileAnalysis,
  group: Group,
  hunks: Hunk[],
  opts: Required<Pick<BuildUnitsOptions, 'contextLines'>>,
): Draft {
  const blocks = group.blocks;
  const patch = renderUnitPatch(fa.file, hunks);
  const judgeView = judgeViewOf(fa, hunks);
  const lines = { new: rangesOf(blocks, 'newRange'), old: rangesOf(blocks, 'oldRange') };
  let kind = fa.kind;
  const sym = group.symbol;
  if (sym && (sym.kind === 'test' || isRustTestModule(fa, sym)) && kind === 'source') kind = 'test';
  const unit: Draft = {
    file: fa.path,
    language: fa.language,
    kind,
    changeType: changeTypeOf(fa.file),
    lines,
    patch,
    judgeView,
    contentHash: createHash('sha256').update(fa.path).update(judgeView).digest('hex'),
    tokenEstimate: estimateTokens(patch),
    facts: [],
    sortLine: (lines.new[0] ?? lines.old[0] ?? [0])[0],
  };
  if (fa.file.oldPath && fa.file.oldPath !== fa.path) unit.oldFile = fa.file.oldPath;
  if (sym) {
    unit.symbol = {
      name: sym.name,
      kind: sym.kind as SymbolKind,
      startLine: sym.startLine,
      endLine: sym.endLine,
    };
    const baseSym =
      group.symbolSide === 'base'
        ? sym
        : fa.baseSymbols.find((s) => s.name === sym.name && s.kind === sym.kind && s.depth === sym.depth);
    const headSym = group.symbolSide === 'head' ? sym : undefined;
    const after = headSym
      ? bounded(fa.headStripped, headSym.startLine, headSym.endLine, opts.contextLines)
      : undefined;
    const before = baseSym
      ? bounded(fa.baseStripped, baseSym.startLine, baseSym.endLine, opts.contextLines)
      : undefined;
    if (before !== undefined) unit.before = before;
    if (after !== undefined) unit.after = after;
  }
  if (kind === 'test') {
    const newR = lines.new;
    const oldR = lines.old;
    const overlaps = (s: CodeSymbol, ranges: [number, number][]) =>
      ranges.some(([a, b]) => s.startLine <= b && s.endLine >= a);
    const titles = [
      ...fa.headSymbols.filter((s) => s.testTitle && overlaps(s, newR)),
      ...fa.baseSymbols.filter((s) => s.testTitle && overlaps(s, oldR)),
    ].map((s) => s.testTitle as string);
    if (titles.length) unit.testTitles = [...new Set(titles)];
  }
  if (fa.filtered) unit.filtered = fa.filtered;
  else if (isFormattingOnly(hunks)) unit.filtered = 'formatting_only';
  return unit;
}

/** Splits a group's hunks into chunks under the token cap, at hunk boundaries. */
function capBySize(hunks: Hunk[], file: DiffFile, maxTokens: number): Hunk[][] {
  const chunks: Hunk[][] = [];
  let current: Hunk[] = [];
  for (const h of hunks) {
    const candidate = [...current, h];
    if (current.length && estimateTokens(renderUnitPatch(file, candidate)) > maxTokens) {
      chunks.push(current);
      current = [h];
    } else current = candidate;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Builds change units for a parsed diff. Units are ordered by path, then first changed line, and numbered U1..Un. */
export async function buildUnits(diff: ParsedDiff, opts: BuildUnitsOptions = {}): Promise<BuildUnitsResult> {
  const maxUnitTokens = opts.maxUnitTokens ?? 6000;
  const contextLines = opts.contextLines ?? 120;
  const proximity = opts.proximity ?? 20;
  const drafts: Draft[] = [];
  const warnings: string[] = [];

  for (const file of diff.files) {
    const fa = await analyzeFile(file, opts);
    if (file.hunks.length === 0) {
      const view = metaOnlyView(file);
      drafts.push({
        file: fa.path,
        ...(file.oldPath && file.oldPath !== fa.path ? { oldFile: file.oldPath } : {}),
        language: fa.language,
        kind: fa.kind,
        changeType: changeTypeOf(file),
        lines: { new: [], old: [] },
        patch: '',
        judgeView: view,
        contentHash: createHash('sha256').update(fa.path).update(view).digest('hex'),
        tokenEstimate: estimateTokens(view),
        ...(fa.filtered ? { filtered: fa.filtered } : {}),
        facts: [],
        sortLine: 0,
      });
      continue;
    }
    const blocks = file.hunks.flatMap((h, i) => blocksOf(h, i));
    for (const group of groupBlocks(fa, blocks, proximity)) {
      const hunks = hunksFor(file, group.blocks);
      const chunks = capBySize(hunks, file, maxUnitTokens);
      if (chunks.length > 1)
        warnings.push(
          `${fa.path}: split a ${group.symbol ? `symbol "${group.symbol.name}"` : 'change'} into ${chunks.length} units over ${maxUnitTokens} tokens`,
        );
      for (const chunk of chunks) {
        const chunkBlocks = group.blocks.filter((b) =>
          chunk.some((h) => {
            const src = file.hunks[b.hunkIndex] as Hunk;
            const line = src.lines[b.from] as HunkLine;
            return h.lines.includes(line);
          }),
        );
        drafts.push(draftUnit(fa, { ...group, blocks: chunkBlocks }, chunk, { contextLines }));
      }
    }
  }

  drafts.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.sortLine - b.sortLine));
  const units = drafts.map(({ sortLine: _s, ...u }, i) => ({ id: `U${i + 1}`, ...u }) as ChangeUnit);
  return { units, warnings };
}

const KEEP_ORDER: UnitKind[] = ['source', 'test', 'config', 'ci', 'docs'];

/** Keeps at most `max` units in priority order source, test, config, CI, docs, other (BUILD_PROMPT 6.1). */
export function limitUnits(
  units: readonly ChangeUnit[],
  max: number,
): { units: ChangeUnit[]; warning?: string } {
  if (units.length <= max) return { units: [...units] };
  const rank = (u: ChangeUnit) => {
    const i = KEEP_ORDER.indexOf(u.kind);
    return i === -1 ? KEEP_ORDER.length : i;
  };
  const kept = new Set([...units].sort((a, b) => rank(a) - rank(b)).slice(0, max));
  return {
    units: units.filter((u) => kept.has(u)),
    warning: `This PR has ${units.length} change units; only the first ${max} by priority (source, test, config, CI, docs, other) were reviewed.`,
  };
}
