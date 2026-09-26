import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSplit, freeze, testFiles } from '../guards/split.mjs';

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'remit-split-'));
  const put = (rel: string, text: string) => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put('eval/corpora/mutations/test/a.json', '{"a":1}');
  put('eval/corpora/mutations/dev/b.json', '{"b":1}');
  put('eval/corpora/swebench/test/c.json', '{"c":1}');
  return { root, put };
}

describe('guard:split', () => {
  it('lists only test-split files', () => {
    const { root } = repo();
    expect(testFiles(root)).toEqual([
      'eval/corpora/mutations/test/a.json',
      'eval/corpora/swebench/test/c.json',
    ]);
  });

  it('requires a freeze once test files exist, then passes', () => {
    const { root } = repo();
    expect(checkSplit(root)[0]).toMatch(/missing/);
    expect(freeze(root)).toBe(2);
    expect(checkSplit(root)).toEqual([]);
  });

  it('fails on changed, missing and new test files, and dev files may change freely', () => {
    const { root, put } = repo();
    freeze(root);
    put('eval/corpora/mutations/dev/b.json', '{"b":2}');
    expect(checkSplit(root)).toEqual([]);
    put('eval/corpora/mutations/test/a.json', '{"a":2}');
    rmSync(join(root, 'eval/corpora/swebench/test/c.json'));
    put('eval/corpora/shadow/test/d.json', '{}');
    expect(checkSplit(root)).toEqual([
      'eval/corpora/mutations/test/a.json changed after the freeze',
      'eval/corpora/swebench/test/c.json is frozen but missing',
      'eval/corpora/shadow/test/d.json is not in eval/corpora/test.sha256',
    ]);
  });

  it('never rewrites a freeze; --append adds only new files', () => {
    const { root, put } = repo();
    freeze(root);
    expect(() => freeze(root)).toThrow(/already exists/);
    put('eval/corpora/mutations/test/a.json', '{"a":2}');
    put('eval/corpora/shadow/test/d.json', '{}');
    expect(freeze(root, { append: true })).toBe(1);
    expect(checkSplit(root)).toEqual(['eval/corpora/mutations/test/a.json changed after the freeze']);
  });

  it('passes when nothing exists yet', () => {
    expect(checkSplit(mkdtempSync(join(tmpdir(), 'remit-split-')))).toEqual([]);
  });
});

describe('guard:split after the freeze tag', () => {
  it('keeps the tagged manifest append-only, so re-freezing cannot hide a change', async () => {
    const { execFileSync } = await import('node:child_process');
    const { root, put } = repo();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git('init', '-q');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
    freeze(root);
    git('add', '-A');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'freeze');
    git('tag', 'm6-done');
    expect(checkSplit(root)).toEqual([]);
    put('eval/corpora/mutations/test/a.json', '{"a":2}');
    rmSync(join(root, 'eval/corpora/test.sha256'));
    freeze(root);
    expect(checkSplit(root)).toEqual([
      'eval/corpora/mutations/test/a.json: eval/corpora/test.sha256 differs from the m6-done freeze',
    ]);
    rmSync(join(root, 'eval/corpora/test.sha256'));
    expect(checkSplit(root)).toContain(
      'eval/corpora/swebench/test/c.json: eval/corpora/test.sha256 differs from the m6-done freeze',
    );
  });
});
