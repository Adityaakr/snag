import { realSleep } from './retry.js';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = { now: () => Date.now(), sleep: realSleep };

/**
 * Two token buckets, one for requests per minute and one for tokens per second (BUILD_PROMPT 7.3).
 * `acquire(tokens)` waits until both have room.
 */
export class RateLimiter {
  private reqTokens: number;
  private tokTokens: number;
  private last: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly requestsPerMinute: number,
    readonly tokensPerSecond: number,
    private readonly clock: Clock = realClock,
  ) {
    this.reqTokens = requestsPerMinute;
    this.tokTokens = tokensPerSecond;
    this.last = clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    this.reqTokens = Math.min(this.requestsPerMinute, this.reqTokens + (dt * this.requestsPerMinute) / 60);
    this.tokTokens = Math.min(this.tokensPerSecond, this.tokTokens + dt * this.tokensPerSecond);
  }

  /** Waits for one request slot and `tokens` token capacity. Requests larger than the bucket wait for a full bucket. */
  acquire(tokens: number): Promise<void> {
    const need = Math.min(tokens, this.tokensPerSecond);
    const run = async () => {
      for (;;) {
        this.refill();
        if (this.reqTokens >= 1 && this.tokTokens >= need) {
          this.reqTokens -= 1;
          this.tokTokens -= need;
          return;
        }
        const reqWait = this.reqTokens >= 1 ? 0 : ((1 - this.reqTokens) * 60_000) / this.requestsPerMinute;
        const tokWait = this.tokTokens >= need ? 0 : ((need - this.tokTokens) * 1000) / this.tokensPerSecond;
        await this.clock.sleep(Math.max(1, Math.ceil(Math.max(reqWait, tokWait))));
      }
    };
    const next = this.queue.then(run);
    this.queue = next.catch(() => {});
    return next;
  }
}

/** Limits how many async tasks run at once. */
export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

/** Minimal structured logger interface; pino satisfies it. */
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {} };
