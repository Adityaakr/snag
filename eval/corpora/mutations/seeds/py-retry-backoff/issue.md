<!-- issue: fieldkit/api-client#58 -->
# Smarter retries for outbound HTTP calls

`call_with_retry` retries every HTTP error with the same fixed delay, which hammers upstreams that are already struggling and retries errors that will never succeed.

- [ ] Delays between attempts start at `base_delay` and double each time, capped at `max_delay` (with a base of 0.5s: 0.5, 1, 2, 4)
- [ ] Only status 429 and the gateway errors 502, 503 and 504 are retried; any other status is raised on the first failure
- [ ] When the last attempt fails, raise `RetryExhausted` with the number of attempts and the last HTTP error as its cause
- [ ] Each retry logs a warning such as `retry 2/4 in 0.5s` (next attempt, max attempts, delay)
