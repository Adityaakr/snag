import { describe, expect, it } from 'vitest';
import { BRAND, PACKAGE } from './index.js';

describe('core smoke', () => {
  it('exposes the brand constant', () => {
    expect(PACKAGE).toBe('@remit/core');
    expect(BRAND.slug).toBe('remit');
    expect(BRAND.slashCommand).toBe(`/${BRAND.slug}`);
  });
});
