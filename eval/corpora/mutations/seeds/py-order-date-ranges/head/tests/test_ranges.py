from datetime import date, datetime

import pytest

from reports import ranges
from reports.models import Order


def order(day, hour=12):
    return Order(id=f"o-{day}-{hour}", placed_at=datetime(2024, 3, day, hour), total_cents=1000)


def test_parses_closed_range():
    assert ranges.parse_range("2024-03-01..2024-03-31") == (datetime(2024, 3, 1), datetime(2024, 3, 31))


def test_rejects_text_without_separator():
    with pytest.raises(ValueError):
        ranges.parse_range("2024-03-01")


def test_filters_orders_in_range():
    orders = [order(1), order(5), order(9)]
    assert ranges.orders_between(orders, datetime(2024, 3, 2), datetime(2024, 3, 8)) == [orders[1]]


def test_parses_open_ended_ranges():
    assert ranges.parse_range("..2024-03-31") == (None, datetime(2024, 3, 31))
    assert ranges.parse_range("2024-03-01..") == (datetime(2024, 3, 1), None)


def test_filters_open_ended_ranges():
    orders = [order(1), order(20)]
    assert ranges.orders_between(orders, None, datetime(2024, 3, 10)) == [orders[0]]
    assert ranges.orders_between(orders, datetime(2024, 3, 10), None) == [orders[1]]


def test_end_date_is_inclusive():
    orders = [order(8, 23), order(9, 0)]
    assert ranges.orders_between(orders, datetime(2024, 3, 1), datetime(2024, 3, 8)) == [orders[0]]


def test_rejects_start_after_end():
    with pytest.raises(ValueError, match="start after end"):
        ranges.parse_range("2024-03-06..2024-03-05")


def test_named_ranges():
    today = date(2024, 3, 10)
    assert ranges.resolve_range("today", today) == (datetime(2024, 3, 10), datetime(2024, 3, 10))
    assert ranges.resolve_range("this-month", today) == (datetime(2024, 3, 1), datetime(2024, 3, 10))


def test_last_seven_days():
    assert ranges.resolve_range("last-7-days", date(2024, 3, 10)) == (datetime(2024, 3, 4), datetime(2024, 3, 10))


def test_resolve_falls_back_to_explicit_range():
    assert ranges.resolve_range("2024-03-01..2024-03-02", date(2024, 3, 10)) == (
        datetime(2024, 3, 1),
        datetime(2024, 3, 2),
    )
