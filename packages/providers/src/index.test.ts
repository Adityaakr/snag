import { describe, expect, it } from 'vitest';
import { describePackage, PACKAGE } from './index.js';

describe('providers smoke', () => {
  it('imports core through the workspace', () => {
    expect(PACKAGE).toBe('@remit/providers');
    expect(describePackage()).toBe('Remit @remit/providers');
  });
});
