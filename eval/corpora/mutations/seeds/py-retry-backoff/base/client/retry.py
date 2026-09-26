"""Retry helper for outbound HTTP calls."""

import logging
import time

from client.config import retry_settings

log = logging.getLogger("client.retry")


class HttpError(Exception):
    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.status = status


def call_with_retry(fn, sleep=time.sleep):
    settings = retry_settings()
    attempts = settings["max_attempts"]
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except HttpError as error:
            log.debug("attempt %d failed: %s", attempt, error)
            if attempt == attempts:
                raise
            sleep(settings["base_delay"])
