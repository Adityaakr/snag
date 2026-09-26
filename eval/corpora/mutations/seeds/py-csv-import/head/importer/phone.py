"""Phone number helpers."""


def normalize_phone(raw):
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 10:
        digits = "1" + digits
    return "+" + digits
