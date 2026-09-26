"""Money formatting for report cells."""

from reports.config import report_defaults


def format_cents(cents, currency=None):
    code = currency or report_defaults()["currency"]
    sign = "-" if cents < 0 else ""
    whole, rest = divmod(abs(cents), 100)
    return f"{sign}{code} {whole:,}.{rest:02d}"
