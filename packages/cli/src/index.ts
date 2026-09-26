import { BRAND } from '@remit/core';

export { CliError, EXIT } from './errors.js';
export type { Io } from './io.js';
export { main, usage } from './main.js';

/** The package name, used by smoke tests to prove workspace wiring. */
export const PACKAGE = '@remit/cli';

/** Returns a label that proves this package can import @remit/core. */
export function describePackage(): string {
  return `${BRAND.name} ${PACKAGE}`;
}
