from datetime import datetime, timedelta
from src.orders import list_orders


def test_recent_is_seven_days():
    now = datetime(2026, 9, 10)
    old = type("O", (), {"created_at": now - timedelta(days=8)})
    new = type("O", (), {"created_at": now - timedelta(days=6)})
    assert list_orders([old, new], now) == [new]
