import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDiff } from '../diff/parse.js';
import { GitError, LocalGit, MAX_FILE_BYTES, parseRange } from './local.js';

let dir: string;
let git: LocalGit;
const run = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'remit-git-'));
  run('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  writeFileSync(
    join(dir, 'old.ts'),
    'export const moved = true;\nexport const x = 1;\nexport const y = 2;\n',
  );
  run('add', '.');
  run('commit', '-qm', 'base');
  run('tag', 'v0');
  run('switch', '-qc', 'feature');
  writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n');
  run('mv', 'old.ts', 'new.ts');
  writeFileSync(join(dir, 'big.txt'), 'x'.repeat(MAX_FILE_BYTES + 1));
  writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3]));
  run('add', '.');
  run('commit', '-qm', 'feature');
  run('switch', '-q', 'main');
  writeFileSync(join(dir, 'main-only.ts'), 'export const m = 1;\n');
  run('add', '.');
  run('commit', '-qm', 'main moves on');
  git = new LocalGit(dir);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('parseRange', () => {
  it.each([
    ['main..feature', { base: 'main', head: 'feature', mergeBase: false }],
    ['main...feature', { base: 'main', head: 'feature', mergeBase: true }],
    ['v0..HEAD~1', { base: 'v0', head: 'HEAD~1', mergeBase: false }],
  ])('parses %s', (text, expected) => {
    expect(parseRange(text)).toEqual(expected);
  });

  it.each(['main', 'main....feature', '..feature', 'diff.patch', 'a..b..c'])('rejects %s', (text) => {
    expect(parseRange(text)).toBeNull();
  });
});

describe('LocalGit', () => {
  it('diffs base..head directly (includes changes made on base)', () => {
    const d = git.diff({ base: 'main', head: 'feature', mergeBase: false });
    const paths = parseDiff(d.text).files.map((f) => f.newPath ?? f.oldPath);
    expect(paths).toContain('main-only.ts'); // deleted relative to main's tip
    expect(d.baseSha).toBe(git.resolve('main'));
  });

  it('diffs base...head against the merge base like a pull request', () => {
    const d = git.diff({ base: 'main', head: 'feature', mergeBase: true });
    const files = parseDiff(d.text).files;
    expect(files.map((f) => f.newPath ?? f.oldPath)).not.toContain('main-only.ts');
    expect(d.baseSha).toBe(git.resolve('v0'));
    const renamed = files.find((f) => f.status === 'renamed');
    expect(renamed).toMatchObject({ oldPath: 'old.ts', newPath: 'new.ts' });
  });

  it('reads file contents at both SHAs', () => {
    const d = git.diff({ base: 'main', head: 'feature', mergeBase: true });
    expect(git.show(d.baseSha, 'a.ts')).toEqual({ content: 'export const a = 1;\n' });
    expect(git.show(d.headSha, 'a.ts')).toEqual({ content: 'export const a = 2;\n' });
    expect(git.show(d.baseSha, 'new.ts')).toBeNull();
  });

  it('skips files over 1 MB and binary files', () => {
    const head = git.resolve('feature');
    expect(git.show(head, 'big.txt')).toEqual({ skipped: 'too_large' });
    expect(git.show(head, 'bin.dat')).toEqual({ skipped: 'binary' });
  });

  it('lists files at a commit', () => {
    expect(git.listFiles(git.resolve('feature')).sort()).toEqual(['a.ts', 'big.txt', 'bin.dat', 'new.ts']);
  });

  it('rejects option-like and unknown refs with a fix hint', () => {
    expect(() => git.resolve('--output=/tmp/x')).toThrow(GitError);
    expect(() => git.resolve('nope-branch')).toThrow(/Cannot find commit "nope-branch"/);
  });

  it('reports a missing common ancestor', () => {
    run('switch', '-q', '--orphan', 'lonely');
    writeFileSync(join(dir, 'z.ts'), 'z\n');
    run('add', 'z.ts');
    run('commit', '-qm', 'orphan');
    run('switch', '-q', 'main');
    expect(() => git.diff({ base: 'main', head: 'lonely', mergeBase: true })).toThrow(/no common ancestor/);
  });

  it('explains failures outside a repository', () => {
    const outside = new LocalGit(tmpdir());
    expect(() => outside.listFiles('HEAD')).toThrow(/Check that you are inside a git repository/);
  });
});
