import { describe, expect, it } from 'vitest';
import { estimateTokens } from './tokens.js';

describe('estimateTokens', () => {
  it.each([
    ['', 0],
    ['a', 1],
    ['abc', 1],
    ['abcd', 2],
  ])('estimates %j as %i', (text, n) => {
    expect(estimateTokens(text)).toBe(n);
  });

  it('serializes JSON values', () => {
    expect(estimateTokens({ a: 1 })).toBe(Math.ceil('{"a":1}'.length / 3));
    expect(estimateTokens(undefined)).toBe(2);
  });
});
