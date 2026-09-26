import pytest

from client import retry


def flaky(statuses):
    calls = []

    def fn():
        calls.append(1)
        if len(calls) <= len(statuses):
            raise retry.HttpError(statuses[len(calls) - 1])
        return "ok"

    return fn


def test_returns_first_success():
    assert retry.call_with_retry(lambda: "ok", sleep=lambda s: None) == "ok"


def test_retries_until_success():
    sleeps = []
    assert retry.call_with_retry(flaky([503, 503]), sleep=sleeps.append) == "ok"
    assert len(sleeps) == 2


def test_gives_up_after_max_attempts():
    with pytest.raises(retry.HttpError):
        retry.call_with_retry(flaky([503] * 5), sleep=lambda s: None)
