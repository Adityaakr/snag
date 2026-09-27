import { BRAND } from '@remit/core';

export * from './calibration.js';
export * from './corpora/golden.js';
export * from './item.js';
export * from './metrics.js';
export * from './runner.js';
export * from './simulated.js';

/** The package name, used by smoke tests to prove workspace wiring. */
export const PACKAGE = '@remit/eval';

/** Returns a label that proves this package can import @remit/core. */
export function describePackage(): string {
  return `${BRAND.name} ${PACKAGE}`;
}
export * from './baselines.js';
export * from './corpora/files.js';
export * from './report.js';
export * from './mutations/ast.js';
export * from './mutations/generate.js';
export * from './mutations/operators.js';
export * from './mutations/seed.js';
export * from './corpora/swebench.js';
export * from './corpora/swebench-fetch.js';
export * from './tuning.js';
export * from './calibrate.js';
export * from './corpora/shadow.js';
export * from './mutations/mine.js';
export * from './stability.js';
export * from './oracle.js';
export * from './adjudications.js';
export * from './compare/score.js';
