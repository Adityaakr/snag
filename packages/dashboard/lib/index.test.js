import { describe, expect, it } from 'vitest';
import { describePackage, PACKAGE } from './index.js';
describe('dashboard smoke', () => {
  it('imports core through the workspace', () => {
    expect(PACKAGE).toBe('@remit/dashboard');
    expect(describePackage()).toBe('Remit @remit/dashboard');
  });
});
//# sourceMappingURL=index.test.js.map
