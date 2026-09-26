import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CostTracker, FakeGitHub, FakeJev, FakeLlm, type LiveGitHub } from '@remit/providers';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '../main.js';
import { buildProviders, cacheDir, type CliProviders } from '../providers.js';
import { memoryIo } from '../testing.js';
import { extractCommand, parseIssueTarget } from './extract.js';

const FIX = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'extraction');
const dir = mkdtempSync(join(tmpdir(), 'remit-extract-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
writeFileSync(join(dir, 'issue.md'), readFileSync(join(FIX, 'prose', 'issue.md')));

function fakes(over: Partial<CliProviders> = {}): CliProviders {
  return {
    llm: new FakeLlm(JSON.parse(readFileSync(join(FIX, 'prose', 'llm-script.json'), 'utf8'))),
    jev: new FakeJev(JSON.parse(readFileSync(join(FIX, 'prose', 'jev-script.json'), 'utf8'))),
    github: new FakeGitHub() as unknown as LiveGitHub,
    costs: new CostTracker(1),
    cacheMode: 'replay_or_live',
    notes: [],
    ...over,
  };
}

describe('remit extract', () => {
  it('prints requirements with priorities and signals for a markdown file', async () => {
    const io = memoryIo(dir);
    expect(await extractCommand(['issue.md'], io.sink, fakes())).toBe(0);
    expect(io.out).toMatch(
      /R1\s+must\s+behavior\s+amb 0\.10\s+chk 0\.95\s+"with an id that does not exist, the API must return 404"/,
    );
    expect(io.out).toMatch(/R2\s+should/);
  });

  it('reads a GitHub issue URL through the provider and prints JSON', async () => {
    const gh = new FakeGitHub().addIssue(
      { owner: 'local', repo: 'local', number: 1 },
      {
        title: 'User lookup returns the wrong status',
        body: readFileSync(join(FIX, 'prose', 'issue.md'), 'utf8')
          .split('\n')
          .slice(2)
          .join('\n')
          .trim(),
        author: 'maya',
      },
    );
    const io = memoryIo(dir);
    expect(
      await extractCommand(
        ['https://github.com/local/local/issues/1', '--json'],
        io.sink,
        fakes({ github: gh as unknown as LiveGitHub }),
      ),
    ).toBe(0);
    const json = JSON.parse(io.out);
    expect(json.requirements.map((r: { id: string }) => r.id)).toEqual(['R1', 'R2']);
    expect(gh.calls).toEqual(['getIssue local/local#1']);
  });

  it('turns provider failures into exit 3 with a fix', async () => {
    const io = memoryIo(dir);
    await expect(
      extractCommand(['issue.md'], io.sink, fakes({ llm: new FakeLlm({}) })),
    ).rejects.toMatchObject({ exitCode: 3, message: expect.stringMatching(/no script/) });
  });

  it.each([
    [[], /needs an issue/],
    [['nowhere-issue'], /neither a file nor a GitHub issue/],
    [['issue.md', '--config', 'missing.yml'], /does not exist/],
  ])('exits 2 for %j', async (argv, message) => {
    const io = memoryIo(dir);
    expect(await main(['extract', ...argv], io.sink)).toBe(2);
    expect(io.err).toMatch(message);
  });

  it('rejects an invalid config', async () => {
    writeFileSync(join(dir, 'bad.yml'), 'mode: nope\n');
    const io = memoryIo(dir);
    expect(await main(['extract', 'issue.md', '--config', 'bad.yml'], io.sink)).toBe(2);
    expect(io.err).toMatch(/config is invalid/);
  });

  it('parses issue targets', () => {
    expect(parseIssueTarget('https://github.com/acme/app/issues/12')).toEqual({
      owner: 'acme',
      repo: 'app',
      number: 12,
    });
    expect(parseIssueTarget('acme/app#3')).toEqual({ owner: 'acme', repo: 'app', number: 3 });
    expect(parseIssueTarget('https://evil.example/acme/app/issues/1')).toBeNull();
  });
});

describe('buildProviders', () => {
  it('creates live providers only when keys are set and explains what is missing', async () => {
    const { parseConfig, ExtractionOutputSchema } = await import('@remit/core');
    const cfg = parseConfig('').config;
    const none = buildProviders(cfg, { REMIT_CACHE_DIR: dir });
    expect(none.llm).toBeUndefined();
    expect(none.jev).toBeUndefined();
    expect(none.notes.join('\n')).toMatch(/ANTHROPIC_API_KEY is not set[\s\S]*TYPESAFE_API_KEY is not set/);
    const keyed = buildProviders(cfg, {
      REMIT_CACHE_DIR: dir,
      ANTHROPIC_API_KEY: 'k',
      TYPESAFE_API_KEY: 'k',
    });
    expect(keyed.llm?.model).toBe('claude-opus-5-5');
    expect(keyed.jev?.model).toBe('jev-1.13.0');
    expect(keyed.cacheMode).toBe('replay_or_live');
    const offline = buildProviders(cfg, { REMIT_CACHE_DIR: dir, ANTHROPIC_API_KEY: 'k' }, { offline: true });
    expect(offline.cacheMode).toBe('replay');
    await expect(
      offline.llm?.structured(ExtractionOutputSchema, [], {
        schemaName: 's',
        system: '',
        promptVersion: 'x',
      }),
    ).rejects.toMatchObject({ kind: 'cache_miss' });
  });

  it('keeps the cache outside the repository by default', () => {
    expect(cacheDir({ XDG_CACHE_HOME: '/c' })).toBe('/c/remit');
    expect(cacheDir({ REMIT_CACHE_DIR: '/x' })).toBe('/x');
  });
});
