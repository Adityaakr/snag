/**
 * Builds providers for CLI commands from config and environment (BUILD_PROMPT 7.4, 8, 10.1). Live providers are
 * created only when their key is set; every provider is wrapped in record and replay. `--offline` means replay.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BRAND, type RemitConfig } from '@remit/core';
import {
  AnthropicLlm,
  CachedJev,
  CachedLlm,
  type CacheMode,
  cacheModeFrom,
  CostTracker,
  FileStore,
  type JevProvider,
  LiveGitHub,
  LiveJev,
  type LlmProvider,
  OpenAiCompatibleLlm,
} from '@remit/providers';

export interface CliProviders {
  llm?: LlmProvider;
  jev?: JevProvider;
  github: LiveGitHub;
  costs: CostTracker;
  cacheMode: CacheMode;
  notes: string[];
}

export function cacheDir(env: Record<string, string | undefined>): string {
  return env.REMIT_CACHE_DIR ?? join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), BRAND.slug);
}

export function buildProviders(
  config: RemitConfig,
  env: Record<string, string | undefined>,
  opts: { offline?: boolean; budgetUsd?: number } = {},
): CliProviders {
  const notes: string[] = [];
  const cacheMode: CacheMode = opts.offline ? 'replay' : cacheModeFrom(env, 'replay_or_live');
  // Local caches keep answers by key only, never code or issue text (BUILD_PROMPT 7.4, 9 rule 9).
  const store = new FileStore(cacheDir(env), { contentFree: true });
  const costs = new CostTracker(opts.budgetUsd ?? config.budgets.max_usd_per_review);
  const price = config.llm_prices[config.extraction.model];
  const llmPrice = { inputPerMillionUsd: price?.input ?? 0, outputPerMillionUsd: price?.output ?? 0 };
  if (!price)
    notes.push(
      `No price is configured for ${config.extraction.model}; its cost is counted as 0 (set llm_prices in .${BRAND.slug}.yml).`,
    );

  let liveLlm: LlmProvider | undefined;
  if (!opts.offline) {
    if (config.extraction.provider === 'anthropic' && env.ANTHROPIC_API_KEY) {
      liveLlm = new AnthropicLlm({
        model: config.extraction.model,
        price: llmPrice,
        apiKey: env.ANTHROPIC_API_KEY,
        costs,
        ...(config.extraction.effort ? { effort: config.extraction.effort } : {}),
      });
    } else if (
      config.extraction.provider === 'openai_compatible' &&
      env.OPENAI_COMPATIBLE_API_KEY &&
      env.OPENAI_COMPATIBLE_BASE_URL
    ) {
      liveLlm = new OpenAiCompatibleLlm({
        model: config.extraction.model,
        price: llmPrice,
        apiKey: env.OPENAI_COMPATIBLE_API_KEY,
        baseURL: env.OPENAI_COMPATIBLE_BASE_URL,
        costs,
      });
    }
  }
  const llm = liveLlm
    ? new CachedLlm(liveLlm, store, cacheMode)
    : opts.offline
      ? replayOnlyLlm(config, store)
      : undefined;
  if (!liveLlm && !opts.offline && config.extraction.mode !== 'tasklist_only')
    notes.push(
      `${config.extraction.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_COMPATIBLE_API_KEY'} is not set; extraction uses the task list only.`,
    );

  const liveJev =
    !opts.offline && env.TYPESAFE_API_KEY
      ? new LiveJev({
          model: config.jev.model,
          pricePerMillionUsd: config.jev.price_per_million_input_usd,
          apiKey: env.TYPESAFE_API_KEY,
          maxStateTokens: config.jev.max_state_tokens,
          concurrency: config.jev.concurrency,
          costs,
        })
      : null;
  const jev =
    liveJev || opts.offline ? new CachedJev(liveJev, store, cacheMode, config.jev.model) : undefined;
  if (!jev) notes.push('TYPESAFE_API_KEY is not set; Jev questions are skipped.');

  return {
    ...(llm ? { llm } : {}),
    ...(jev ? { jev } : {}),
    github: new LiveGitHub({ ...(env.GITHUB_TOKEN ? { token: env.GITHUB_TOKEN } : {}) }),
    costs,
    cacheMode,
    notes,
  };
}

/** An LLM that can only replay recorded answers (for --offline). */
function replayOnlyLlm(config: RemitConfig, store: FileStore): LlmProvider {
  const inner: LlmProvider = {
    provider: config.extraction.provider,
    model: config.extraction.model,
    structured: () => Promise.reject(new Error('offline')),
  };
  return new CachedLlm(inner, store, 'replay');
}
