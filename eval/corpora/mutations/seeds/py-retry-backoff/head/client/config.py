"""Runtime settings for the HTTP client."""


def retry_settings():
    return {"max_attempts": 4, "base_delay": 0.5, "max_delay": 8.0}
