"""Retry helper for outbound HTTP calls."""

import logging
import time

from client.config import retry_settings

log = logging.getLogger("client.retry")


class HttpError(Exception):
    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.status = status


class RetryExhausted(Exception):
    def __init__(self, attempts):
        super().__init__(f"gave up after {attempts} attempts")
        self.attempts = attempts


def is_retryable(error):
    if error.status == 429:
        return True
    if error.status in (502, 503, 504):
        return True
    return False


def backoff_delay(attempt, base_delay, max_delay):
    return min(base_delay * 2 ** (attempt - 1), max_delay)


def call_with_retry(fn, sleep=time.sleep):
    settings = retry_settings()
    attempts = settings["max_attempts"]
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except HttpError as error:
            log.debug("attempt %d failed: %s", attempt, error)
            if not is_retryable(error):
                raise
            if attempt == attempts:
                raise RetryExhausted(attempts) from error
            delay = backoff_delay(attempt, settings["base_delay"], settings["max_delay"])
            log.warning("retry %d/%d in %.1fs", attempt + 1, attempts, delay)
            sleep(delay)
