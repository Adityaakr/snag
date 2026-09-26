from datetime import datetime, timedelta


def list_orders(orders, now=None):
    now = now or datetime.utcnow()
    cutoff = now - timedelta(days=7)
    return [o for o in orders if o.created_at >= cutoff]
