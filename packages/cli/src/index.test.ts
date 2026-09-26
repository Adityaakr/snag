import { describe, expect, it } from 'vitest';
import { describePackage, PACKAGE } from './index.js';

describe('cli smoke', () => {
  it('imports core through the workspace', () => {
    expect(PACKAGE).toBe('@remit/cli');
    expect(describePackage()).toBe('Remit @remit/cli');
  });
});
