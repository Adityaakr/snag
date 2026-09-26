import { z } from 'zod';
import { ProviderError } from '../common/errors.js';
import { type CacheMode, type CassetteStore, cacheKey } from '../cache/store.js';
import type { LlmMessage, LlmProvider, LlmResult, StructuredOptions } from './types.js';

/** Record and replay for LLM calls (BUILD_PROMPT 7.4). The key covers provider, model, prompt version, schema and messages. */
export class CachedLlm implements LlmProvider {
  readonly provider: LlmProvider['provider'];
  readonly model: string;

  constructor(
    private readonly inner: LlmProvider,
    private readonly store: CassetteStore,
    readonly mode: CacheMode,
  ) {
    this.provider = inner.provider;
    this.model = inner.model;
  }

  async structured<T>(
    schema: z.ZodType<T>,
    messages: LlmMessage[],
    opts: StructuredOptions,
  ): Promise<LlmResult<T>> {
    if (this.mode === 'live') return this.inner.structured(schema, messages, opts);
    const request = {
      provider: this.inner.provider,
      model: this.model,
      promptVersion: opts.promptVersion,
      schemaName: opts.schemaName,
      schema: z.toJSONSchema(schema),
      system: opts.system,
      messages,
    };
    const key = cacheKey(request);
    if (this.mode !== 'record') {
      const hit = await this.store.get('llm', key);
      if (hit) {
        const res = hit.response as {
          data: unknown;
          model: string;
          usage: LlmResult<T>['usage'];
          repairs: number;
        };
        return {
          data: schema.parse(res.data),
          model: res.model,
          usage: res.usage,
          costUsd: 0,
          cached: true,
          repairs: res.repairs,
        };
      }
      if (this.mode === 'replay') {
        throw new ProviderError(
          'llm',
          'cache_miss',
          `no cassette for ${opts.kind ?? 'llm'} ${opts.targetId ?? ''} (key ${key.slice(0, 12)})`,
          'Record it with REMIT_CACHE_MODE=record and an ANTHROPIC_API_KEY, or use replay_or_live.',
        );
      }
    }
    const res = await this.inner.structured(schema, messages, opts);
    await this.store.put('llm', {
      key,
      request,
      response: { data: res.data, model: res.model, usage: res.usage, repairs: res.repairs },
      recordedAt: new Date().toISOString(),
    });
    return res;
  }
}
