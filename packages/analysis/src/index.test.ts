import { describe, expect, it } from 'vitest';
import { describePackage, PACKAGE } from './index.js';

describe('analysis smoke', () => {
  it('imports core through the workspace', () => {
    expect(PACKAGE).toBe('@remit/analysis');
    expect(describePackage()).toBe('Remit @remit/analysis');
  });
});
