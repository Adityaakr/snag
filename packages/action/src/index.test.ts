import { describe, expect, it } from 'vitest';
import { describePackage, PACKAGE } from './index.js';

describe('action smoke', () => {
  it('imports core through the workspace', () => {
    expect(PACKAGE).toBe('@remit/action');
    expect(describePackage()).toBe('Remit @remit/action');
  });
});
