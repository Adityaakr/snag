"""Date-range filters for the orders report."""

from datetime import datetime, timedelta


def parse_day(text):
    return datetime.strptime(text, "%Y-%m-%d")


def next_day(moment):
    return moment + timedelta(days=1)


def parse_range(text):
    left, sep, right = text.partition("..")
    if not sep:
        raise ValueError(f"not a range: {text}")
    start = parse_day(left) if left else None
    end = parse_day(right) if right else None
    if start and end and start > end:
        raise ValueError("start after end")
    return start, end


def named_range(name, today):
    start = datetime(today.year, today.month, today.day)
    if name == "today":
        return start, start
    if name == "last-7-days":
        return start - timedelta(days=6), start
    if name == "this-month":
        return start.replace(day=1), start
    return None


def resolve_range(text, today):
    named = named_range(text, today)
    return named if named else parse_range(text)


def orders_between(orders, start, end):
    selected = []
    for order in orders:
        if start is not None and order.placed_at < start:
            continue
        if end is not None and order.placed_at >= next_day(end):
            continue
        selected.append(order)
    return selected
