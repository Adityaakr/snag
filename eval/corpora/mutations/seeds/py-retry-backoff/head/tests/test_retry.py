import logging

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
    with pytest.raises(retry.RetryExhausted) as info:
        retry.call_with_retry(flaky([503] * 5), sleep=lambda s: None)
    assert info.value.attempts == 4
    assert isinstance(info.value.__cause__, retry.HttpError)


def test_backoff_doubles_each_attempt():
    assert retry.backoff_delay(1, 0.5, 30.0) == 0.5
    assert retry.backoff_delay(4, 0.5, 30.0) == 4.0


def test_backoff_is_capped():
    assert retry.backoff_delay(10, 0.5, 8.0) == 8.0


def test_sleeps_grow_between_attempts():
    sleeps = []
    retry.call_with_retry(flaky([503, 503, 503]), sleep=sleeps.append)
    assert sleeps[0] == 0.5
    assert sleeps[0] < sleeps[1] < sleeps[2]


def test_retryable_statuses():
    assert retry.is_retryable(retry.HttpError(429))
    assert retry.is_retryable(retry.HttpError(503))
    assert not retry.is_retryable(retry.HttpError(500))
    assert not retry.is_retryable(retry.HttpError(404))


def test_other_statuses_are_not_retried():
    sleeps = []
    with pytest.raises(retry.HttpError):
        retry.call_with_retry(flaky([404]), sleep=sleeps.append)
    assert sleeps == []


def test_logs_each_retry(caplog):
    caplog.set_level(logging.WARNING, logger="client.retry")
    retry.call_with_retry(flaky([503]), sleep=lambda s: None)
    assert caplog.messages == ["retry 2/4 in 0.5s"]
