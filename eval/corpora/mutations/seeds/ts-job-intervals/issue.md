<!-- issue: acme/scheduler#41 -->
# Human-readable job intervals

Job intervals are raw millisecond strings today, which is easy to get wrong. We want units.

- [ ] Job intervals accept a number with a unit suffix: s, m or h (for example `90s`, `5m`, `2h`)
- [ ] An interval that cannot be parsed throws a `DurationError` that names the bad value
- [ ] Intervals shorter than 1 second are rejected with a `RangeError`
- [ ] Job names are trimmed and lowercased when a job is scheduled
