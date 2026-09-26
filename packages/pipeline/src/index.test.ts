import { describe, expect, it } from 'vitest';
import { describePackage, PACKAGE } from './index.js';

describe('pipeline smoke', () => {
  it('imports core through the workspace', () => {
    expect(PACKAGE).toBe('@remit/pipeline');
    expect(describePackage()).toBe('Remit @remit/pipeline');
  });
});
