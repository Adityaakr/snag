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

export function scheduleJob(job: Job): ScheduledJob {
  const intervalMs = Number(job.every);
  return { name: job.name, intervalMs, timeoutMs: jobDefaults().timeoutMs };
}
