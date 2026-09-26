import { describe, expect, it } from 'vitest';
import { formatBytes } from './format.js';

describe('formatBytes', () => {
  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('keeps small values in bytes', () => {
    expect(formatBytes(12)).toBe('12.0 B');
  });
});
