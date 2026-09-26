import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../main.js';
import { memoryIo } from '../testing.js';

let dir: string;

const io = (cwd = dir) => memoryIo(cwd);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'remit-cli-'));
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'totals.test.ts'), "it('totals', () => {\n  expect(total).toEqual(42);\n});\n");
  writeFileSync(join(dir, '.gitattributes'), 'gen.ts linguist-generated\n');
  writeFileSync(join(dir, 'gen.ts'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  writeFileSync(join(dir, 'totals.test.ts'), "it('totals', () => {\n  expect(total).toBeDefined();\n});\n");
  writeFileSync(join(dir, 'gen.ts'), 'export const a = 2;\n');
  git('commit', '-qam', 'head');
  writeFileSync(join(dir, 'change.patch'), execFileSync('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: dir }));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('remit units', () => {
  it('prints a table of units and facts for a git range', async () => {
    const r = io();
    expect(await main(['units', '--diff', 'HEAD~1..HEAD'], r.sink)).toBe(0);
    expect(r.out).toMatch(/U1\s+generated\s+gen\.ts:1\s+-\s+filtered \(generated\)/);
    expect(r.out).toMatch(/U2\s+test\s+totals\.test\.ts:2\s+test totals.*X1 assertion_weakened \[high\]/);
    expect(r.out).toContain('2 units, 1 facts');
  });

  it('prints JSON with --json', async () => {
    const r = io();
    expect(await main(['units', '--diff', 'HEAD~1...HEAD', '--json'], r.sink)).toBe(0);
    const json = JSON.parse(r.out);
    expect(json.units).toHaveLength(2);
    expect(json.units[1].facts[0]).toMatchObject({ id: 'X1', kind: 'assertion_weakened', unitId: 'U2' });
  });

  it('reads a diff file', async () => {
    const r = io();
    expect(await main(['units', '--diff', 'change.patch', '--json'], r.sink)).toBe(0);
    expect(JSON.parse(r.out).units.map((u: { file: string }) => u.file)).toEqual([
      'gen.ts',
      'totals.test.ts',
    ]);
  });

  it.each([
    [['units'], /needs --diff/],
    [['units', '--diff', 'nope'], /neither a file nor a git range/],
    [['units', '--diff', 'main..missing'], /Cannot find commit "missing"/],
    [['units', '--bogus'], /Unknown option/],
    [['frobnicate'], /Unknown command "frobnicate"/],
  ])('exits 2 with a fix for %j', async (argv, message) => {
    const r = io();
    expect(await main(argv, r.sink)).toBe(2);
    expect(r.err).toMatch(message);
  });

  it('explains unreadable diffs', async () => {
    writeFileSync(join(dir, 'bad.patch'), '--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n');
    const r = io();
    expect(await main(['units', '--diff', 'bad.patch'], r.sink)).toBe(2);
    expect(r.err).toMatch(/could not be read/);
  });

  it('prints usage', async () => {
    const r = io();
    expect(await main(['--help'], r.sink)).toBe(0);
    expect(r.out).toMatch(/Usage: remit <command>/);
    const r2 = io();
    expect(await main([], r2.sink)).toBe(2);
  });
});
