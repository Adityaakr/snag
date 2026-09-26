import { describe, expect, it } from 'vitest';
import { bucketOf, isEnabled } from './flags.js';

const ana = { id: 'u1', email: 'ana@Example.com', country: 'DE' };
const base = { flag: 'beta', enabled: true };

describe('isEnabled', () => {
  it('returns the enabled value of the matching rule', () => {
    expect(isEnabled([base], 'beta', ana)).toBe(true);
    expect(isEnabled([{ ...base, enabled: false }], 'beta', ana)).toBe(false);
    expect(isEnabled([base], 'other', ana)).toBe(false);
  });

  it('targets countries and email domains', () => {
    const rules = [{ ...base, countries: ['DE', 'FR'], domains: ['example.com'] }];
    expect(isEnabled(rules, 'beta', ana)).toBe(true);
    expect(isEnabled(rules, 'beta', { ...ana, country: 'US' })).toBe(false);
    expect(isEnabled(rules, 'beta', { ...ana, email: 'ana@other.org' })).toBe(false);
  });

  it('keeps a user in the same bucket', () => {
    expect(bucketOf('beta', 'u1')).toBe(bucketOf('beta', 'u1'));
    expect(bucketOf('beta', 'u1')).toBeGreaterThanOrEqual(0);
    expect(bucketOf('beta', 'u1')).toBeLessThan(100);
  });

  it('rolls out to everyone at 100 percent and no one at 0 percent', () => {
    const users = Array.from({ length: 50 }, (_, i) => ({ ...ana, id: `u${i}` }));
    const count = (percent: number) => users.filter((u) => isEnabled([{ ...base, percent }], 'beta', u)).length;
    expect(count(100)).toBe(50);
    expect(count(0)).toBe(0);
  });

  it('turns on exactly at startsAt', () => {
    const rules = [{ ...base, startsAt: '2026-10-01T00:00:00Z' }];
    expect(isEnabled(rules, 'beta', ana, new Date('2026-09-30T23:59:59Z'))).toBe(false);
    expect(isEnabled(rules, 'beta', ana, new Date('2026-10-01T00:00:00Z'))).toBe(true);
  });

  it('lets allow-listed users skip the other checks', () => {
    const rules = [{ ...base, countries: ['FR'], percent: 0, allowUsers: ['u1'] }];
    expect(isEnabled(rules, 'beta', ana)).toBe(true);
  });
});
