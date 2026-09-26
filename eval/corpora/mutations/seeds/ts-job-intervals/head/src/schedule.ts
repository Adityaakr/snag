import { jobDefaults } from './config.js';

export interface Job {
  name: string;
  every: string;
}

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  timeoutMs: number;
}

export class DurationError extends Error {
  constructor(readonly input: string) {
    super(`cannot parse duration "${input}"`);
    this.name = 'DurationError';
  }
}

export function parseDuration(text: string): number {
  const match = /^(\d+)([smh])$/.exec(text.trim());
  if (!match) throw new DurationError(text);
  const amount = Number(match[1]);
  switch (match[2]) {
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60_000;
    case 'h':
      return amount * 3_600_000;
  }
  throw new DurationError(text);
}

export function scheduleJob(job: Job): ScheduledJob {
  const intervalMs = parseDuration(job.every);
  if (intervalMs < 1000) {
    throw new RangeError(`interval for ${job.name} is shorter than 1 second`);
  }
  const name = job.name.trim().toLowerCase();
  return { name, intervalMs, timeoutMs: jobDefaults().timeoutMs };
}
