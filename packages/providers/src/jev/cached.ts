import type { EntryType, Questions } from '@typesafe-ai/sdk';
import { ProviderError } from '../common/errors.js';
import { type CacheMode, type CassetteStore, cacheKey } from '../cache/store.js';
import type { AskOptions, CallMeta, JevAnswers, JevProvider, JevResult } from './types.js';
import { validateAnswers } from './validate.js';

interface JevCassetteResponse {
  answers: unknown;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Wraps any JevProvider with record and replay (BUILD_PROMPT 7.4). The key covers provider, model, question
 * set, state and questions, so any wording or version change misses the cache.
 */
export class CachedJev implements JevProvider {
  readonly model: string;
  hits = 0;
  misses = 0;

  constructor(
    private readonly inner: JevProvider | null,
    private readonly store: CassetteStore,
    readonly mode: CacheMode,
    model?: string,
  ) {
    const m = model ?? inner?.model;
    if (!m)
      throw new ProviderError('jev', 'config', 'CachedJev needs a model when there is no inner provider');
    this.model = m;
  }

  async ask<Q extends Questions>(
    meta: CallMeta,
    state: EntryType,
    questions: Q,
    opts?: AskOptions,
  ): Promise<JevResult<Q>> {
    if (this.mode === 'live') return this.live(meta, state, questions, opts);
    const request = { provider: 'jev', model: this.model, questionSet: meta.questionSet, state, questions };
    const key = cacheKey(request);
    if (this.mode !== 'record') {
      const hit = await this.store.get('jev', key);
      if (hit) {
        const res = hit.response as JevCassetteResponse;
        validateAnswers(questions, res.answers);
        this.hits++;
        return {
          answers: res.answers as JevAnswers<Q>,
          model: res.model,
          usage: res.usage,
          costUsd: 0,
          cached: true,
        };
      }
      this.misses++;
      if (this.mode === 'replay') {
        throw new ProviderError(
          'jev',
          'cache_miss',
          `no cassette for ${meta.kind} ${meta.targetId} (key ${key.slice(0, 12)})`,
          'Record it with REMIT_CACHE_MODE=record and a TYPESAFE_API_KEY, or use replay_or_live.',
        );
      }
    }
    // Record the request as sent. If the provider shrank it after an overflow, the next identical ask
    // will shrink the same way and hit the live provider again, which is correct.
    const res = await this.live(meta, state, questions, opts);
    const response: JevCassetteResponse = { answers: res.answers, model: res.model, usage: res.usage };
    await this.store.put('jev', { key, request, response, recordedAt: new Date().toISOString() });
    return res;
  }

  private live<Q extends Questions>(
    meta: CallMeta,
    state: EntryType,
    questions: Q,
    opts?: AskOptions,
  ): Promise<JevResult<Q>> {
    if (!this.inner)
      throw new ProviderError(
        'jev',
        'config',
        'no live Jev provider is configured',
        'Set TYPESAFE_API_KEY, or use REMIT_CACHE_MODE=replay with recorded cassettes.',
      );
    return this.inner.ask(meta, state, questions, opts);
  }
}
