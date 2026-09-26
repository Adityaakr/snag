import { BRAND } from '@remit/core';

export * from './extract.js';
export * from './stages.js';
export * from './types.js';

/** The package name, used by smoke tests to prove workspace wiring. */
export const PACKAGE = '@remit/pipeline';

/** Returns a label that proves this package can import @remit/core. */
export function describePackage(): string {
  return `${BRAND.name} ${PACKAGE}`;
}
export * from './review.js';
