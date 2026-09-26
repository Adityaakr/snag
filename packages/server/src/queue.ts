/**
 * The job queue (BUILD_PROMPT 10.2): jobs for the same key (one PR) are debounced, so a burst of `synchronize`
 * events within the window collapses into one review of the latest head, and a newer job cancels a running one
 * through its AbortSignal. In-memory for M7; pg-boss replaces it in M8 behind the same interface.
 */
/** A job as data, so a durable queue (pg-boss) can store it. Slash events are kept as their parsed payload. */
export type JobSpec =
  | { kind: 'review'; installationId: number; owner: string; repo: string; pr: number }
  | { kind: 'slash'; event: unknown }
  | {
      kind: 'issue';
      installationId: number;
      owner: string;
      repo: string;
      number: number;
      action: string;
      label?: string;
    }
  | { kind: 'cleanup' }
  | { kind: 'recalibrate' };

export type JobHandler = (job: JobSpec, signal: AbortSignal) => Promise<void>;

export interface JobQueue {
  enqueue(key: string, job: JobSpec, opts?: { debounceMs?: number }): void | Promise<void>;
  /** The function that runs jobs; createApp sets it. */
  setHandler(handler: JobHandler): void;
  /** Resolves when nothing is pending or running (in-memory queues; durable queues resolve at once). */
  idle(): Promise<void>;
}

export interface QueueHooks {
  onError?: (key: string, error: unknown) => void;
  onCancel?: (key: string) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Slot {
  timer?: unknown;
  pending?: JobSpec | undefined;
  running?: { controller: AbortController; done: Promise<void> } | undefined;
}

export class MemoryQueue implements JobQueue {
  private readonly slots = new Map<string, Slot>();
  private readonly waiters: (() => void)[] = [];
  private handler: JobHandler | undefined;

  constructor(private readonly hooks: QueueHooks = {}) {}

  setHandler(handler: JobHandler): void {
    this.handler = handler;
  }

  private get setTimer() {
    return this.hooks.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  }
  private get clearTimer() {
    return this.hooks.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  enqueue(key: string, job: JobSpec, opts: { debounceMs?: number } = {}): void {
    const slot = this.slots.get(key) ?? {};
    this.slots.set(key, slot);
    slot.pending = job;
    if (slot.timer !== undefined) this.clearTimer(slot.timer);
    const delay = opts.debounceMs ?? 0;
    slot.timer = this.setTimer(() => this.start(key), delay);
  }

  private start(key: string): void {
    const slot = this.slots.get(key);
    if (!slot?.pending) return;
    slot.timer = undefined;
    const job = slot.pending;
    slot.pending = undefined;
    if (slot.running) {
      // A newer job supersedes the running one.
      slot.running.controller.abort();
      this.hooks.onCancel?.(key);
    }
    const controller = new AbortController();
    const previous = slot.running?.done ?? Promise.resolve();
    const done = previous
      .then(() => {
        if (!this.handler) throw new Error('the queue has no job handler');
        return this.handler(job, controller.signal);
      })
      .catch((e) => {
        if (!controller.signal.aborted) this.hooks.onError?.(key, e);
      })
      .finally(() => {
        if (slot.running?.controller === controller) slot.running = undefined;
        if (!slot.running && !slot.pending && slot.timer === undefined) this.slots.delete(key);
        this.notify();
      });
    slot.running = { controller, done };
  }

  private notify(): void {
    if (this.slots.size) return;
    for (const w of this.waiters.splice(0)) w();
  }

  idle(): Promise<void> {
    if (!this.slots.size) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
