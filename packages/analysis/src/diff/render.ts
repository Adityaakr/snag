import type { DiffFile, Hunk, ParsedDiff } from './parse.js';

function quoteIfNeeded(path: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: git quotes paths containing control characters
  if (!/["\\\t\n\x00-\x1f]/.test(path) && !/^\s|\s$/.test(path)) return path;
  const escaped = path
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

function side(prefix: 'a/' | 'b/', path: string | null): string {
  return path === null ? '/dev/null' : quoteIfNeeded(`${prefix}${path}`);
}

/** Renders one hunk, header included, as unified diff lines. */
export function renderHunk(hunk: Hunk): string[] {
  const out = [
    `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.section ? ` ${hunk.section}` : ''}`,
  ];
  for (const line of hunk.lines) {
    out.push(`${line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}${line.content}`);
    if (line.noNewline) out.push('\\ No newline at end of file');
  }
  return out;
}

/** Renders one file with git extended headers. */
export function renderFile(file: DiffFile): string[] {
  const a = file.oldPath ?? file.newPath ?? '';
  const b = file.newPath ?? file.oldPath ?? '';
  const out = [`diff --git ${side('a/', a)} ${side('b/', b)}`];
  if (file.status === 'added') out.push(`new file mode ${file.newMode ?? '100644'}`);
  else if (file.status === 'deleted') out.push(`deleted file mode ${file.oldMode ?? '100644'}`);
  else {
    if (file.oldMode) out.push(`old mode ${file.oldMode}`);
    if (file.newMode) out.push(`new mode ${file.newMode}`);
  }
  if (file.similarity !== undefined) out.push(`similarity index ${file.similarity}%`);
  if (file.status === 'renamed' || file.status === 'copied') {
    const verb = file.status === 'renamed' ? 'rename' : 'copy';
    out.push(
      `${verb} from ${quoteIfNeeded(file.oldPath ?? '')}`,
      `${verb} to ${quoteIfNeeded(file.newPath ?? '')}`,
    );
  }
  if (file.index)
    out.push(`index ${file.index.old}..${file.index.new}${file.index.mode ? ` ${file.index.mode}` : ''}`);
  if (file.binary) {
    out.push(`Binary files ${side('a/', file.oldPath)} and ${side('b/', file.newPath)} differ`);
    return out;
  }
  if (file.hunks.length > 0) {
    out.push(`--- ${side('a/', file.oldPath)}`, `+++ ${side('b/', file.newPath)}`);
    for (const hunk of file.hunks) out.push(...renderHunk(hunk));
  }
  return out;
}

/** Renders a parsed diff back to text. `parseDiff(renderDiff(d))` equals `d` for any parsed diff. */
export function renderDiff(diff: ParsedDiff): string {
  if (diff.files.length === 0) return '';
  const eol = diff.crlf ? '\r\n' : '\n';
  return diff.files.flatMap(renderFile).join(eol) + eol;
}
