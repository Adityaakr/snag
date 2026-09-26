import { describe, expect, it } from 'vitest';
import { scheduleJob } from './schedule.js';

describe('scheduleJob', () => {
  it('keeps the job name', () => {
    expect(scheduleJob({ name: 'sync', every: '1000' }).name).toBe('sync');
  });
});
