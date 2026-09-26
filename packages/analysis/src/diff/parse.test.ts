import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type DiffFile, DiffParseError, filePath, type Hunk, type HunkLine, parseDiff } from './parse.js';
import { renderDiff } from './render.js';

const MODIFIED = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@ export function f() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 return a;
`;

describe('parseDiff', () => {
  it('parses a modified file with line numbers', () => {
    const { files, crlf } = parseDiff(MODIFIED);
    expect(crlf).toBe(false);
    expect(files).toHaveLength(1);
    const f = files[0] as DiffFile;
    expect(f).toMatchObject({ oldPath: 'src/a.ts', newPath: 'src/a.ts', status: 'modified', binary: false });
    expect(f.index).toEqual({ old: '1111111', new: '2222222', mode: '100644' });
    const h = f.hunks[0] as Hunk;
    expect(h).toMatchObject({
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      section: 'export function f() {',
    });
    expect(h.lines.map((l) => [l.type, l.oldLine, l.newLine])).toEqual([
      ['context', 1, 1],
      ['del', 2, undefined],
      ['add', undefined, 2],
      ['add', undefined, 3],
      ['context', 3, 4],
    ]);
  });

  it('returns no files for an empty diff', () => {
    expect(parseDiff('')).toEqual({ files: [], crlf: false });
    expect(parseDiff('\n\n').files).toEqual([]);
  });

  it('parses new and deleted files', () => {
    const text = `diff --git a/new.py b/new.py
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/new.py
@@ -0,0 +1,2 @@
+def f():
+    return 1
diff --git a/old.rs b/old.rs
deleted file mode 100755
index abcdef1..0000000
--- a/old.rs
+++ /dev/null
@@ -1 +0,0 @@
-fn main() {}
`;
    const [added, deleted] = parseDiff(text).files as [DiffFile, DiffFile];
    expect(added).toMatchObject({ oldPath: null, newPath: 'new.py', status: 'added', newMode: '100644' });
    expect(added.hunks[0]?.lines).toHaveLength(2);
    expect(deleted).toMatchObject({ oldPath: 'old.rs', newPath: null, status: 'deleted', oldMode: '100755' });
    expect(deleted.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 1, newStart: 0, newLines: 0 });
    expect(filePath(deleted)).toBe('old.rs');
  });

  it('parses a pure rename and a rename with edits', () => {
    const text = `diff --git a/a/x.ts b/b/y.ts
similarity index 100%
rename from a/x.ts
rename to b/y.ts
diff --git a/lib/u.ts b/lib/v.ts
similarity index 88%
rename from lib/u.ts
rename to lib/v.ts
index 1..2 100644
--- a/lib/u.ts
+++ b/lib/v.ts
@@ -1 +1 @@
-export const u = 1;
+export const v = 1;
`;
    const [pure, edited] = parseDiff(text).files as [DiffFile, DiffFile];
    // Rename lines carry no a/ b/ prefix, so a real directory named "a" survives.
    expect(pure).toMatchObject({
      oldPath: 'a/x.ts',
      newPath: 'b/y.ts',
      status: 'renamed',
      similarity: 100,
      hunks: [],
    });
    expect(edited).toMatchObject({
      oldPath: 'lib/u.ts',
      newPath: 'lib/v.ts',
      status: 'renamed',
      similarity: 88,
    });
    expect(edited.hunks).toHaveLength(1);
  });

  it('parses copies and mode changes', () => {
    const text = `diff --git a/s.sh b/s.sh
old mode 100644
new mode 100755
diff --git a/a.txt b/c.txt
similarity index 90%
copy from a.txt
copy to c.txt
`;
    const [mode, copy] = parseDiff(text).files as [DiffFile, DiffFile];
    expect(mode).toMatchObject({ status: 'modified', oldMode: '100644', newMode: '100755', hunks: [] });
    expect(copy).toMatchObject({ status: 'copied', oldPath: 'a.txt', newPath: 'c.txt' });
  });

  it('marks binary files from both marker styles', () => {
    const text = `diff --git a/logo.png b/logo.png
index 1..2 100644
Binary files a/logo.png and b/logo.png differ
diff --git a/font.woff b/font.woff
index 3..4
GIT binary patch
literal 12
zcmZ?wbhEHbWMp7uXkcJqU|?VXVkQO#Afp0^

literal 0
HcmV?d00001

diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-a
+b
`;
    const files = parseDiff(text).files;
    expect(files.map((f) => [filePath(f), f.binary])).toEqual([
      ['logo.png', true],
      ['font.woff', true],
      ['b.ts', false],
    ]);
  });

  it('records "No newline at end of file" on the right line', () => {
    const text = `--- a/x
+++ b/x
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;
    const lines = parseDiff(text).files[0]?.hunks[0]?.lines as HunkLine[];
    expect(lines.map((l) => [l.type, l.noNewline])).toEqual([
      ['del', true],
      ['add', true],
    ]);
  });

  it('handles CRLF diffs', () => {
    const text = MODIFIED.replace(/\n/g, '\r\n');
    const parsed = parseDiff(text);
    expect(parsed.crlf).toBe(true);
    expect(parsed.files[0]?.hunks[0]?.lines[1]?.content).toBe('const b = 2;');
    expect(renderDiff(parsed)).toContain('\r\n');
  });

  it('parses plain (non-git) diffs with several files and timestamps', () => {
    const text = `--- a/one.txt\t2026-01-01 00:00:00
+++ b/one.txt\t2026-01-02 00:00:00
@@ -1 +1 @@
-1
+2
--- a/two.txt
+++ b/two.txt
@@ -1 +1,2 @@
 x
+y
`;
    const files = parseDiff(text).files;
    expect(files.map(filePath)).toEqual(['one.txt', 'two.txt']);
  });

  it('does not treat header-looking content inside a hunk as a header', () => {
    const text = `diff --git a/doc.md b/doc.md
--- a/doc.md
+++ b/doc.md
@@ -1,2 +1,3 @@
 intro
+--- a/fake
 diff --git a/nope b/nope
`;
    const files = parseDiff(text).files;
    expect(files).toHaveLength(1);
    expect(files[0]?.hunks[0]?.lines.map((l) => l.content)).toEqual([
      'intro',
      '--- a/fake',
      'diff --git a/nope b/nope',
    ]);
  });

  it('reads quoted paths with escapes', () => {
    const text = `diff --git "a/my file\\t.txt" "b/my file\\t.txt"
--- "a/my file\\t.txt"
+++ "b/my file\\t.txt"
@@ -1 +1 @@
-a
+b
`;
    expect(parseDiff(text).files[0]?.newPath).toBe('my file\t.txt');
  });

  it('reads unquoted paths with spaces', () => {
    const text = `diff --git a/dir with space/f.ts b/dir with space/f.ts
old mode 100644
new mode 100755
`;
    expect(parseDiff(text).files[0]?.newPath).toBe('dir with space/f.ts');
  });

  it('accepts empty context lines without the leading space', () => {
    const text = '--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n';
    expect(parseDiff(text).files[0]?.hunks[0]?.lines.map((l) => l.type)).toEqual([
      'context',
      'context',
      'del',
      'add',
    ]);
  });

  it('ignores format-patch preamble', () => {
    const text = `From abc Mon Sep 17 00:00:00 2001
Subject: [PATCH] thing

---
 x | 2 +-

${MODIFIED}`;
    expect(parseDiff(text).files).toHaveLength(1);
  });

  it.each([
    ['a hunk before any file', '@@ -1 +1 @@\n-a\n+b\n', /Hunk before any file header/],
    ['a truncated hunk', '--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n', /Hunk ends before/],
    ['a stray line in a hunk', '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n?b\n', /Unexpected line in hunk/],
    ['a malformed hunk header', '--- a/x\n+++ b/x\n@@ -a +b @@\n', /Malformed hunk header/],
    ['a bad git header', 'diff --git nothing\n', /Cannot read paths/],
  ])('rejects %s', (_name, text, message) => {
    expect(() => parseDiff(text)).toThrow(DiffParseError);
    expect(() => parseDiff(text)).toThrow(message);
  });
});

// Property: rendering any parsed diff and parsing it again gives the same structure.
const safeText = fc.string({ maxLength: 12 }).map((s) => s.replace(/[\r\n]/g, ''));
const pathArb = fc
  .array(fc.stringMatching(/^[a-z0-9_]{1,6}$/), { minLength: 1, maxLength: 3 })
  .map((parts) => `${parts.join('/')}.ts`);

const hunkArb = fc
  .array(fc.tuple(fc.constantFrom<'context' | 'add' | 'del'>('context', 'add', 'del'), safeText), {
    minLength: 1,
    maxLength: 8,
  })
  .chain((rows) =>
    fc.record({
      oldStart: fc.integer({ min: 1, max: 500 }),
      newStart: fc.integer({ min: 1, max: 500 }),
      rows: fc.constant(rows),
      section: safeText.map((s) => s.trim()),
    }),
  )
  .map(({ oldStart, newStart, rows, section }): Hunk => {
    let o = oldStart;
    let n = newStart;
    const lines: HunkLine[] = rows.map(([type, content]) => {
      if (type === 'context') return { type, content, oldLine: o++, newLine: n++ };
      if (type === 'del') return { type, content, oldLine: o++ };
      return { type, content, newLine: n++ };
    });
    return {
      oldStart,
      newStart,
      oldLines: rows.filter(([t]) => t !== 'add').length,
      newLines: rows.filter(([t]) => t !== 'del').length,
      section,
      lines,
    };
  });

const fileArb = fc
  .record({
    path: pathArb,
    other: pathArb,
    kind: fc.constantFrom('modified', 'renamed', 'binary'),
    hunks: fc.array(hunkArb, { minLength: 1, maxLength: 3 }),
  })
  .map(({ path, other, kind, hunks }): DiffFile => {
    if (kind === 'binary')
      return { oldPath: path, newPath: path, status: 'modified', binary: true, hunks: [] };
    if (kind === 'renamed' && other !== path) {
      return { oldPath: path, newPath: other, status: 'renamed', similarity: 90, binary: false, hunks };
    }
    return { oldPath: path, newPath: path, status: 'modified', binary: false, hunks };
  });

describe('parse, render, parse again (property)', () => {
  it('is stable for generated diffs', () => {
    fc.assert(
      fc.property(fc.array(fileArb, { maxLength: 4 }), fc.boolean(), (files, crlf) => {
        const model = { files, crlf: crlf && files.length > 0 };
        const once = parseDiff(renderDiff(model));
        expect(once).toEqual(model);
        expect(parseDiff(renderDiff(once))).toEqual(once);
      }),
      { numRuns: 300 },
    );
  });

  it('is stable for the hand-written fixtures', () => {
    const parsed = parseDiff(MODIFIED);
    expect(parseDiff(renderDiff(parsed))).toEqual(parsed);
  });
});
