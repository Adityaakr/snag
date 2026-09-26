<!-- issue: lintr/argkit#33 -->
# CLI flags: short aliases, a jobs limit, `--` and duplicate files

A few rough edges in `lintr` argument parsing keep coming up in bug reports.

- [ ] `-v` is a short alias for `--verbose` and `-j` for `--jobs` (for example `-j 8`)
- [ ] `--jobs` only accepts values from 1 to 64; anything else fails with `ArgError::JobsOutOfRange`
- [ ] A bare `--` ends flag parsing: every later argument is treated as a file, even if it starts with `-`
- [ ] Duplicate files are dropped, keeping the first occurrence (for example `a b a` gives `a b`)
