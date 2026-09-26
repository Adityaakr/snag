import { describe, expect, it } from 'vitest';
import { toQueryString } from './query.js';

describe('toQueryString', () => {
  it('encodes values and skips undefined ones', () => {
    expect(toQueryString({ q: 'a b', page: undefined })).toBe('?q=a%20b');
  });

  it('returns an empty string without params', () => {
    expect(toQueryString({})).toBe('');
  });
});
