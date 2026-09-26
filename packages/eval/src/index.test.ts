import { describe, expect, it } from 'vitest';
import { describePackage, PACKAGE } from './index.js';

describe('eval smoke', () => {
  it('imports core through the workspace', () => {
    expect(PACKAGE).toBe('@remit/eval');
    expect(describePackage()).toBe('Remit @remit/eval');
  });
});
