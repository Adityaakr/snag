import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkTests, lastMilestoneTag } from '../guards/tests-guard.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(): { dir: string; git: (...a: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'remit-tguard-'));
  dirs.push(dir);
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  mkdirSync(join(dir, '.agent'));
  writeFileSync(join(dir, '.agent', 'DECISIONS.md'), '# Decisions\n');
  writeFileSync(join(dir, 'totals.test.ts'), "it('totals', () => {\n  expect(total).toEqual(42);\n});\n");
  git('add', '.');
  git('commit', '-qm', 'base');
  git('tag', 'm1-done');
  return { dir, git };
}

describe('guard:tests', () => {
  it('passes with no tag, and with no test changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'remit-tguard-'));
    dirs.push(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    expect(lastMilestoneTag(dir)).toBeNull();
    expect(await checkTests(dir)).toEqual({ problems: [], note: 'no m*-done tag yet; nothing to compare' });
    const r = repo();
    expect((await checkTests(r.dir)).problems).toEqual([]);
  });

  it('fails on a weakened assertion in the working tree, before it is committed', async () => {
    const { dir } = repo();
    writeFileSync(join(dir, 'totals.test.ts'), "it('totals', () => {\n  expect(total).toBeDefined();\n});\n");
    const { problems } = await checkTests(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^totals\.test\.ts:2 assertion_weakened: .*since m1-done/);
  });

  it('allows a finding when DECISIONS.md names the file and line with a reason', async () => {
    const { dir } = repo();
    writeFileSync(join(dir, 'totals.test.ts'), "it('totals', () => {\n  expect(total).toBeDefined();\n});\n");
    writeFileSync(
      join(dir, '.agent', 'DECISIONS.md'),
      '# Decisions\n- guard:tests allow totals.test.ts:2: the total is random by design now\n',
    );
    expect((await checkTests(dir)).problems).toEqual([]);
  });

  it('checks committed changes since the tag and new untracked test files', async () => {
    const { dir, git } = repo();
    writeFileSync(
      join(dir, 'totals.test.ts'),
      "it.skip('totals', () => {\n  expect(total).toEqual(42);\n});\n",
    );
    git('commit', '-qam', 'skip');
    writeFileSync(join(dir, 'new.test.ts'), "it.only('focus', () => {\n  expect(1).toBe(1);\n});\n");
    const kinds = (await checkTests(dir)).problems.map((p) => p.split(' ')[1]);
    expect(kinds.sort()).toEqual(['test_focused:', 'test_skipped:']);
  });

  it('ignores fixture trees and eval corpora, which are review inputs', async () => {
    const { dir } = repo();
    mkdirSync(join(dir, 'fixtures', 'golden', 'x', 'head'), { recursive: true });
    mkdirSync(join(dir, 'eval', 'corpora', 'mutations'), { recursive: true });
    writeFileSync(join(dir, 'fixtures', 'golden', 'x', 'head', 'a.test.ts'), "it.skip('x', () => {});\n");
    writeFileSync(join(dir, 'eval', 'corpora', 'mutations', 'b.test.ts'), "it.only('y', () => {});\n");
    writeFileSync(join(dir, 'real.test.ts'), "it.only('z', () => {});\n");
    expect((await checkTests(dir)).problems.map((p) => p.split(':')[0])).toEqual(['real.test.ts']);
  });

  it('ignores warn-level facts and non-test files', async () => {
    const { dir } = repo();
    writeFileSync(join(dir, 'totals.test.ts'), "it('totals', () => {\n  expect(total).toEqual(43);\n});\n");
    writeFileSync(join(dir, 'src.ts'), 'export const a = 1; // @ts-ignore\n');
    expect((await checkTests(dir)).problems).toEqual([]);
  });
});
