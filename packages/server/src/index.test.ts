import { describe, expect, it } from 'vitest';
import { describePackage, PACKAGE } from './index.js';

describe('server smoke', () => {
  it('imports core through the workspace', () => {
    expect(PACKAGE).toBe('@remit/server');
    expect(describePackage()).toBe('Remit @remit/server');
  });
});
