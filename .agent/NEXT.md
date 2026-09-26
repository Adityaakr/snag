# Next

Milestone: M2 Providers, budgets, record and replay
Task: the Jev adapter (BUILD_PROMPT 7.3, DECISIONS D5).

Next action:
1. `pnpm --filter @remit/providers add @typesafe-ai/sdk@0.6.0 --save-exact`.
2. packages/providers/src/jev/: `JevProvider` interface, `CallMeta`, question builders re-exported from the SDK, answer validation with zod (every question present, choice in keys, probabilities sum to 1 within 1e-3, ranges).
3. `FakeJev`: scripts keyed by (scenario, kind, targetId, questionId); throws on unscripted calls; records states.
4. `LiveJev`: SDK client with `retry: { maxRetries: 0 }`, explicit model and logLevel; own backoff (429/529/timeouts, retry-after, 5 attempts, jitter), process-wide token bucket, 400/422 overflow shrink-and-retry via a caller-provided shrink function (3 retries), cost accounting with a per-review budget, model logging. Test with the SDK's injectable `fetch` (no network).
5. Then `CachedJev` and the record-and-replay store (7.4).
Note: the SDK accepts `fetch` in TypeSafeClientConfig, which lets tests drive the real error mapping.
