# Contributing to Remit

Thanks for helping. Remit checks whether a pull request does what its linked issue asked, so its own changes are held to the same standard: every change links an issue, and the issue says what done means.

## Setup

- Node 22 (`.nvmrc`) and pnpm 11 (`corepack enable`).
- `pnpm install`
- `pnpm verify` runs the format check, lint, typecheck, tests with coverage and the guards. It must pass before every commit and stays under 3 minutes.
- `pnpm test:slow` runs the stack smoke, the load test and the bundled Action. `pnpm test:live` runs the provider suites and skips without keys.
- `pnpm demo` shows a review without any keys.

## Layout

- `packages/core`: contracts, verdicts, routing, renderers (pure, no I/O)
- `packages/analysis`: diffs, tree-sitter, units, code facts, retrieval
- `packages/providers`: Jev, LLM and GitHub adapters, with fakes and record and replay
- `packages/pipeline`: one review end to end
- `packages/cli`, `packages/server`, `packages/dashboard`, `packages/action`
- `packages/eval`: corpora, metrics, calibration, reports
- `fixtures/`, `eval/`, `docs/`, `scripts/`

## Rules

- **TypeScript:** strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), zod for every boundary, and no `any` outside parsed boundaries.
- **Tests:** next to the code as `*.test.ts`; slow suites are `*.slow.test.ts`, live ones `*.live.test.ts`.
  - Unit tests never touch the network; use fakes or msw.
  - Never delete, skip or weaken a test to make a check pass, and never lower a threshold. `guard:tests` checks this.
- **External calls:** every one goes through `packages/providers`, with a fake and record and replay.
- **Secrets:** never commit, print or log one. Test secrets are assembled at runtime so `guard:secrets` stays green.
- **Eval:** do not modify eval test-split files (`guard:split`). Tune on dev only.
- **Names:** every user-facing name comes from `BRAND` (`packages/core/src/brand.ts`).
- **Copy:** sentence-case headings, plain words, numbers in monospace, no em dashes.
- **Commits:** conventional commits that name the milestone or area, for example `fix(server): release failed deliveries [M9]`.

## Changes to Jev questions or prompts

Any change to question wording, criteria or levels bumps `questionSetVersion`. Any change to the extraction prompt bumps its version. Run the golden scenarios and the dev eval before and after, and record the result in `.agent/EXPERIMENTS.md`.

## Security

See `docs/security.md`. Report vulnerabilities privately, not in public issues.
