/**
 * Comment stripping that preserves line structure (BUILD_PROMPT 6.3 step 6). Comments and Python docstrings are
 * removed, newlines inside them are kept, so line N of the output is line N of the input.
 */
import { commentRanges, type ParsedLanguage, parse, type TextRange } from './treesitter.js';

/** Removes the given ranges from text, keeping every newline and trimming trailing spaces it leaves behind. */
export function removeRanges(text: string, ranges: readonly TextRange[]): string {
  if (ranges.length === 0) return text;
  let out = '';
  let pos = 0;
  const touched = new Set<number>();
  let lineNo = 0;
  const countLines = (s: string) => {
    for (const ch of s) if (ch === '\n') lineNo++;
  };
  for (const r of ranges) {
    if (r.startIndex < pos) continue; // nested or overlapping
    const kept = text.slice(pos, r.startIndex);
    out += kept;
    countLines(kept);
    touched.add(lineNo);
    const removed = text.slice(r.startIndex, r.endIndex);
    for (const ch of removed) {
      if (ch === '\n') {
        out += '\n';
        lineNo++;
        touched.add(lineNo);
      }
    }
    pos = r.endIndex;
  }
  out += text.slice(pos);
  return out
    .split('\n')
    .map((l, i) => (touched.has(i) ? l.replace(/[ \t]+$/, '') : l))
    .join('\n');
}

/** Strips comments (and Python docstrings) from source, preserving line numbers. */
export async function stripComments(lang: ParsedLanguage, source: string): Promise<string> {
  const tree = await parse(lang, source);
  try {
    return removeRanges(source, commentRanges(lang, tree));
  } finally {
    tree.delete();
  }
}
