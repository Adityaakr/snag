/**
 * Builds Jev and LLM providers from config and environment for the CLI, the App and the Action (BUILD_PROMPT 7.4,
 * 8). Live providers are created only when their key is set; every provider is wrapped in record and replay.
 * `offline` means replay only.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BRAND, type RemitConfig } from '@remit/core';
import { type CacheMode, cacheModeFrom, FileStore } from './cache/store.js';
import { CostTracker } from './common/budget.js';
import { BreakerJev, BreakerLlm, type CircuitOptions, processBreaker } from './common/circuit.js';
import type { Logger } from './common/limits.js';
import { CachedJev } from './jev/cached.js';
import { LiveJev } from './jev/live.js';
import { LlmJev } from './jev/llm.js';
import type { JevProvider } from './jev/types.js';
import { AnthropicLlm } from './llm/anthropic.js';
import { CachedLlm } from './llm/cached.js';
import { OpenAiCompatibleLlm } from './llm/openai.js';
import type { LlmProvider } from './llm/types.js';

export interface EnvProviders {
  llm?: LlmProvider;
  jev?: JevProvider;
  costs: CostTracker;
  cacheMode: CacheMode;
  notes: string[];
}

export interface OperatorPrices {
  /** USD per million tokens, by model id. */
  llm: Record<string, { input: number; output: number }>;
  jevPerMillionUsd: number;
}

/**
 * The operator's price table: the built-in defaults, extended or overridden by `REMIT_LLM_PRICES` (JSON, model id to
 * `{input, output}`) and `REMIT_JEV_PRICE_PER_MILLION_USD`. Invalid values throw at startup.
 */
export function operatorPricesFromEnv(
  defaults: RemitConfig,
  env: Record<string, string | undefined>,
): OperatorPrices {
  // A null-prototype table: model ids like `constructor` or `__proto__` never resolve to inherited properties.
  const llm: OperatorPrices['llm'] = Object.assign(Object.create(null), defaults.llm_prices);
  if (env.REMIT_LLM_PRICES) {
    const parsed: unknown = JSON.parse(env.REMIT_LLM_PRICES);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('REMIT_LLM_PRICES must be a JSON object');
    for (const [model, p] of Object.entries(parsed)) {
      const { input, output } = (p ?? {}) as { input?: unknown; output?: unknown };
      if (
        typeof input !== 'number' ||
        typeof output !== 'number' ||
        !(input > 0) ||
        !(output > 0) ||
        !Number.isFinite(input + output)
      )
        throw new Error(`REMIT_LLM_PRICES.${model} needs positive input and output prices`);
      llm[model] = { input, output };
    }
  }
  const jev = env.REMIT_JEV_PRICE_PER_MILLION_USD
    ? Number(env.REMIT_JEV_PRICE_PER_MILLION_USD)
    : defaults.jev.price_per_million_input_usd;
  if (!(jev > 0) || !Number.isFinite(jev))
    throw new Error('REMIT_JEV_PRICE_PER_MILLION_USD must be a positive number');
  return { llm, jevPerMillionUsd: jev };
}

/**
 * The prices budgets use. With operator prices, each is the higher of the operator's and the repository's, and a model
 * the operator has not priced is not allowed. Without them (the CLI and the Action, where the repository pays), the
 * repository's config is used as is.
 */
export function resolvePrices(
  config: RemitConfig,
  operator: OperatorPrices | undefined,
  model: string = config.extraction.model,
): { llm: { input: number; output: number } | undefined; llmAllowed: boolean; jevPerMillionUsd: number } {
  const m = model;
  const repo = Object.hasOwn(config.llm_prices, m) ? config.llm_prices[m] : undefined;
  if (!operator)
    return { llm: repo, llmAllowed: true, jevPerMillionUsd: config.jev.price_per_million_input_usd };
  const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  const own = Object.hasOwn(operator.llm, m) ? operator.llm[m] : undefined;
  const floor = own && positive(own.input) && positive(own.output) ? own : undefined;
  return {
    llm: floor && {
      input: Math.max(floor.input, repo?.input ?? 0),
      output: Math.max(floor.output, repo?.output ?? 0),
    },
    llmAllowed: Boolean(floor),
    // An invalid operator Jev price fails closed (infinite cost), never open.
    jevPerMillionUsd: Math.max(
      positive(operator.jevPerMillionUsd) ? operator.jevPerMillionUsd : Number.POSITIVE_INFINITY,
      config.jev.price_per_million_input_usd,
    ),
  };
}

/**
 * Whether a Jev-compatible engine is configured: TypeSafe (`TYPESAFE_API_KEY`), or a self-hosted server that speaks
 * the same protocol at `REMIT_JEV_BASE_URL`, such as the local Laya engine (docs/laya.md, DECISIONS D34).
 */
export function jevConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(env.TYPESAFE_API_KEY || env.REMIT_JEV_BASE_URL);
}

export function cacheDir(env: Record<string, string | undefined>): string {
  return env.REMIT_CACHE_DIR ?? join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), BRAND.slug);
}

export function providersFromEnv(
  config: RemitConfig,
  env: Record<string, string | undefined>,
  opts: {
    offline?: boolean;
    budgetUsd?: number;
    logger?: Logger;
    breakers?: boolean;
    breakerOptions?: CircuitOptions;
    /**
     * Prices the operator trusts (the App). Repository config can raise a price but never lower it below these, and a
     * model with no operator price gets no live LLM calls, so a repository cannot make spend invisible to budgets.
     */
    operatorPrices?: OperatorPrices;
  } = {},
): EnvProviders {
  const notes: string[] = [];
  const cacheMode: CacheMode = opts.offline ? 'replay' : cacheModeFrom(env, 'replay_or_live');
  // Local caches keep answers by key only, never code or issue text (BUILD_PROMPT 7.4, 9 rule 9).
  const store = new FileStore(cacheDir(env), { contentFree: true });
  const costs = new CostTracker(opts.budgetUsd ?? config.budgets.max_usd_per_review);
  const { llm: price, llmAllowed, jevPerMillionUsd: jevPrice } = resolvePrices(config, opts.operatorPrices);
  const llmPrice = { inputPerMillionUsd: price?.input ?? 0, outputPerMillionUsd: price?.output ?? 0 };
  if (!llmAllowed)
    notes.push(
      `${config.extraction.model} has no operator price, so it is not called; extraction uses the task list only.`,
    );
  else if (!price)
    notes.push(
      `No price is configured for ${config.extraction.model}; its cost is counted as 0 (set llm_prices in .${BRAND.slug}.yml).`,
    );

  /** A live LLM for `model` through the extraction provider's credentials, or undefined without them. */
  const liveFor = (model: string, price: { inputPerMillionUsd: number; outputPerMillionUsd: number }) => {
    if (opts.offline) return undefined;
    if (config.extraction.provider === 'anthropic' && env.ANTHROPIC_API_KEY)
      return new AnthropicLlm({
        model,
        price,
        apiKey: env.ANTHROPIC_API_KEY,
        costs,
        ...(opts.logger ? { logger: opts.logger } : {}),
        ...(config.extraction.effort ? { effort: config.extraction.effort } : {}),
      });
    if (
      config.extraction.provider === 'openai_compatible' &&
      env.OPENAI_COMPATIBLE_API_KEY &&
      env.OPENAI_COMPATIBLE_BASE_URL
    )
      return new OpenAiCompatibleLlm({
        model,
        price,
        apiKey: env.OPENAI_COMPATIBLE_API_KEY,
        baseURL: env.OPENAI_COMPATIBLE_BASE_URL,
        costs,
        ...(opts.logger ? { logger: opts.logger } : {}),
      });
    return undefined;
  };
  const wrap = (live: LlmProvider) =>
    new CachedLlm(
      opts.breakers === false
        ? live
        : new BreakerLlm(live, processBreaker(live.provider, opts.breakerOptions)),
      store,
      cacheMode,
    );

  const liveLlm = llmAllowed ? liveFor(config.extraction.model, llmPrice) : undefined;
  const llm = liveLlm ? wrap(liveLlm) : opts.offline ? replayOnlyLlm(config, store) : undefined;
  if (!liveLlm && !opts.offline && llmAllowed && config.extraction.mode !== 'tasklist_only')
    notes.push(
      `${config.extraction.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_COMPATIBLE_API_KEY'} is not set; extraction uses the task list only.`,
    );

  if (config.jev.engine === 'llm') {
    const model = config.jev.llm_model ?? config.extraction.model;
    const p = resolvePrices(config, opts.operatorPrices, model);
    const live = p.llmAllowed
      ? liveFor(model, { inputPerMillionUsd: p.llm?.input ?? 0, outputPerMillionUsd: p.llm?.output ?? 0 })
      : undefined;
    const inner = live ? wrap(live) : opts.offline ? replayOnlyLlm(config, store, model) : undefined;
    if (!p.llmAllowed) notes.push(`${model} has no operator price, so the LLM Jev engine is off.`);
    else if (!inner)
      notes.push('The LLM Jev engine needs the extraction provider credentials; Jev questions are skipped.');
    const jevLlm = inner
      ? new LlmJev({
          llm: inner,
          maxStateTokens: config.jev.max_state_tokens,
          concurrency: config.jev.concurrency,
        })
      : undefined;
    return { ...(llm ? { llm } : {}), ...(jevLlm ? { jev: jevLlm } : {}), costs, cacheMode, notes };
  }

  const liveJev =
    !opts.offline && jevConfigured(env)
      ? new LiveJev({
          model: config.jev.model,
          pricePerMillionUsd: jevPrice,
          // A self-hosted engine needs no key; the SDK still wants a non-empty string.
          apiKey: env.TYPESAFE_API_KEY ?? env.REMIT_JEV_API_KEY ?? 'self-hosted',
          ...(env.REMIT_JEV_BASE_URL ? { baseURL: env.REMIT_JEV_BASE_URL } : {}),
          maxStateTokens: config.jev.max_state_tokens,
          concurrency: config.jev.concurrency,
          costs,
          ...(opts.logger ? { logger: opts.logger } : {}),
        })
      : null;
  const jev =
    liveJev || opts.offline
      ? new CachedJev(
          liveJev && opts.breakers !== false
            ? new BreakerJev(liveJev, processBreaker('jev', opts.breakerOptions))
            : liveJev,
          store,
          cacheMode,
          config.jev.model,
        )
      : undefined;
  if (!jev) notes.push('TYPESAFE_API_KEY is not set (and no REMIT_JEV_BASE_URL); Jev questions are skipped.');

  return {
    ...(llm ? { llm } : {}),
    ...(jev ? { jev } : {}),
    costs,
    cacheMode,
    notes,
  };
}

/** An LLM that can only replay recorded answers (for --offline). */
function replayOnlyLlm(config: RemitConfig, store: FileStore, model = config.extraction.model): LlmProvider {
  const inner: LlmProvider = {
    provider: config.extraction.provider,
    model,
    structured: () => Promise.reject(new Error('offline')),
  };
  return new CachedLlm(inner, store, 'replay');
}
