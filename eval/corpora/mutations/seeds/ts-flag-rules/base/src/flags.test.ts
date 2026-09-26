import { describe, expect, it } from 'vitest';
import { isEnabled } from './flags.js';

const ana = { id: 'u1', email: 'ana@Example.com', country: 'DE' };
const base = { flag: 'beta', enabled: true };

describe('isEnabled', () => {
  it('returns the enabled value of the matching rule', () => {
    expect(isEnabled([base], 'beta', ana)).toBe(true);
    expect(isEnabled([{ ...base, enabled: false }], 'beta', ana)).toBe(false);
    expect(isEnabled([base], 'other', ana)).toBe(false);
  });
});
