import { BRAND } from '@remit/core';

export { createApp, type ServerDeps } from './app.js';
export { MemoryDeliveryStore } from './deliveries.js';
export { type AppDeps, handleEvent } from './events.js';
// Test harnesses: a golden scenario as a fake GitHub repository, and a fake GitHub API over HTTP.
export { type FakeRepo, fakeRepo } from './fake-harness.js';
export { fakeGitHubApi } from './fake-github-server.js';
export { Metrics } from './metrics.js';
export { MemoryQueue } from './queue.js';
export { type JobDeps, reviewPullRequest } from './review-job.js';
export { MemoryStore } from './store.js';
export { signBody, verifySignature } from './webhook-verify.js';

/** The package name, used by smoke tests to prove workspace wiring. */
export const PACKAGE = '@remit/server';

/** Returns a label that proves this package can import @remit/core. */
export function describePackage(): string {
  return `${BRAND.name} ${PACKAGE}`;
}
