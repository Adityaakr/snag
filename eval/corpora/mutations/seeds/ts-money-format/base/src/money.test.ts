import { describe, expect, it } from 'vitest';
import { formatMoney } from './money.js';

describe('formatMoney', () => {
  it('formats dollars', () => {
    expect(formatMoney(3.5)).toBe('$3.50');
  });
});
