import { describe, expect, it } from 'vitest';
import { formatMoney, groupThousands, roundHalfAway } from './money.js';

describe('formatMoney', () => {
  it('formats dollars', () => {
    expect(formatMoney(3.5)).toBe('$3.50');
  });

  it('formats USD, EUR and JPY', () => {
    expect(formatMoney(12.5, 'USD')).toBe('$12.50');
    expect(formatMoney(12.5, 'EUR')).toBe('12.50 EUR');
    expect(formatMoney(980, 'JPY')).toBe('980 JPY');
  });

  it('rounds half away from zero', () => {
    expect(roundHalfAway(1.005, 2)).toBe(1.01);
    expect(roundHalfAway(-2.5, 0)).toBe(-3);
    expect(formatMoney(1.005)).toBe('$1.01');
  });

  it('puts the minus sign before the symbol', () => {
    expect(formatMoney(-4.2)).toBe('-$4.20');
  });

  it('groups thousands with commas', () => {
    expect(groupThousands('1000')).toBe('1,000');
    expect(formatMoney(1234567.891)).toBe('$1,234,567.89');
    expect(formatMoney(999)).toBe('$999.00');
  });
});
