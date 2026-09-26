/**
 * Circuit breakers (BUILD_PROMPT M9): after `failures` consecutive retryable failures (each already retried with
 * backoff), a provider's circuit opens and calls fail fast for `cooldownMs`, so an outage costs one error per call
 * instead of a full retry ladder. One trial call is let through after the cooldown (half open); success closes it.
 * The pipeline turns the fast failure into a warning and partial results.
 */
import type { EntryType, Questions } from '@typesafe-ai/sdk';
import type { z } from 'zod';
import { ProviderError } from './errors.js';
import type { AskOptions, CallMeta, JevProvider, JevResult } from '../jev/types.js';
import type { LlmMessage, LlmProvider, LlmResult, StructuredOptions } from '../llm/types.js';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitOptions {
  failures?: number;
  cooldownMs?: number;
  now?: () => number;
  onOpen?: (name: string) => void;
  onReject?: (name: string) => void;
}

export class CircuitBreaker {
  private consecutive = 0;
  private openedAt = 0;
  private trial = false;
  state: CircuitState = 'closed';

  constructor(
    readonly name: string,
    private readonly opts: CircuitOptions = {},
  ) {}

  private get now() {
    return (this.opts.now ?? Date.now)();
  }

  private reject(): never {
    this.opts.onReject?.(this.name);
    throw new ProviderError(
      this.name,
      'overloaded',
      `circuit open after ${this.opts.failures ?? 5} consecutive failures; failing fast`,
      'The provider is failing; results are partial until it recovers.',
    );
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    // While open, or while a half-open trial is in flight, every other call fails fast.
    if (this.state === 'half_open' && this.trial) this.reject();
    let isTrial = false;
    if (this.state === 'open') {
      if (this.now - this.openedAt < (this.opts.cooldownMs ?? 30_000)) this.reject();
      this.state = 'half_open';
      this.trial = true;
      isTrial = true;
    }
    try {
      const out = await fn();
      if (isTrial || this.state === 'closed') {
        this.consecutive = 0;
        this.state = 'closed';
        this.trial = false;
      }
      return out;
    } catch (e) {
      const counts = e instanceof ProviderError && e.retryable;
      if (isTrial) {
        // Only the trial decides a half-open circuit. Any failure, counted or not (a cancellation proves nothing),
        // opens it again for another cooldown.
        this.state = 'open';
        this.openedAt = this.now;
        this.trial = false;
        if (counts) this.opts.onOpen?.(this.name);
      } else if (counts && this.state === 'closed') {
        this.consecutive++;
        if (this.consecutive >= (this.opts.failures ?? 5)) {
          this.state = 'open';
          this.openedAt = this.now;
          this.opts.onOpen?.(this.name);
        }
      }
      throw e;
    }
  }
}

/** One breaker per provider name and process, shared by every client of that provider. */
const breakers = new Map<string, CircuitBreaker>();
export function processBreaker(name: string, opts?: CircuitOptions): CircuitBreaker {
  let b = breakers.get(name);
  if (!b) {
    b = new CircuitBreaker(name, opts);
    breakers.set(name, b);
  }
  return b;
}

export class BreakerJev implements JevProvider {
  constructor(
    private readonly inner: JevProvider,
    private readonly breaker: CircuitBreaker,
  ) {}
  get model() {
    return this.inner.model;
  }
  ask<Q extends Questions>(
    meta: CallMeta,
    state: EntryType,
    questions: Q,
    opts?: AskOptions,
  ): Promise<JevResult<Q>> {
    return this.breaker.run(() => this.inner.ask(meta, state, questions, opts));
  }
}

export class BreakerLlm implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly breaker: CircuitBreaker,
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
    return this.breaker.run(() => this.inner.structured(schema, messages, opts));
  }
}
