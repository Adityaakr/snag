/** Providers for CLI commands (BUILD_PROMPT 10.1): the shared env builder plus a GitHub client from GITHUB_TOKEN. */
import type { RemitConfig } from '@remit/core';
import { type EnvProviders, LiveGitHub, type Logger, providersFromEnv } from '@remit/providers';

export { cacheDir } from '@remit/providers';

export interface CliProviders extends EnvProviders {
  github: LiveGitHub;
}

export function buildProviders(
  config: RemitConfig,
  env: Record<string, string | undefined>,
  opts: { offline?: boolean; budgetUsd?: number; logger?: Logger } = {},
): CliProviders {
  return {
    ...providersFromEnv(config, env, opts),
    github: new LiveGitHub({
      ...(env.GITHUB_TOKEN ? { token: env.GITHUB_TOKEN } : {}),
      ...(opts.logger ? { logger: opts.logger } : {}),
    }),
  };
}
