import { ProviderError } from '@remit/providers';
import { describe, expect, it } from 'vitest';
import { memoryIo } from '../testing.js';
import { type DoctorDeps, doctorCommand, runChecks } from './doctor.js';

const SECRET = ['sk', 'ant', 'secret', 'value'].join('-');
const deps = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
  nodeVersion: 'v22.23.2',
  env: { TYPESAFE_API_KEY: 'ts-secret-value', ANTHROPIC_API_KEY: SECRET, GITHUB_TOKEN: 'gh-secret-value' },
  configText: null,
  jevProbe: async (model) => ({ model }),
  anthropicModels: async () => ['claude-opus-5-5', 'claude-sonnet-5'],
  githubRateLimit: async () => ({ limit: 5000, remaining: 4990, resetAt: 0 }),
  ...over,
});

describe('remit doctor', () => {
  it('passes when everything is in place and never prints secret values', async () => {
    const io = memoryIo('/tmp');
    expect(await doctorCommand([], io.sink, deps())).toBe(0);
    expect(io.out).toMatch(/✓ ok\s+typesafe\s+reachable; answered by jev-1.13.0/);
    expect(io.out).toMatch(/anthropic extraction.model\s+claude-opus-5-5 is available/);
    expect(io.out).toMatch(/4990\/5000 requests left/);
    expect(io.out).not.toMatch(/secret-value|sk-ant/);
  });

  it('fails missing required keys with fixes and skips provider checks', async () => {
    const io = memoryIo('/tmp');
    const code = await doctorCommand([], io.sink, deps({ env: {} }));
    expect(code).toBe(3);
    expect(io.out).toMatch(
      /✗ FAIL\s+env TYPESAFE_API_KEY\s+not set\n\s+fix: See https:\/\/docs.typesafe.ai\/introduction\/quickstart/,
    );
    expect(io.out).toMatch(/- skip\s+typesafe\s+skipped: TYPESAFE_API_KEY not set/);
    expect(io.out).toMatch(/- skip\s+anthropic\s+skipped: ANTHROPIC_API_KEY not set/);
    expect(io.out).toMatch(/! warn\s+env GITHUB_TOKEN/);
  });

  it('does not require an LLM key in tasklist_only mode', async () => {
    const { checks } = await runChecks(
      deps({ env: { TYPESAFE_API_KEY: 'x' }, configText: 'extraction:\n  mode: tasklist_only\n' }),
    );
    expect(checks.find((c) => c.name === 'env ANTHROPIC_API_KEY')?.status).toBe('warn');
  });

  it('flags a configured model the key cannot use', async () => {
    const { checks } = await runChecks(deps({ anthropicModels: async () => ['claude-sonnet-5'] }));
    expect(checks.find((c) => c.name === 'anthropic extraction.model')).toMatchObject({
      status: 'fail',
      fix: expect.stringMatching(/claude-sonnet-5/),
    });
  });

  it('warns when TypeSafe answers with a different model, and reports provider errors with their fix', async () => {
    const { checks } = await runChecks(deps({ jevProbe: async () => ({ model: 'jev-1.14.0' }) }));
    expect(checks.find((c) => c.name === 'typesafe')?.status).toBe('warn');
    const r = await runChecks(
      deps({
        jevProbe: async () =>
          Promise.reject(
            new ProviderError('jev', 'auth', 'the API key was rejected', 'Check TYPESAFE_API_KEY'),
          ),
      }),
    );
    expect(r.checks.find((c) => c.name === 'typesafe')).toMatchObject({
      status: 'fail',
      fix: 'Check TYPESAFE_API_KEY',
    });
  });

  it('warns on low GitHub headroom and fails when unreachable', async () => {
    const low = await runChecks(
      deps({ githubRateLimit: async () => ({ limit: 60, remaining: 2, resetAt: 0 }) }),
    );
    expect(low.checks.find((c) => c.name === 'github')?.status).toBe('warn');
    const down = await runChecks(
      deps({ githubRateLimit: async () => Promise.reject(new Error('ENOTFOUND')) }),
    );
    expect(down.checks.find((c) => c.name === 'github')).toMatchObject({
      status: 'fail',
      fix: expect.stringMatching(/api.github.com/),
    });
  });

  it('exits 2 on an invalid config and warns on old Node', async () => {
    const io = memoryIo('/tmp');
    expect(
      await doctorCommand([], io.sink, deps({ configText: 'mode: explode', nodeVersion: 'v20.1.0' })),
    ).toBe(2);
    expect(io.out).toMatch(/! warn\s+node/);
    expect((await runChecks(deps({ nodeVersion: 'v18.0.0' }))).checks[0]?.status).toBe('fail');
  });
});
