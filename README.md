# Remit

Remit checks whether a pull request does what its linked issue asked, and nothing it didn't.

It reads the issue without looking at the PR, lists each requirement, then checks the diff in both directions: where each requirement is implemented, and which requirement each change serves. Every verdict is typed, carries a confidence and points at exact lines.

## Status

Early build. Milestone `M0` (bootstrap) is in progress. See `.agent/PROGRESS.md`.

## Quickstart

Coming in `M5`: `pnpm install` then `pnpm demo` runs an offline demo in under `10 s`.
