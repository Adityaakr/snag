"""Report data types."""

from dataclasses import dataclass
from datetime import datetime


@dataclass
class Order:
    id: str
    placed_at: datetime
    total_cents: int
