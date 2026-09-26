import { BRAND } from '@remit/core';

export * from './diff/parse.js';
export * from './diff/render.js';
export * from './git/local.js';

/** The package name, used by smoke tests to prove workspace wiring. */
export const PACKAGE = '@remit/analysis';

/** Returns a label that proves this package can import @remit/core. */
export function describePackage(): string {
  return `${BRAND.name} ${PACKAGE}`;
}
export * from './files/classify.js';
export * from './files/gitattributes.js';
export * from './files/glob.js';
export * from './syntax/strip.js';
export * from './syntax/treesitter.js';
export * from './units/build.js';
export * from './facts/index.js';
export * from './retrieval/index.js';
