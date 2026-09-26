import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, parseConfig, type ReviewResult, ReviewResultSchema } from '@remit/core';
import {
  type CallMeta,
  CostTracker,
  FakeGitHub,
  type JevProvider,
  type LiveGitHub,
  ProviderError,
  type Questions,
} from '@remit/providers';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT } from '../errors.js';
import { main } from '../main.js';
import type { CliProviders } from '../providers.js';
import { memoryIo } from '../testing.js';
import { DEMO_SCENARIOS, demoCommand } from './demo.js';
import { CONFIG_TEMPLATE, initCommand } from './init.js';
import { exitCodeFor, reviewCommand } from './review.js';

const GOLDEN = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'golden',
  'three_reqs_one_missing',
);
const dir = mkdtempSync(join(tmpdir(), 'remit-review-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
writeFileSync(join(dir, 'issue.md'), readFileSync(join(GOLDEN, 'issue.md')));
writeFileSync(join(dir, 'change.patch'), readFileSync(join(GOLDEN, 'diff.patch')));
writeFileSync(join(dir, 'pr.md'), readFileSync(join(GOLDEN, 'pr-body.md')));
writeFileSync(join(dir, '.remit.yml'), 'extraction:\n  mode: tasklist_only\n');

/** Answers every forward call as missing, everything else neutrally; records calls. */
class TestJev implements JevProvider {
  readonly model = 'jev-1.13.0';
  readonly calls: CallMeta[] = [];
  constructor(private readonly fail?: ProviderError) {}
  async ask<Q extends Questions>(meta: CallMeta, _s: unknown, questions: Q) {
    this.calls.push(meta);
    if (this.fail) throw this.fail;
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(questions)) {
      if (q.type === 'noul')
        answers[id] = {
          type: 'noul',
          noul: id === 'checkable_in_code' ? 0.9 : id === 'claims_done' ? 0.9 : 0.1,
        };
      else if (q.type === 'choice') {
        const keys = Object.keys(q.criteria);
        const pick = keys.includes('none') ? 'none' : (keys[0] as string);
        answers[id] = {
          type: 'choice',
          choice: pick,
          confidence: 1,
          probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 1 : 0])),
        };
      } else
        answers[id] = {
          type: 'score',
          score: 0,
          confidence: 0.9,
          legend: {},
          probabilities: { '0': 0.95, '1': 0.05, '2': 0, '3': 0 },
        };
    }
    return {
      answers: answers as never,
      model: this.model,
      usage: { inputTokens: 1, outputTokens: 0 },
      costUsd: 0,
      cached: false,
    };
  }
}

const providers = (over: Partial<CliProviders> = {}): CliProviders => ({
  jev: new TestJev(),
  github: new FakeGitHub() as unknown as LiveGitHub,
  costs: new CostTracker(1),
  cacheMode: 'live',
  notes: [],
  ...over,
});
const LOCAL = ['--issue', 'issue.md', '--diff', 'change.patch', '--pr-body', 'pr.md'];

describe('remit review', () => {
  it('reviews locally and prints the terminal table (exit 0)', async () => {
    const io = memoryIo(dir);
    expect(await reviewCommand(LOCAL, io.sink, providers())).toBe(EXIT.ok);
    expect(io.out).toMatch(/R3\s+❌ MISSING/);
    expect(io.out).toMatch(/P0 send back/);
  });

  it('prints a valid ReviewResult with --json, the comment with --markdown and SARIF with --sarif', async () => {
    const j = memoryIo(dir);
    await reviewCommand([...LOCAL, '--json'], j.sink, providers());
    const result = ReviewResultSchema.parse(JSON.parse(j.out));
    expect(result.input.mode).toBe('local');
    const m = memoryIo(dir);
    await reviewCommand([...LOCAL, '--markdown'], m.sink, providers());
    expect(m.out).toMatch(/<!-- remit:summary v1 review=rv_/);
    const s = memoryIo(dir);
    await reviewCommand([...LOCAL, '--sarif'], s.sink, providers());
    expect(JSON.parse(s.out).version).toBe('2.1.0');
  });

  it('writes every output with --out', async () => {
    const io = memoryIo(dir);
    await reviewCommand([...LOCAL, '--out', 'out'], io.sink, providers());
    for (const f of ['review.json', 'comment.md', 'review.sarif', 'terminal.txt', 'rework.md'])
      expect(existsSync(join(dir, 'out', f)), f).toBe(true);
  });

  it('explains one finding with --explain, and fails for unknown ids', async () => {
    const io = memoryIo(dir);
    await reviewCommand([...LOCAL, '--explain', 'F-R3'], io.sink, providers());
    expect(io.out).toMatch(/^F-R3 \(requirement\) P0 route send back/);
    expect(io.out).toMatch(/forward\.v0 coverage/);
    expect(io.out).toMatch(/thresholds:\n\s+full=0\.6/);
    await expect(
      reviewCommand([...LOCAL, '--explain', 'F-R99'], memoryIo(dir).sink, providers()),
    ).rejects.toMatchObject({ exitCode: EXIT.usage });
  });

  it('estimates without calling anything with --dry-run', async () => {
    const jev = new TestJev();
    const io = memoryIo(dir);
    expect(await reviewCommand([...LOCAL, '--dry-run'], io.sink, providers({ jev }))).toBe(EXIT.ok);
    expect(jev.calls).toEqual([]);
    expect(io.out).toMatch(/^Dry run: about \d+ calls/);
    expect(io.out).toMatch(/Estimated cost \$\d/);
  });

  it('reviews a GitHub PR through the provider', async () => {
    const gh = new FakeGitHub()
      .addPull(
        { owner: 'acme', repo: 'reports', number: 58 },
        {
          title: 'CSV export',
          body: 'Fixes #12\n\nAll requirements are done.',
          author: 'agent[bot]',
          draft: false,
          baseSha: 'b1',
          headSha: 'h1',
          files: [
            {
              filename: 'src/a.ts',
              status: 'modified',
              patch: '@@ -1 +1 @@\n-a\n+b',
              additions: 1,
              deletions: 1,
            },
          ],
        },
      )
      .addIssue(
        { owner: 'acme', repo: 'reports', number: 12 },
        { title: 'CSV', body: '- [ ] the export button downloads a CSV', author: 'maya' },
      );
    const io = memoryIo(dir);
    expect(
      await reviewCommand(
        ['https://github.com/acme/reports/pull/58', '--json'],
        io.sink,
        providers({ github: gh as unknown as LiveGitHub }),
      ),
    ).toBe(EXIT.ok);
    expect(JSON.parse(io.out).input).toMatchObject({ mode: 'github', repo: 'acme/reports', pr: 58 });
  });

  it('skips draft PRs when draft_prs is skip', async () => {
    const gh = new FakeGitHub().addPull(
      { owner: 'a', repo: 'b', number: 1 },
      { title: 't', body: '', author: 'x', draft: true, baseSha: 'b', headSha: 'h', files: [] },
    );
    writeFileSync(join(dir, 'draft.yml'), 'draft_prs: skip\n');
    await expect(
      reviewCommand(
        ['a/b#1', '--config', 'draft.yml'],
        memoryIo(dir).sink,
        providers({ github: gh as unknown as LiveGitHub }),
      ),
    ).rejects.toMatchObject({ exitCode: EXIT.ok, message: expect.stringMatching(/draft/) });
  });
});

describe('exit codes (10.1)', () => {
  const base = { summary: { counts: {}, mode: 'comment_only' }, warnings: [] } as unknown as ReviewResult;
  it('0 ok, 1 gate failure, 4 budget from the result', () => {
    expect(exitCodeFor(base)).toBe(0);
    expect(exitCodeFor({ ...base, summary: { counts: {}, mode: 'gate', gateDecision: 'fail' } })).toBe(1);
    expect(exitCodeFor({ ...base, summary: { counts: {}, mode: 'gate', gateDecision: 'refused' } })).toBe(0);
    expect(
      exitCodeFor({
        ...base,
        warnings: ['Budget reached: jev: budget of $0.00 reached. The result is partial.'],
      }),
    ).toBe(4);
  });

  it('4 when the budget runs out during a review', async () => {
    const io = memoryIo(dir);
    expect(
      await reviewCommand(
        LOCAL,
        io.sink,
        providers({ jev: new TestJev(new ProviderError('jev', 'budget', 'budget of $0.00 reached')) }),
      ),
    ).toBe(EXIT.budget);
    expect(io.out).toMatch(/Budget reached/);
  });

  it('3 for provider and network errors, via main', async () => {
    const io = memoryIo(dir);
    await expect(reviewCommand(['acme/app#404'], io.sink, providers())).rejects.toMatchObject({
      exitCode: EXIT.provider,
    });
  });

  it.each([
    [[], /needs a PR URL, or --issue and --diff/],
    [['not-a-pr'], /is not a pull request URL/],
    [[...LOCAL, '--json', '--sarif'], /exclusive/],
    [[...LOCAL, '--budget-usd', 'lots'], /not a positive number/],
    [[...LOCAL, '--pr-body', 'missing.md'], /could not be read/],
    [[...LOCAL, '--bogus'], /Unknown option/],
  ])('2 for usage errors: %j', async (argv, message) => {
    const io = memoryIo(dir, {});
    expect(await main(['review', ...argv], io.sink)).toBe(EXIT.usage);
    expect(io.err).toMatch(message);
  });
});

describe('remit init and remit demo', () => {
  it('writes a template that parses to exactly the 10.5 defaults, refusing to overwrite without --force', () => {
    const d = mkdtempSync(join(tmpdir(), 'remit-init-'));
    try {
      expect(parseConfig(CONFIG_TEMPLATE)).toEqual({ config: defaultConfig(), errors: [] });
      const io = memoryIo(d, { TYPESAFE_API_KEY: 'x' });
      expect(initCommand([], io.sink)).toBe(0);
      expect(readFileSync(join(d, '.remit.yml'), 'utf8')).toBe(CONFIG_TEMPLATE);
      expect(io.out).toMatch(/✓ set\s+TYPESAFE_API_KEY/);
      expect(io.out).toMatch(/✗ missing ANTHROPIC_API_KEY/);
      expect(() => initCommand([], memoryIo(d).sink)).toThrow(/already exists/);
      expect(initCommand(['--force'], memoryIo(d).sink)).toBe(0);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('runs scenarios 1 and 2 offline in under 10 s', async () => {
    const io = memoryIo(dir, {});
    const t = Date.now();
    expect(await demoCommand([], io.sink)).toBe(0);
    expect(Date.now() - t).toBeLessThan(10_000);
    for (const s of DEMO_SCENARIOS)
      expect(io.out).toContain(`Scenario ${DEMO_SCENARIOS.indexOf(s) + 1}: ${s.name}`);
    expect(io.out).toMatch(/R1\s+⛔ CONTRADICTED/);
    expect(io.out).toMatch(/-- PR comment preview --/);
  });
});

describe('help and real provider wiring (M5 gate)', () => {
  it.each([
    ['review', /--dry-run\s+estimate calls, tokens and cost/],
    ['units', /units --diff/],
    ['extract', /extract <issue-url/],
    ['init', /--force/],
  ])('%s --help prints its options and exits 0', async (cmd, pattern) => {
    const io = memoryIo(dir, {});
    expect(await main([cmd, '--help'], io.sink)).toBe(0);
    expect(io.out).toMatch(pattern);
  });

  it('shows the command help after an unknown option', async () => {
    const io = memoryIo(dir, {});
    expect(await main(['review', '--nope'], io.sink)).toBe(2);
    expect(io.err).toMatch(/Unknown option '--nope'[\s\S]*--explain <id>/);
  });

  it('--offline replays only: with no cassettes every Jev call misses, and the review still completes', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'remit-cache-'));
    try {
      const io = memoryIo(dir, { REMIT_CACHE_DIR: cache });
      expect(await main(['review', ...LOCAL, '--offline', '--json'], io.sink)).toBe(0);
      const r = JSON.parse(io.out);
      expect(r.warnings.join('\n')).toMatch(/no cassette/);
      expect(r.usage.costUsd).toBe(0);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it('--budget-usd overrides the per-review budget', async () => {
    const io = memoryIo(dir, {});
    expect(await main(['review', ...LOCAL, '--dry-run', '--budget-usd', '0.25'], io.sink)).toBe(0);
    expect(io.out).toMatch(/budget \$0\.25/);
  });

  it('--verbose writes JSON logs with the review id to stderr', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'remit-cache-'));
    try {
      const io = memoryIo(dir, { REMIT_CACHE_DIR: cache });
      expect(await main(['review', ...LOCAL, '--offline', '--verbose'], io.sink)).toBe(0);
      const lines = io.err
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { reviewId: string; msg: string });
      expect(lines.map((l) => l.msg)).toEqual(expect.arrayContaining(['review started', 'review finished']));
      expect(lines.every((l) => /^rv_/.test(l.reviewId))).toBe(true);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
});
