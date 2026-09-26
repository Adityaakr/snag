import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { checkProtected, parseManifest, sha256 } from '../guards/protected.mjs';
// @ts-expect-error plain ESM script without type declarations
import { checkSecrets, scanText } from '../guards/secrets.mjs';

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function kit(files: Record<string, string>, manifest?: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'remit-guard-'));
  temps.push(dir);
  mkdirSync(join(dir, '.agent'));
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
  const m = manifest ?? Object.fromEntries(Object.entries(files).map(([f, c]) => [f, sha256(c)]));
  writeFileSync(
    join(dir, '.agent', 'protected.sha256'),
    Object.entries(m)
      .map(([f, h]) => `${h}  ${f}`)
      .join('\n'),
  );
  return dir;
}

const BASE = { 'BUILD_PROMPT.md': 'spec', 'GOAL.txt': 'goal', 'loop.sh': 'loop', 'START_HERE.md': 'start' };

describe('guard:protected', () => {
  it('passes when hashes match', () => {
    expect(checkProtected(kit(BASE))).toEqual([]);
  });

  it('fails when a protected file changes', () => {
    const dir = kit(BASE);
    writeFileSync(join(dir, 'GOAL.txt'), 'goal, edited');
    expect(checkProtected(dir)).toEqual([expect.stringMatching(/^GOAL\.txt was modified/)]);
  });

  it('fails when the manifest is missing', () => {
    const dir = kit(BASE);
    rmSync(join(dir, '.agent', 'protected.sha256'));
    expect(checkProtected(dir)).toEqual(['.agent/protected.sha256 is missing']);
  });

  it('treats START_HERE.md as optional when absent from both', () => {
    const { 'START_HERE.md': _omit, ...rest } = BASE;
    expect(checkProtected(kit(rest))).toEqual([]);
  });

  it('fails when a required file is deleted', () => {
    const dir = kit(BASE);
    rmSync(join(dir, 'loop.sh'));
    expect(checkProtected(dir)).toEqual(['loop.sh is missing']);
  });

  it('parses sha256sum output', () => {
    const h = 'a'.repeat(64);
    expect(parseManifest(`${h}  GOAL.txt\n`).get('GOAL.txt')).toBe(h);
  });
});

describe('guard:secrets', () => {
  // Fake credentials are assembled at runtime so the repo itself never contains one.
  const anthropic = ['sk', 'ant', 'api03', 'x'.repeat(40)].join('-');
  const github = `ghp_${'A1b2'.repeat(10)}`;
  const pem = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
  const assigned = `TYPESAFE_API_KEY=${'z'.repeat(24)}`;

  it.each([
    ['Anthropic API key', anthropic],
    ['GitHub token', github],
    ['Private key', pem],
    ['Assigned API key', assigned],
  ])('flags a %s', (kind, secret) => {
    expect(scanText('f.ts', `const x = "${secret}";`)).toEqual([{ file: 'f.ts', line: 1, kind }]);
  });

  it.each([
    ['empty example value', 'TYPESAFE_API_KEY='],
    ['env reference', 'const key = process.env.ANTHROPIC_API_KEY;'],
    ['short sk prefix', 'the sk-ant- prefix'],
  ])('ignores %s', (_name, text) => {
    expect(scanText('f.ts', text)).toEqual([]);
  });

  it('scans a list of files and skips binaries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remit-secrets-'));
    temps.push(dir);
    writeFileSync(join(dir, 'a.txt'), `ok\n${github}\n`);
    writeFileSync(join(dir, 'b.bin'), Buffer.from([0, 1, 2, ...Buffer.from(github)]));
    expect(checkSecrets(dir, ['a.txt', 'b.bin', 'gone.txt'])).toEqual([
      { file: 'a.txt', line: 2, kind: 'GitHub token' },
    ]);
  });
});
