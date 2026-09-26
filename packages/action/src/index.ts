import { BRAND } from '@remit/core';

/** The package name, used by smoke tests to prove workspace wiring. */
export const PACKAGE = '@remit/action';

/** Returns a label that proves this package can import @remit/core. */
export function describePackage(): string {
  return `${BRAND.name} ${PACKAGE}`;
}
