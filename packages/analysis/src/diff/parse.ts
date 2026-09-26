/**
 * A small unified diff parser (BUILD_PROMPT 6.3 step 1). Handles git extended headers (renames, copies,
 * mode changes, new and deleted files), binary markers, `\ No newline at end of file`, CRLF and empty diffs.
 * Hunk bodies are read by their line counts, so content that looks like a header cannot confuse the parser.
 */

export type LineType = 'context' | 'add' | 'del';

export interface HunkLine {
  type: LineType;
  content: string;
  /** 1-based line number on the old side (context and del). */
  oldLine?: number;
  /** 1-based line number on the new side (context and add). */
  newLine?: number;
  /** True when this line is followed by `\ No newline at end of file`. */
  noNewline?: boolean;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Text after the second `@@`, usually the enclosing function. */
  section: string;
  lines: HunkLine[];
}

export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';

export interface DiffFile {
  /** Old path without the `a/` prefix, or null for new files. */
  oldPath: string | null;
  /** New path without the `b/` prefix, or null for deleted files. */
  newPath: string | null;
  status: FileStatus;
  oldMode?: string;
  newMode?: string;
  similarity?: number;
  /** Abbreviated blob ids from the `index` line. */
  index?: { old: string; new: string; mode?: string };
  binary: boolean;
  hunks: Hunk[];
}

export interface ParsedDiff {
  files: DiffFile[];
  /** True when the input used CRLF line endings. */
  crlf: boolean;
}

export class DiffParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (diff line ${line})`);
    this.name = 'DiffParseError';
  }
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Removes git's `a/` or `b/` prefix and C-style quoting. Returns null for /dev/null. */
export function cleanPath(raw: string, prefix: 'a/' | 'b/' | null): string | null {
  let p = raw.replace(/\t.*$/, ''); // drop trailing timestamps from non-git diffs
  if (p.startsWith('"') && p.endsWith('"')) p = unquote(p.slice(1, -1));
  if (p === '/dev/null') return null;
  return prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

function unquote(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = s[i + 1] ?? '';
    if (/[0-7]/.test(next)) {
      bytes.push(Number.parseInt(s.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      const map: Record<string, string> = {
        n: '\n',
        t: '\t',
        '"': '"',
        '\\': '\\',
        r: '\r',
        a: '\x07',
        b: '\b',
        f: '\f',
        v: '\v',
      };
      bytes.push(...Buffer.from(map[next] ?? next, 'utf8'));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Splits `diff --git a/x b/y` into its two paths, handling quoted paths and spaces. */
function parseGitHeaderPaths(rest: string): [string, string] | null {
  if (rest.startsWith('"')) {
    const end = findQuoteEnd(rest, 0);
    const a = rest.slice(0, end + 1);
    const b = rest.slice(end + 2);
    return [a, b];
  }
  // Unquoted: paths may contain spaces. When old and new are equal the split is unambiguous.
  const bIdx = rest.indexOf(' b/');
  if (bIdx === -1) {
    const quoted = rest.indexOf(' "');
    return quoted === -1 ? null : [rest.slice(0, quoted), rest.slice(quoted + 1)];
  }
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest.slice(2, half) === rest.slice(half + 3)) {
    return [rest.slice(0, half), rest.slice(half + 1)];
  }
  return [rest.slice(0, bIdx), rest.slice(bIdx + 1)];
}

function findQuoteEnd(s: string, start: number): number {
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return i;
  }
  return s.length - 1;
}

/** Parses unified diff text. An empty or whitespace-only input yields no files. */
export function parseDiff(text: string): ParsedDiff {
  const crlf = /\r\n/.test(text);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const files: DiffFile[] = [];
  let i = 0;
  let file: DiffFile | null = null;

  const startFile = (oldPath: string | null, newPath: string | null): DiffFile => {
    const f: DiffFile = { oldPath, newPath, status: 'modified', binary: false, hunks: [] };
    files.push(f);
    return f;
  };

  while (i < lines.length) {
    const line = lines[i] as string;

    if (line.startsWith('diff --git ')) {
      const paths = parseGitHeaderPaths(line.slice('diff --git '.length));
      if (!paths) throw new DiffParseError(`Cannot read paths from "${line}"`, i + 1);
      file = startFile(cleanPath(paths[0], 'a/'), cleanPath(paths[1], 'b/'));
      i++;
      continue;
    }

    if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      const oldPath = cleanPath(line.slice(4), 'a/');
      const newPath = cleanPath((lines[i + 1] as string).slice(4), 'b/');
      // A plain (non-git) diff starts a file here; a git diff already has one.
      if (!file || file.hunks.length > 0 || file.binary) file = startFile(oldPath, newPath);
      file.oldPath = oldPath;
      file.newPath = newPath;
      if (oldPath === null) file.status = 'added';
      else if (newPath === null) file.status = 'deleted';
      i += 2;
      continue;
    }

    if (line.startsWith('@@ ')) {
      if (!file) throw new DiffParseError('Hunk before any file header', i + 1);
      const { hunk, next } = parseHunk(lines, i);
      file.hunks.push(hunk);
      i = next;
      continue;
    }

    if (file) {
      if (applyExtendedHeader(file, line)) {
        i++;
        continue;
      }
      if (line === 'GIT binary patch') {
        file.binary = true;
        i++;
        while (i < lines.length && !(lines[i] as string).startsWith('diff --git ')) i++;
        continue;
      }
    }
    // Preamble text (commit messages from `git format-patch`, blank lines) is ignored.
    i++;
  }

  return { files, crlf };
}

type HeaderRule = [RegExp, (file: DiffFile, groups: string[]) => void];

/** Git extended header lines, in the order git writes them. Paths in rename and copy lines have no prefix. */
const HEADER_RULES: HeaderRule[] = [
  [/^old mode (\d+)$/, (f, [mode]) => (f.oldMode = mode as string)],
  [/^new mode (\d+)$/, (f, [mode]) => (f.newMode = mode as string)],
  [
    /^new file mode (\d+)$/,
    (f, [mode]) => {
      f.status = 'added';
      f.newMode = mode as string;
      f.oldPath = null;
    },
  ],
  [
    /^deleted file mode (\d+)$/,
    (f, [mode]) => {
      f.status = 'deleted';
      f.oldMode = mode as string;
      f.newPath = null;
    },
  ],
  [
    /^(rename|copy) from (.+)$/,
    (f, [verb, path]) => {
      f.status = verb === 'rename' ? 'renamed' : 'copied';
      f.oldPath = cleanPath(path as string, null);
    },
  ],
  [
    /^(rename|copy) to (.+)$/,
    (f, [verb, path]) => {
      f.status = verb === 'rename' ? 'renamed' : 'copied';
      f.newPath = cleanPath(path as string, null);
    },
  ],
  [/^(?:similarity|dissimilarity) index (\d+)%$/, (f, [pct]) => (f.similarity = Number(pct))],
  [
    /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?$/,
    (f, [oldId, newId, mode]) => {
      f.index = mode
        ? { old: oldId as string, new: newId as string, mode }
        : { old: oldId as string, new: newId as string };
    },
  ],
  [/^Binary files .* differ$/, (f) => (f.binary = true)],
];

function applyExtendedHeader(file: DiffFile, line: string): boolean {
  for (const [re, apply] of HEADER_RULES) {
    const m = re.exec(line);
    if (m) {
      apply(file, m.slice(1));
      return true;
    }
  }
  return false;
}

function parseHunk(lines: string[], start: number): { hunk: Hunk; next: number } {
  const header = lines[start] as string;
  const m = HUNK_RE.exec(header);
  if (!m) throw new DiffParseError(`Malformed hunk header "${header}"`, start + 1);
  const hunk: Hunk = {
    oldStart: Number(m[1]),
    oldLines: m[2] === undefined ? 1 : Number(m[2]),
    newStart: Number(m[3]),
    newLines: m[4] === undefined ? 1 : Number(m[4]),
    section: m[5] ?? '',
    lines: [],
  };
  let oldLeft = hunk.oldLines;
  let newLeft = hunk.newLines;
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  let i = start + 1;
  while (i < lines.length && (oldLeft > 0 || newLeft > 0 || (lines[i] as string).startsWith('\\'))) {
    const raw = lines[i] as string;
    const tag = raw[0];
    if (tag === '\\') {
      const prev = hunk.lines[hunk.lines.length - 1];
      if (prev) prev.noNewline = true;
      i++;
      continue;
    }
    const content = raw.slice(1);
    if (tag === ' ' || raw === '') {
      // Some tools drop the leading space on empty context lines.
      hunk.lines.push({ type: 'context', content, oldLine: oldNo++, newLine: newNo++ });
      oldLeft--;
      newLeft--;
    } else if (tag === '-') {
      hunk.lines.push({ type: 'del', content, oldLine: oldNo++ });
      oldLeft--;
    } else if (tag === '+') {
      hunk.lines.push({ type: 'add', content, newLine: newNo++ });
      newLeft--;
    } else {
      throw new DiffParseError(`Unexpected line in hunk: "${raw.slice(0, 40)}"`, i + 1);
    }
    if (oldLeft < 0 || newLeft < 0)
      throw new DiffParseError('Hunk has more lines than its header says', i + 1);
    i++;
  }
  if (oldLeft > 0 || newLeft > 0) throw new DiffParseError('Hunk ends before its header line counts', i);
  return { hunk, next: i };
}

/** The path a file is known by after the change (new path, or old path for deletions). */
export function filePath(file: DiffFile): string {
  return (file.newPath ?? file.oldPath) as string;
}
