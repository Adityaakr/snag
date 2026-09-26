# Exponential backoff and selective retries

`call_with_retry` now waits `backoff_delay(attempt)` between attempts, which doubles from `base_delay` up to `max_delay`. `is_retryable` limits retries to 429, 502, 503 and 504. After the last attempt the helper raises `RetryExhausted` chained to the last `HttpError`, and every retry logs a warning with the attempt and delay. The existing give-up test now expects `RetryExhausted`.
