import { describe, expect, it } from 'vitest';
import { DurationError, parseDuration, scheduleJob } from './schedule.js';

describe('scheduleJob', () => {
  it('keeps the job name', () => {
    expect(scheduleJob({ name: 'sync', every: '1s' }).name).toBe('sync');
  });

  it('parses seconds, minutes and hours', () => {
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('5m')).toBe(300_000);
    expect(parseDuration('2h')).toBe(7_200_000);
  });

  it('schedules jobs with unit intervals', () => {
    expect(scheduleJob({ name: 'sync', every: '5m' }).intervalMs).toBe(300_000);
  });

  it('throws a DurationError naming the bad value', () => {
    expect(() => parseDuration('soon')).toThrow(DurationError);
    expect(() => parseDuration('soon')).toThrow('cannot parse duration "soon"');
  });

  it('rejects intervals shorter than one second', () => {
    expect(() => scheduleJob({ name: 'spin', every: '0s' })).toThrow(RangeError);
  });

  it('normalizes job names', () => {
    expect(scheduleJob({ name: ' Nightly Sync ', every: '1h' }).name).toBe('nightly sync');
  });
});
