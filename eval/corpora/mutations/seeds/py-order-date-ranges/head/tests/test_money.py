import pytest

from reports.money import format_cents


def test_formats_thousands():
    assert format_cents(123456) == "USD 1,234.56"


def test_formats_negative_amounts():
    assert format_cents(-5, "EUR") == "-EUR 0.05"
