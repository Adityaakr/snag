import { BRAND } from '@remit/core';

export * from './cache/store.js';
export * from './common/budget.js';
export * from './common/errors.js';
export * from './common/limits.js';
export * from './common/retry.js';
export { toAnswers } from './jev/answers.js';
export { CachedJev } from './jev/cached.js';
export { FakeJev, type JevScript, type RecordedCall, type ScriptedAnswer } from './jev/fake.js';
export { classifyJevError, LiveJev, type LiveJevOptions, processJevLimiter } from './jev/live.js';
export * from './jev/types.js';
export { validateAnswers } from './jev/validate.js';

/** The package name, used by smoke tests to prove workspace wiring. */
export const PACKAGE = '@remit/providers';

/** Returns a label that proves this package can import @remit/core. */
export function describePackage(): string {
  return `${BRAND.name} ${PACKAGE}`;
}
