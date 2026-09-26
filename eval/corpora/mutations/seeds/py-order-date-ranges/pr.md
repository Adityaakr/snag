# Open-ended, inclusive and named report ranges

`parse_range` now accepts a missing start or end and rejects ranges whose start is after the end. `orders_between` treats a missing bound as open and includes the whole end day by comparing against the start of the next day. The new `resolve_range` maps `today`, `last-7-days` and `this-month` to concrete ranges ending on the given day and falls back to `parse_range` for anything else.
