/**
 * Cancellation for provider calls (BUILD_PROMPT M9): once a job's signal aborts (a newer push superseded it), no new
 * Jev or LLM call starts, and in-flight requests get the signal. The refusal is a fatal error, so it is not retried.
 */
import type { EntryType, Questions } from '@typesafe-ai/sdk';
import type { z } from 'zod';
import type { AskOptions, CallMeta, JevProvider, JevResult } from '../jev/types.js';
import type { LlmMessage, LlmProvider, LlmResult, StructuredOptions } from '../llm/types.js';
import { ProviderError } from './errors.js';

const cancelled = (name: string) =>
  new ProviderError(name, 'bad_request', 'cancelled: a newer push superseded this review');

export class AbortableJev implements JevProvider {
  constructor(
    private readonly inner: JevProvider,
    private readonly signal: AbortSignal,
  ) {}
  get model() {
    return this.inner.model;
  }
  ask<Q extends Questions>(
    meta: CallMeta,
    state: EntryType,
    questions: Q,
    opts: AskOptions = {},
  ): Promise<JevResult<Q>> {
    if (this.signal.aborted) return Promise.reject(cancelled('jev'));
    return this.inner.ask(meta, state, questions, { ...opts, signal: opts.signal ?? this.signal });
  }
}

export class AbortableLlm implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly signal: AbortSignal,
  ) {}
  get provider() {
    return this.inner.provider;
  }
  get model() {
    return this.inner.model;
  }
  structured<T>(
    schema: z.ZodType<T>,
    messages: LlmMessage[],
    opts: StructuredOptions,
  ): Promise<LlmResult<T>> {
    if (this.signal.aborted) return Promise.reject(cancelled(this.inner.provider));
    return this.inner.structured(schema, messages, { ...opts, signal: opts.signal ?? this.signal });
  }
}
