import { describe, expect, it } from 'vitest';
import { parseRules, refreshIntervalMs } from './loader.js';

describe('loader', () => {
  it('parses a rule list', () => {
    expect(parseRules('[{"flag":"beta","enabled":true}]')).toEqual([{ flag: 'beta', enabled: true }]);
  });

  it('rejects a non-array document', () => {
    expect(() => parseRules('{}')).toThrow(TypeError);
  });

  it('refreshes every minute', () => {
    expect(refreshIntervalMs()).toBe(60_000);
  });
});
