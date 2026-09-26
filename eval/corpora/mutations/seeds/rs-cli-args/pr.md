# Short flag aliases, jobs range check, `--` terminator and file dedup

`parse_args` now runs each argument through a new `expand_alias` helper that maps `-v` to `--verbose` and `-j` to `--jobs`. `parse_jobs` rejects values outside 1 to 64 with a new `ArgError::JobsOutOfRange` variant. After a bare `--`, every remaining argument is pushed as a file. Finally, `dedup_files` removes repeated file names while keeping the first occurrence. Integration tests in `tests/cli.rs` cover each flag.
