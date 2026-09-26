/**
 * The durable job queue (BUILD_PROMPT 10.4): pg-boss queues `review`, `reextract`, `command`, `cleanup` and
 * `recalibrate`, with retries and backoff, and a dead-letter queue shown in the dashboard. Pushes to the same PR are
 * debounced with `sendDebounced`, and a newer job for a key aborts the running one in this process. Across
 * processes, the review job re-checks the head SHA before publishing.
 */
import type { PgBoss } from 'pg-boss';
import type { JobHandler, JobQueue, JobSpec, QueueHooks } from './queue.js';

export const QUEUES = ['review', 'reextract', 'command', 'cleanup', 'recalibrate'] as const;
export const DEAD_LETTER = 'dead';
export type QueueName = (typeof QUEUES)[number];

export function queueOf(job: JobSpec): QueueName {
  switch (job.kind) {
    case 'review':
      return 'review';
    case 'issue':
      return 'reextract';
    case 'slash':
      return 'command';
    default:
      return job.kind;
  }
}

export interface DeadLetter {
  id: string;
  key: string;
  kind: string;
  createdOn: Date;
  /** Present for jobs tied to one installation; the dashboard shows a dead letter only to its installation's users. */
  installationId?: number;
}

/** The installation a job belongs to (slash jobs carry it in their webhook payload). */
export function installationOf(job: JobSpec): number | undefined {
  if (job.kind === 'review' || job.kind === 'issue') return job.installationId;
  if (job.kind === 'slash') {
    const id = (job.event as { installation?: { id?: unknown } } | null)?.installation?.id;
    return typeof id === 'number' ? id : undefined;
  }
  return undefined;
}

interface Envelope {
  key: string;
  job: JobSpec;
}

export interface PgQueueOptions {
  retryLimit?: number;
  retryDelaySeconds?: number;
  retryBackoff?: boolean;
  pollingIntervalSeconds?: number;
  /** Jobs this process runs at once per queue (pg-boss localConcurrency; default 4). */
  concurrency?: number;
  /** Cron for the nightly jobs (UTC). Null disables scheduling (tests). */
  cleanupCron?: string | null;
  recalibrateCron?: string | null;
  hooks?: QueueHooks;
}

export class PgBossQueue implements JobQueue {
  private handler: JobHandler | undefined;
  private readonly running = new Map<string, AbortController>();
  private started = false;

  constructor(
    private readonly boss: PgBoss,
    private readonly opts: PgQueueOptions = {},
  ) {}

  setHandler(handler: JobHandler): void {
    this.handler = handler;
  }

  /** Creates the queues and schedules; with `consume: false` (the web role) this process only sends jobs. */
  async start(opts: { consume?: boolean } = {}): Promise<void> {
    if (this.started) return;
    this.started = true;
    const consume = opts.consume ?? true;
    // Create each queue once; a real failure (for example a lost connection) surfaces instead of being swallowed.
    const ensure = async (name: string, options?: Parameters<PgBoss['createQueue']>[1]) => {
      if (!(await this.boss.getQueue(name))) await this.boss.createQueue(name, options);
    };
    await ensure(DEAD_LETTER);
    for (const name of QUEUES) {
      await ensure(name, {
        retryLimit: this.opts.retryLimit ?? 3,
        retryDelay: this.opts.retryDelaySeconds ?? 30,
        retryBackoff: this.opts.retryBackoff ?? true,
        deadLetter: DEAD_LETTER,
      });
      if (!consume) continue;
      await this.boss.work<Envelope>(
        name,
        {
          pollingIntervalSeconds: this.opts.pollingIntervalSeconds ?? 2,
          batchSize: 1,
          localConcurrency: this.opts.concurrency ?? 4,
        },
        async (jobs) => {
          for (const j of jobs) await this.run(j.data);
        },
      );
    }
    if (this.opts.cleanupCron !== null)
      await this.boss.schedule('cleanup', this.opts.cleanupCron ?? '15 3 * * *', {
        key: 'cleanup',
        job: { kind: 'cleanup' },
      });
    if (this.opts.recalibrateCron !== null)
      await this.boss.schedule('recalibrate', this.opts.recalibrateCron ?? '45 3 * * *', {
        key: 'recalibrate',
        job: { kind: 'recalibrate' },
      });
  }

  private async run({ key, job }: Envelope): Promise<void> {
    if (!this.handler) throw new Error('the queue has no job handler');
    const previous = this.running.get(key);
    if (previous) {
      previous.abort();
      this.opts.hooks?.onCancel?.(key);
    }
    const controller = new AbortController();
    this.running.set(key, controller);
    try {
      await this.handler(job, controller.signal);
    } catch (e) {
      this.opts.hooks?.onError?.(key, e);
      // Rethrow so pg-boss retries, then dead-letters after the last attempt.
      throw e;
    } finally {
      if (this.running.get(key) === controller) this.running.delete(key);
    }
  }

  async enqueue(key: string, job: JobSpec, opts: { debounceMs?: number } = {}): Promise<void> {
    const name = queueOf(job);
    const data: Envelope = { key, job };
    const seconds = Math.ceil((opts.debounceMs ?? 0) / 1000);
    if (seconds > 0) await this.boss.sendDebounced(name, data, null, seconds, key);
    else await this.boss.send(name, data);
  }

  /** Jobs that failed every retry (the dashboard's dead-letter list). */
  async deadLetters(): Promise<DeadLetter[]> {
    const jobs = await this.boss.findJobs<Envelope>(DEAD_LETTER);
    return jobs.map((j) => {
      const installationId = installationOf(j.data.job);
      return {
        id: j.id,
        key: j.data.key,
        kind: j.data.job.kind,
        createdOn: j.createdOn,
        ...(installationId !== undefined ? { installationId } : {}),
      };
    });
  }

  /** Waits until every queue is drained (tests and graceful shutdown). */
  async idle(timeoutMs = 30_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      // Queue stats are cached by pg-boss's monitor, so count waiting jobs directly; running ones are local.
      let busy = this.running.size;
      for (const name of QUEUES) busy += (await this.boss.findJobs(name, { queued: true })).length;
      if (!busy) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the job queue did not drain in time');
  }
}
