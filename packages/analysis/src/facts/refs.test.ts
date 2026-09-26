import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitGrepReferences } from './refs.js';

let dir: string;
let head: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'remit-refs-'));
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/export.ts'), 'export function toCsv() {}\nexport function used() {}\n');
  writeFileSync(join(dir, 'src/app.ts'), "import { used } from './export';\nused();\n");
  writeFileSync(join(dir, 'src/export.test.ts'), "import { toCsv } from './export';\ntoCsv();\n");
  git('add', '.');
  git('commit', '-qm', 'c');
  head = git('rev-parse', 'HEAD').trim();
  // Working-tree only change, invisible at the commit.
  writeFileSync(join(dir, 'src/later.ts'), "import { toCsv } from './export';\n");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('GitGrepReferences', () => {
  it('ignores tests and the definition line at a commit', async () => {
    const refs = new GitGrepReferences(dir, head);
    expect(await refs.count('toCsv', { file: 'src/export.ts', line: 1 })).toBe(0);
    expect(await refs.count('used', { file: 'src/export.ts', line: 2 })).toBe(2);
  });

  it('returns 0 when nothing matches', async () => {
    expect(await new GitGrepReferences(dir, head).count('nowhere', { file: 'x', line: 1 })).toBe(0);
  });

  it('searches tracked working-tree files without a sha', async () => {
    execFileSync('git', ['add', 'src/later.ts'], { cwd: dir });
    expect(await new GitGrepReferences(dir).count('toCsv', { file: 'src/export.ts', line: 1 })).toBe(1);
  });

  it('returns null for odd names or outside a repository', async () => {
    expect(await new GitGrepReferences(dir, head).count('a-b', { file: 'x', line: 1 })).toBeNull();
    expect(await new GitGrepReferences(tmpdir(), head).count('x', { file: 'x', line: 1 })).toBeNull();
  });
});
