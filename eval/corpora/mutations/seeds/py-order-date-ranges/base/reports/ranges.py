"""Date-range filters for the orders report."""

from datetime import datetime


def parse_day(text):
    return datetime.strptime(text, "%Y-%m-%d")


def parse_range(text):
    left, sep, right = text.partition("..")
    if not sep:
        raise ValueError(f"not a range: {text}")
    return parse_day(left), parse_day(right)


def orders_between(orders, start, end):
    selected = []
    for order in orders:
        if order.placed_at < start or order.placed_at > end:
            continue
        selected.append(order)
    return selected
