/**
 * `remit doctor` (BUILD_PROMPT 10.1): Node version, env vars, config, connectivity to TypeSafe, Anthropic and
 * GitHub, configured model ids and rate-limit headroom. Every failure prints a fix. Never prints secret values.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND, parseConfig, type RemitConfig } from '@remit/core';
import { AnthropicLlm, LiveGitHub, LiveJev, noul, ProviderError } from '@remit/providers';
import { EXIT } from '../errors.js';
import type { Io } from '../io.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface DoctorDeps {
  nodeVersion: string;
  env: Record<string, string | undefined>;
  configText: string | null;
  jevProbe(model: string): Promise<{ model: string }>;
  anthropicModels(): Promise<string[]>;
  githubRateLimit(): Promise<{ limit: number; remaining: number; resetAt: number }>;
}

const describeError = (e: unknown) =>
  e instanceof ProviderError
    ? { detail: e.message, fix: e.fix }
    : { detail: e instanceof Error ? e.message : String(e), fix: undefined };

export async function runChecks(deps: DoctorDeps): Promise<{ checks: Check[]; config: RemitConfig }> {
  const checks: Check[] = [];
  const major = Number(/^v?(\d+)/.exec(deps.nodeVersion)?.[1] ?? 0);
  checks.push(
    major >= 22
      ? { name: 'node', status: 'ok', detail: `Node ${deps.nodeVersion}` }
      : major >= 20
        ? {
            name: 'node',
            status: 'warn',
            detail: `Node ${deps.nodeVersion} works; 22 LTS is recommended`,
            fix: 'Install Node 22 LTS (see .nvmrc).',
          }
        : {
            name: 'node',
            status: 'fail',
            detail: `Node ${deps.nodeVersion} is too old`,
            fix: 'Install Node 22 LTS (see .nvmrc).',
          },
  );

  const { config, errors } =
    deps.configText === null ? { config: parseConfig('').config, errors: [] } : parseConfig(deps.configText);
  checks.push(
    errors.length
      ? {
          name: 'config',
          status: 'fail',
          detail: errors.join('; '),
          fix: `Fix .${BRAND.slug}.yml or delete it to use the defaults.`,
        }
      : {
          name: 'config',
          status: 'ok',
          detail:
            deps.configText === null
              ? `no .${BRAND.slug}.yml, using defaults`
              : `.${BRAND.slug}.yml is valid`,
        },
  );

  const needsLlm = config.extraction.mode !== 'tasklist_only';
  const keys: [string, boolean, string][] = [
    [
      'TYPESAFE_API_KEY',
      true,
      'See https://docs.typesafe.ai/introduction/quickstart and add it to .env, or run with --offline to see demo data.',
    ],
    [
      config.extraction.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_COMPATIBLE_API_KEY',
      needsLlm,
      'Add it to .env, or set extraction.mode: tasklist_only.',
    ],
    [
      'GITHUB_TOKEN',
      false,
      'Add a read-only fine-grained token to .env for PR reviews and a higher rate limit.',
    ],
  ];
  for (const [name, required, fix] of keys) {
    const set = Boolean(deps.env[name]);
    checks.push(
      set
        ? { name: `env ${name}`, status: 'ok', detail: 'set' }
        : { name: `env ${name}`, status: required ? 'fail' : 'warn', detail: 'not set', fix },
    );
  }

  if (deps.env.TYPESAFE_API_KEY) {
    try {
      const r = await deps.jevProbe(config.jev.model);
      checks.push(
        r.model === config.jev.model
          ? { name: 'typesafe', status: 'ok', detail: `reachable; answered by ${r.model}` }
          : {
              name: 'typesafe',
              status: 'warn',
              detail: `answered by ${r.model}, not the pinned ${config.jev.model}`,
              fix: 'Check jev.model in the config against https://docs.typesafe.ai/models.',
            },
      );
    } catch (e) {
      const d = describeError(e);
      checks.push({
        name: 'typesafe',
        status: 'fail',
        detail: d.detail,
        fix: d.fix ?? 'Check network access to api.typesafe.ai.',
      });
    }
  } else checks.push({ name: 'typesafe', status: 'skip', detail: 'skipped: TYPESAFE_API_KEY not set' });

  if (config.extraction.provider === 'anthropic' && deps.env.ANTHROPIC_API_KEY) {
    try {
      const ids = await deps.anthropicModels();
      for (const [label, id] of [
        ['extraction.model', config.extraction.model],
        ['baseline.model', config.baseline.model],
      ] as const) {
        checks.push(
          ids.includes(id)
            ? { name: `anthropic ${label}`, status: 'ok', detail: `${id} is available` }
            : {
                name: `anthropic ${label}`,
                status: 'fail',
                detail: `${id} is not in the Models API list`,
                fix: `Set ${label} to one of: ${ids.slice(0, 6).join(', ')}.`,
              },
        );
      }
    } catch (e) {
      const d = describeError(e);
      checks.push({
        name: 'anthropic',
        status: 'fail',
        detail: d.detail,
        fix: d.fix ?? 'Check network access to api.anthropic.com.',
      });
    }
  } else if (config.extraction.provider === 'anthropic') {
    checks.push({ name: 'anthropic', status: 'skip', detail: 'skipped: ANTHROPIC_API_KEY not set' });
  }

  try {
    const rl = await deps.githubRateLimit();
    const pct = rl.limit ? rl.remaining / rl.limit : 0;
    checks.push(
      pct >= 0.1
        ? {
            name: 'github',
            status: 'ok',
            detail: `reachable; ${rl.remaining}/${rl.limit} requests left this hour`,
          }
        : {
            name: 'github',
            status: 'warn',
            detail: `only ${rl.remaining}/${rl.limit} requests left until ${new Date(rl.resetAt).toISOString()}`,
            fix: deps.env.GITHUB_TOKEN
              ? 'Wait for the reset.'
              : 'Set GITHUB_TOKEN for 5,000 requests per hour.',
          },
    );
  } catch (e) {
    const d = describeError(e);
    checks.push({
      name: 'github',
      status: 'fail',
      detail: d.detail,
      fix: d.fix ?? 'Check network access to api.github.com.',
    });
  }
  checks.push({
    name: 'rate limits',
    status: 'ok',
    detail: `Jev about 1,200 requests/min and 250,000 tokens/s (docs); concurrency ${config.jev.concurrency}`,
  });
  return { checks, config };
}

const MARK: Record<CheckStatus, string> = { ok: '✓ ok  ', warn: '! warn', fail: '✗ FAIL', skip: '- skip' };

export function renderChecks(checks: readonly Check[]): string {
  const lines = checks.map(
    (c) => `${MARK[c.status]}  ${c.name.padEnd(28)} ${c.detail}${c.fix ? `\n        fix: ${c.fix}` : ''}`,
  );
  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  lines.push(
    '',
    fails
      ? `${fails} check(s) failed, ${warns} warning(s).`
      : `All required checks passed (${warns} warning(s)).`,
  );
  return `${lines.join('\n')}\n`;
}

export function liveDeps(io: Io): DoctorDeps {
  const cfgPath = join(io.cwd, `.${BRAND.slug}.yml`);
  return {
    nodeVersion: process.version,
    env: io.env,
    configText: existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : null,
    async jevProbe(model) {
      const jev = new LiveJev({
        model,
        pricePerMillionUsd: 0.042,
        ...(io.env.TYPESAFE_API_KEY ? { apiKey: io.env.TYPESAFE_API_KEY } : {}),
        retry: { attempts: 2 },
      });
      const r = await jev.ask(
        { kind: 'issue', questionSet: 'doctor', targetId: 'probe', reviewId: 'doctor' },
        'The sky is blue.',
        { probe: noul('Does `state` mention a color?') },
      );
      return { model: r.model };
    },
    async anthropicModels() {
      return new AnthropicLlm({
        model: 'probe',
        price: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
        ...(io.env.ANTHROPIC_API_KEY ? { apiKey: io.env.ANTHROPIC_API_KEY } : {}),
      }).listModels();
    },
    async githubRateLimit() {
      return new LiveGitHub({
        ...(io.env.GITHUB_TOKEN ? { token: io.env.GITHUB_TOKEN } : {}),
        retry: { attempts: 1 },
      }).rateLimit();
    },
  };
}

export async function doctorCommand(
  _argv: string[],
  io: Io,
  deps: DoctorDeps = liveDeps(io),
): Promise<number> {
  const { checks } = await runChecks(deps);
  io.out(renderChecks(checks));
  if (checks.some((c) => c.name === 'config' && c.status === 'fail')) return EXIT.usage;
  return checks.some((c) => c.status === 'fail') ? EXIT.provider : EXIT.ok;
}
