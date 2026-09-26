from datetime import datetime

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
