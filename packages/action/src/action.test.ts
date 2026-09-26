import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Calibration } from '@remit/core';
import { fakeRepo } from '@remit/server';
import { describe, expect, it } from 'vitest';
import { escapeData, escapeProperty, runAction } from './action.js';

function event(fork = false) {
  const dir = mkdtempSync(join(tmpdir(), 'remit-action-'));
  const path = join(dir, 'event.json');
  writeFileSync(
    path,
    JSON.stringify({
      repository: { name: 'reports', owner: { login: 'acme' } },
      pull_request: {
        number: 77,
        head: { repo: { full_name: fork ? 'fork/reports' : 'acme/reports' } },
        base: { repo: { full_name: 'acme/reports' } },
      },
    }),
  );
  return { path, summary: join(dir, 'summary.md') };
}

function run(
  opts: {
    config?: string;
    inputs?: Record<string, string>;
    fork?: boolean;
    eventName?: string;
    calibration?: Calibration;
    calibrationDir?: string;
    files?: Record<string, string>;
  } = {},
) {
  const repo = fakeRepo('three_reqs_one_missing', opts.config ? { config: opts.config } : {});
  for (const [p, text] of Object.entries(opts.files ?? {}))
    repo.gh.addContent('acme', 'reports', 'main', p, text);
  const ev = event(opts.fork);
  let out = '';
  const env: Record<string, string> = {
    GITHUB_EVENT_NAME: opts.eventName ?? 'pull_request',
    GITHUB_EVENT_PATH: ev.path,
    GITHUB_STEP_SUMMARY: ev.summary,
    GITHUB_RUN_ID: '9',
  };
  for (const [k, v] of Object.entries(opts.inputs ?? {})) env[`INPUT_${k.toUpperCase()}`] = v;
  const done = runAction({
    env,
    out: (t) => {
      out += t;
    },
    github: repo.gh,
    providers: (config) => {
      const p = repo.providers(config);
      return { ...p, costs: undefined as never, cacheMode: 'live' as const, notes: [] };
    },
    ...(opts.calibration ? { calibration: opts.calibration } : {}),
    ...(opts.calibrationDir ? { calibrationDir: opts.calibrationDir } : {}),
  });
  return { done, repo, ev, out: () => out };
}

describe('runAction', () => {
  it('reviews through the API: sticky comment, job summary, annotations, exit 0 in comment_only', async () => {
    const r = run();
    expect(await r.done).toBe(0);
    expect(r.repo.gh.posted.get('acme/reports#77')?.[0]?.body).toContain(
      '<!-- remit:summary v1 review=action_9_1',
    );
    expect(readFileSync(r.ev.summary, 'utf8')).toContain('remit:summary');
    expect(r.out()).toMatch(/^Remit: /m);
    // Never a checkout: every read went through the GitHub API client.
    expect(r.repo.gh.calls.some((c) => c.startsWith('getContent acme/reports@head0000'))).toBe(true);
  });

  it('gate mode fails the job only with calibration evidence', async () => {
    const refused = run({ inputs: { mode: 'gate' } });
    expect(await refused.done).toBe(0);
    expect(refused.out()).toContain('Gate mode was refused');
    const calibration: Calibration = {
      id: 'c',
      jevModel: 'jev-1.13.0',
      questionSet: 'qs-0.1.0',
      maps: {},
      labeledFindings: 500,
      p0Precision: 0.95,
    };
    const gated = run({ config: 'gate:\n  threshold: 0.5\n', inputs: { mode: 'gate' }, calibration });
    expect(await gated.done).toBe(1);
  });

  it('rework mode posts the rework request; budget and mode inputs are validated', async () => {
    const rework = run({ inputs: { mode: 'rework', 'budget-usd': '0.25' } });
    expect(await rework.done).toBe(0);
    expect(rework.repo.gh.posted.get('acme/reports#77')?.some((c) => c.body.includes('remit:rework'))).toBe(
      true,
    );
    await expect(run({ inputs: { mode: 'loud' } }).done).rejects.toThrow(/comment_only, rework or gate/);
    await expect(run({ inputs: { 'budget-usd': '-1' } }).done).rejects.toThrow(/positive number/);
  });

  it('skips non-PR events and fork PRs without secrets, with a notice', async () => {
    const push = run({ eventName: 'push' });
    expect(await push.done).toBe(0);
    expect(push.out()).toContain('::notice');
    const fork = run({ fork: true });
    expect(await fork.done).toBe(0);
    expect(fork.out()).toContain('comes from a fork');
    expect(fork.repo.gh.posted.size).toBe(0);
    const target = run({ fork: true, eventName: 'pull_request_target' });
    expect(await target.done).toBe(0);
    expect(target.repo.gh.posted.size).toBe(1);
  });

  it('escapes workflow command data and properties', () => {
    expect(escapeData('50%\nnext')).toBe('50%25%0Anext');
    expect(escapeProperty('a:b,c')).toBe('a%3Ab%2Cc');
  });
});

describe('calibration in the Action', () => {
  const cal = {
    id: 'cal-x',
    jevModel: 'jev-1.13.0',
    questionSet: 'qs-0.1.0',
    maps: {},
    labeledFindings: 500,
    p0Precision: 0.95,
  };

  it('uses the bundled calibration for the Jev model, so gate mode can fail the job', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'remit-cal-'));
    mkdirSync(join(dir, 'jev-1.13.0'));
    writeFileSync(join(dir, 'jev-1.13.0', 'qs-0.1.0.json'), JSON.stringify({ ...cal, fits: {}, tuning: {} }));
    expect(
      await run({ config: 'gate:\n  threshold: 0.5\n', inputs: { mode: 'gate' }, calibrationDir: dir }).done,
    ).toBe(1);
    const corrupt = mkdtempSync(join(tmpdir(), 'remit-cal-'));
    mkdirSync(join(corrupt, 'jev-1.13.0'));
    writeFileSync(join(corrupt, 'jev-1.13.0', 'qs-0.1.0.json'), '{not json');
    const bad = run({ inputs: { mode: 'gate' }, calibrationDir: corrupt });
    expect(await bad.done).toBe(0);
    expect(bad.repo.gh.posted.get('acme/reports#77')?.[0]?.body).toContain(
      'bundled for jev-1.13.0 is not valid',
    );
    const empty = mkdtempSync(join(tmpdir(), 'remit-cal-'));
    expect(
      await run({ config: 'gate:\n  threshold: 0.5\n', inputs: { mode: 'gate' }, calibrationDir: empty })
        .done,
    ).toBe(0);
  });

  it('prefers calibration-path on the default branch and warns when it is missing or invalid', async () => {
    const good = run({
      config: 'gate:\n  threshold: 0.5\n',
      inputs: { mode: 'gate', 'calibration-path': '.remit/calibration.json' },
      files: { '.remit/calibration.json': JSON.stringify(cal) },
    });
    expect(await good.done).toBe(1);
    const missing = run({ inputs: { mode: 'gate', 'calibration-path': 'nope.json' } });
    expect(await missing.done).toBe(0);
    expect(missing.repo.gh.posted.get('acme/reports#77')?.[0]?.body).toContain(
      'calibration-path nope.json was not found',
    );
    const invalid = run({ inputs: { 'calibration-path': 'bad.json' }, files: { 'bad.json': '{"id":1}' } });
    expect(await invalid.done).toBe(0);
    expect(invalid.repo.gh.posted.get('acme/reports#77')?.[0]?.body).toContain(
      'is not a valid calibration file',
    );
  });

  it('reports a skipped config file', async () => {
    const r = run({ files: { '.remit.yml': 'x'.repeat(1024 * 1024 + 1) } });
    expect(await r.done).toBe(0);
    expect(r.repo.gh.posted.get('acme/reports#77')?.[0]?.body).toContain('.remit.yml was skipped');
  });
});
