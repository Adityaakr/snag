# Remit

Remit checks whether a pull request does what its linked issue asked, and nothing it didn't. It returns calibrated, typed verdicts with line-level evidence. `Remit` is a working name; it lives in `packages/core/src/brand.ts`.

The full spec and operating manual is `BUILD_PROMPT.md`. It wins over defaults. Follow its section 3 (operating protocol) every task.

## Where the build state lives

- `.agent/NEXT.md`: the single next action. Read it first.
- `.agent/PROGRESS.md`: milestone status and checked items with evidence.
- `.agent/milestones/M<N>.md`: each milestone as an issue-style spec.
- `.agent/DECISIONS.md`: append-only decisions and spec deviations.
- `.agent/BLOCKERS.md`: open problems and exact human unblock steps.
- `.agent/EXPERIMENTS.md`, `.agent/SESSION_LOG.md`.

## Repo map

- `packages/core`: contracts, brand, config, extraction prompt and validation, verdicts, routing, renderers. Pure, no I/O.
- `packages/analysis`: diff parsing, file classes, tree-sitter, units, comment stripping, code facts, retrieval.
- `packages/providers`: Jev, LLM and GitHub adapters, fakes, record and replay, budgets.
- `packages/pipeline`: one review end to end.
- `packages/cli`: the `remit` command.
- `packages/server`, `packages/dashboard`, `packages/action`: GitHub App, React dashboard, GitHub Action.
- `packages/eval`: corpora, mutations, metrics, calibration, baselines, reports.
- `fixtures/`, `eval/`, `schemas/`, `docs/`, `scripts/` (progress, guards, hooks).

## Commands

- `pnpm verify`: format check, lint, typecheck, tests with coverage, guards. Must pass before every commit. Keep it under 3 minutes.
- `pnpm test`, `pnpm test:slow`, `pnpm test:live` (skips without keys).
- `pnpm progress`, `pnpm progress --check`, `pnpm guard`.
- `pnpm format` fixes formatting.

## Conventions

- Node 22, ESM, TypeScript 5 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), zod for every contract.
- Tests next to code as `*.test.ts`; slow suites `*.slow.test.ts`; live suites `*.live.test.ts`.
- Unit tests have no network (`scripts/test-setup.ts`). Use fakes or msw.
- Package imports use `@remit/<name>`; files import siblings with `.js` suffixes.
- Every user-facing name comes from `BRAND`.
- Copy: sentence case headings, plain words, no em-dashes, numbers in monospace.
- Commits: conventional, name the milestone, e.g. `feat(core): verdict engine [M4]`.
- Fake secrets in tests are assembled at runtime so `guard:secrets` stays green.

## Non-negotiable rules (BUILD_PROMPT 3.4)

1. Never edit `BUILD_PROMPT.md`, `GOAL.txt`, `loop.sh` or `START_HERE.md`. Record spec problems in DECISIONS.md.
2. Never delete, skip, weaken or loosen a test, or lower a threshold, to pass a check.
3. Never modify eval test-split files after the M6 freeze. Tune on dev only.
4. Never print, log, echo or commit secrets. Never read `.env` files.
5. Never execute code from a PR under review.
6. No stub is marked done. Stubs need an interface, a BLOCKERS entry, a `pending: ...` test, and an unchecked item.
7. Every external call goes through `providers`, with fakes and record and replay.
8. Keep `pnpm verify` under 3 minutes.
9. Commit at least once per completed task. Never end a turn with uncommitted work.
10. Don't push unless the human configured a remote and asked.

## Milestone gate (BUILD_PROMPT 3.3)

All items checked with evidence, `pnpm verify` green, `milestone-verifier` subagent returns `VERDICT: PASS`, status `DONE`, committed, tag `m<N>-done`.

## Pointers

- Jev and LLM facts: `docs/providers.md`. Spec sections: contracts 5, pipeline 6, Jev 7, LLM 8, security 9, surfaces 10, eval 11, quality 12, milestones 13.
