# Parse job intervals with units

Adds `parseDuration` for `s`, `m` and `h` suffixes and uses it in `scheduleJob`. Bad input throws `DurationError`, intervals under a second throw `RangeError`, and job names are normalized. Tests cover each case.
