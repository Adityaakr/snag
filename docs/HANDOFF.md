# Handoff

This page is for the person taking Remit from here. It covers what exists, how to run it, what only you can do, and what to build next. Milestone status with evidence is in `.agent/PROGRESS.md`; open problems are in `.agent/BLOCKERS.md`.

## What was built

- **Core** (`packages/core`): contracts (zod), config, blind extraction prompt and quote validation, the verdict engine, routing (comment, rework, gate), and renderers for the PR comment, JSON, SARIF and inline comments. Pure, no I/O.
- **Analysis** (`packages/analysis`): diff parsing, file classes, tree-sitter units for TypeScript, Python and Rust, comment-stripped judge views, deterministic code facts, and retrieval.
- **Providers** (`packages/providers`): Jev (TypeSafe), Anthropic and OpenAI-compatible LLMs, and GitHub, each with fakes, record and replay, budgets, retries, cancellation and circuit breakers.
- **Pipeline** (`packages/pipeline`): one review end to end, with partial results when a provider fails.
- **CLI** (`packages/cli`): `remit review`, `extract`, `units`, `doctor`, `init`, `demo`, `eval`, `calibrate`, `mutate`, `report`.
- **GitHub App** (`packages/server`): signed webhooks, pg-boss queues, check runs, a sticky comment, rework and gate modes, slash commands, the issue-time checklist, one-click setup, retention and deletion, a daily budget, rate limits, metrics and tracing.
- **Dashboard** (`packages/dashboard`): reviews, review detail, a labeling queue with keyboard shortcuts, metrics and settings, behind GitHub OAuth.
- **GitHub Action** (`packages/action`): the same review without a server; it never checks out PR code.
- **Eval** (`packages/eval`): corpora A (SWE-bench and PatchDiff, `1,203` items), B (`12` synthetic seeds with tree-sitter mutations), C (shadow exports) and D (golden scenarios); a frozen test split; isotonic calibration; baselines; reports.
- **Operations**: a Dockerfile and docker-compose, deploy guides (Fly.io, Railway, Render), SLOs, alerts, a runbook, load and chaos tests, and a threat model (`docs/security.md`).

## How to run each surface

| Surface | Command | Docs |
|---|---|---|
| Offline demo | `pnpm install && pnpm demo` | `README.md` |
| CLI on a real PR | add keys to `.env`, then `pnpm remit doctor` and `pnpm remit review <pr-url>` | `README.md`, `docs/providers.md` |
| GitHub App, local | `pnpm server`, then open `/setup` with the printed token | `docs/github-app.md` |
| Whole stack with fakes | `docker compose up -d --wait && docker compose run --rm smoke`, or without Docker `pnpm stack:smoke` | `docs/operations.md` |
| GitHub Action | `pnpm build:action`, then use it from a workflow | `docs/github-action.md` |
| Evals | `pnpm eval:golden`, `pnpm eval:dev`; the test split runs only with `--gate` | `docs/eval.md` |
| Checks | `pnpm verify` (under 3 minutes) | `CONTRIBUTING.md` |

## What only you can do, in order

1. **Keys.** Put `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY` in `.env` (see `.env.example`), and a read-only `GITHUB_TOKEN` too. Run `pnpm remit doctor` and paste its output into `docs/providers.md` under "Doctor results" (closes B1 and B2).
2. **Live cassettes.** Run `pnpm test:live` and commit `fixtures/cassettes/llm/**` and the comparison report (B3).
3. **Live evals.** Follow B8 in `.agent/BLOCKERS.md`: the live dev baseline, calibration, both baselines, up to `15` experiments, one test-split run, and `docs/eval-results.md` (B5 and M10). A new Claude Code session can do this once the keys exist; `.agent/NEXT.md` points at it.
4. **Real seeds (optional).** With `GITHUB_TOKEN`, run `pnpm eval:mine-seeds` and annotate the candidates (B6). If you like, spot-check the synthetic seed labels (B4).
5. **Docker.** On a machine with Docker, run `docker compose up -d --wait && docker compose run --rm smoke` and expect `smoke ok`. Pushing to GitHub runs the same in the CI `docker` job (B7). Then check the M9 Dockerfile item.
6. **Register the GitHub App.** Deploy the server (next step), open `/setup?token=...` and click through. The manifest flow creates the App with the right permissions and stores its credentials encrypted.
7. **Deploy.** Pick Fly.io, Railway or Render from `docs/operations.md`. Provide Postgres, a domain and the secrets (as `*_FILE` mounts where possible). Set `REMIT_DAILY_BUDGET_USD`.
8. **First shadow repositories.** Install the App on two or three repositories in comment-only mode (the default). Label findings with slash commands or the dashboard queue for two to four weeks, then export corpus C (`pnpm eval:export-shadow`) and recalibrate. Leave gate mode off until the calibration evidence it asks for exists.
9. **Name and license.** Change `packages/core/src/brand.ts` and add a `LICENSE`.

## Known limitations

- There are no live measurements yet. Every eval number so far comes from scripted or simulated providers and is marked "Not a real measurement".
- Corpus B has `12` synthetic seeds, written and labeled by Claude Code. The M6 audit found and fixed one untrue label, so others may exist.
- `docker compose up` has not run here because there is no container runtime. The same topology runs as processes in `pnpm stack:smoke`.
- The hourly rate limit is counted per web process. The daily budget is shared through the database.
- Installation tokens are narrowed to one repository but not to fewer permissions.
- Extraction is one LLM call. A determined prompt injection could still yield a plausible wrong requirement, though quote anchoring keeps it to text that is really in the issue.
- Languages with tree-sitter units: TypeScript and JavaScript, Python, Rust. Changes in other files are grouped by proximity instead of by symbol.

## Eval results

There are none yet, because the live runs need keys (B5, B8). The simulated dev report (`eval/reports/2026-09-26T17-51-01-962Z/report.md`) proves the corpora, metrics, calibration and report plumbing work end to end. Its numbers say nothing about model quality: the simulated stand-in gives P0 precision of `0.20` and many false alarms on clean seeds. The 11.8 targets and the experiment protocol in `BUILD_PROMPT.md` 11.7 are ready to run.

## The five most valuable next improvements

1. **Run the live eval loop (M10).** Until it runs, nobody knows whether the verdicts are good. Every other decision depends on it.
2. **Shadow deployment on real repositories.** Corpus C labels from real reviewers are the only honest calibration source for gate mode.
3. **More and real corpus B seeds.** Aim for `30` seeds mined from real PRs (G.2), `10` per language, so mutation recall and false alarms mean something.
4. **Cut false alarms on clean PRs.** Tune the unexplained-change and coverage thresholds on dev once live answers exist. This is the metric most likely to decide whether people keep Remit installed.
5. **Dual-model extraction (M11).** Merge two extractions by quote overlap to catch missed and invented requirements. Extraction errors cascade into every verdict.
