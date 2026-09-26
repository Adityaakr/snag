import { BRAND } from '@remit/core';
export { App } from './App.js';
export { colors, contrast, STATUS } from './theme.js';
/** The package name, used by smoke tests to prove workspace wiring. */
export const PACKAGE = '@remit/dashboard';
/** Returns a label that proves this package can import @remit/core. */
export function describePackage() {
  return `${BRAND.name} ${PACKAGE}`;
}
//# sourceMappingURL=index.js.map
