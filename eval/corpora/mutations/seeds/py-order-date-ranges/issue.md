<!-- issue: ledgerly/reports#77 -->
# Flexible date ranges in the orders report

The orders report only takes a closed `start..end` range and silently drops orders placed during the last day. Finance wants open-ended and named ranges.

- [ ] A range may leave out either side to be open-ended: `..2024-03-31` has no start and `2024-03-01..` has no end
- [ ] The end date is inclusive: an order placed at 23:00 on 2024-03-08 is inside `2024-03-01..2024-03-08`
- [ ] A range whose start is after its end raises `ValueError` with the message `start after end`
- [ ] `resolve_range` understands the named ranges `today`, `last-7-days` and `this-month`, counted back from a given day and including it (`last-7-days` on 2024-03-10 is 2024-03-04 to 2024-03-10)
