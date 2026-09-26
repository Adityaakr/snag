# Progress

One section per milestone. A checked item ends with `(evidence: <test or command>, <short sha>)`.

## M0 Bootstrap and loop infrastructure
Status: DONE
- [x] A git repository with a pnpm workspace, `.nvmrc` (22), strict TypeScript project references, Biome and Vitest. Every package in 4.2 is scaffolded with a passing smoke test. (evidence: `pnpm typecheck` + 9 package smoke tests (`pnpm test`), 4eaae58)
- [x] `pnpm verify` runs the format check, lint, typecheck, tests and guards, and passes. (evidence: `pnpm verify` green in 2.2 s, 4eaae58)
- [x] The `.agent/` memory files (3.1) exist. `.agent/milestones/M0.md` to `M11.md` are generated from this section as issue-style specs.; `.agent/PROGRESS.md` is seeded from them.. (evidence: `node scripts/progress.mjs` lists M0..M11 from .agent/milestones, 4eaae58)
- [x] `scripts/progress.mjs` is implemented per Appendix A.4, with tests on fixture PROGRESS files. `pnpm progress` and `pnpm progress --check` are wired. (evidence: scripts/__tests__/progress.test.ts (21 tests), 4eaae58)
- [x] `.claude/settings.json`, `scripts/hooks/session-start.sh` and `scripts/hooks/stop-hygiene.sh` are created exactly as in Appendix A and marked executable. They are tested by piping sample JSON into them. (evidence: scripts/__tests__/settings.test.ts + hooks.test.ts, 9bd25fd)
- [x] The subagents `milestone-verifier`, `eval-analyst` and `security-reviewer` are created as in Appendix F. (evidence: .claude/agents/*.md extracted verbatim from Appendix F, 4eaae58)
- [x] `.agent/protected.sha256` exists. `guard:protected` and `guard:secrets` run in `pnpm verify`. (evidence: `pnpm guard` + scripts/__tests__/guards.test.ts, 4eaae58)
- [x] `CLAUDE.md` is under 150 lines. (evidence: `wc -l CLAUDE.md` = 64, 4eaae58)
- [x] `.env.example` lists every variable in 10.5. `.gitignore` covers: `.env*`, except `.env.example`; `node_modules`; build output and coverage; `.agent/loop-logs/`. (evidence: .env.example vs spec 10.5 table; .gitignore, 4eaae58)
- [x] A CI workflow, `.github/workflows/ci.yml`, runs `pnpm install --frozen-lockfile` and `pnpm verify` on push and pull request, with no secrets. (evidence: .github/workflows/ci.yml, 4eaae58)
- [x] `docs/providers.md` is written after reading the docs in 7.1. It records the exact SDK calls, limits, error classes, prices and links. (evidence: docs/providers.md (TypeSafe docs + SDK v0.6.0, linked), 4eaae58)
- [x] A README stub with a one-line pitch, the status and a quickstart placeholder. (evidence: README.md, 4eaae58)

## M1 Contracts and diff analysis (offline)
Status: DONE
- [x] zod contracts for section 5, with JSON Schema export to `schemas/` and round-trip tests. (evidence: packages/core/src/contracts/contracts.test.ts, `pnpm schemas`, 5aaf30c)
- [x] A unified diff parser covering every edge case in 6.3 step 1, with fast-check property tests (parse, render, parse again). (evidence: packages/analysis/src/diff/parse.test.ts (edge cases + fast-check parse/render/parse, 300 runs), dd163d5)
- [x] Local git ingest: `base..head` and `base...head` diffs, and file contents at both SHAs. (evidence: packages/analysis/src/git/local.test.ts, 432159f)
- [x] tree-sitter WASM loading for TS, TSX, JS, Python and Rust, plus symbol mapping, unit grouping, the size cap and stable IDs. (evidence: packages/analysis/src/syntax/treesitter.test.ts + units/build.test.ts, 4444511)
- [x] The file classifier from 6.4.1, including `.gitattributes` `linguist-generated`. (evidence: packages/analysis/src/files/classify.test.ts, 281cca3)
- [x] Formatting-only detection, and comment stripping that preserves line numbers (Python docstrings included), with tests. (evidence: packages/analysis/src/syntax/treesitter.test.ts (stripComments) + units/build.test.ts (formatting_only, docstrings), 4444511)
- [x] Every code-fact detector in 6.4.2 for its listed languages. Each is table-driven, with 3 positive and 2 negative cases. (evidence: packages/analysis/src/facts/detectors.test.ts (17 tables, >=3 positive and >=2 negative each) + perf.test.ts, 4c22fb9)
- [x] `remit units --diff <file|range>` prints units and facts as a table and as JSON. (evidence: packages/cli/src/commands/units.test.ts; `pnpm remit units --diff HEAD~3..HEAD`, e9ac303)
- [x] Line coverage of `analysis` is `≥ 90%`. (evidence: `pnpm test:cov` analysis lines 95.6% (threshold 90% enforced in vitest.config.ts), 761fda0)

## M2 Providers, budgets, record and replay
Status: IN_PROGRESS
- [ ] The Jev adapter from 7.3 (LiveJev, FakeJev, CachedJev), with tests for: packing; 400 shrink-and-retry; 429 and 529 backoff; validation; concurrency; cost accounting; model logging.
- [ ] The LLM adapter from section 8 (Anthropic, OpenAI-compatible, FakeLlm, CachedLlm), with structured output, the repair retry and cost accounting.
- [ ] A GitHub adapter covering: PR metadata; paginated files and patches, with the local diff fallback; contents at a SHA, with a size guard; issues and comments with roles; linked issues per 6.1; rate-limit handling. It includes FakeGitHub for tests.
- [ ] Record and replay per 7.4, with all four modes. A test proves cassettes contain no auth headers.
- [ ] `remit doctor` per 10.1, including model ID verification through the Anthropic Models API. The results are recorded in `docs/providers.md`.
- [ ] `pnpm test:live` smoke tests run only when keys exist, and print `skipped: <KEY> not set` otherwise.
- [ ] `guard:tests` (3.6) runs in `pnpm verify`.

## M3 Blind requirement extraction
Status: TODO
- [ ] Extraction prompt v0 (Appendix B.1) is versioned `xp-0.1.0`. The extractor accepts only `IssueSnapshot`.; The architecture test and the pipeline blindness test from 6.2 pass..
- [ ] Quote validation with normalization and one repair call. Unanchored items are dropped with warnings.
- [ ] The task-list fast path and all three `extraction.mode` values.
- [ ] Amendments, non-goals, examples, open questions with readings, and `checkableInCode`.
- [ ] The `issue.v0` Jev call for each requirement (ambiguity and checkability).
- [ ] At least 12 extraction fixtures, with scripted LLM outputs and expected validated results: a checklist issue; a prose issue; an issue amended by a later comment; explicit non-goals; input and output examples; a non-English issue; a requirement that only appears in an image; a very long issue; prompt injection in the issue text; duplicate requirements; a vague issue; two linked issues. With keys, live cassettes are recorded and any differences are noted.
- [ ] `remit extract <issue-url|file>`.

## M4 Retrieval, Jev question sets, verdicts, routing
Status: TODO
- [ ] Retrieval per 6.5: the all-in shortcut; BM25 with boosts; `rerank.v0` over budget; the widen pass; test retrieval; base-code retrieval.
- [ ] The question sets `issue.v0`, `forward.v0`, `tests.v0`, `reverse.v0`, `preexisting.v0`, `claims.v0` and `rerank.v0`, implemented exactly as in Appendix C, as `qs-0.1.0`.
- [ ] The verdict engine and unit rules from 6.7 as pure functions. Table-driven tests cover every branch and every threshold edge.
- [ ] The claims check from 6.8, which runs only after the blind pass (with a test).
- [ ] Routing and modes from 6.9: gate refusal without calibration evidence (with a test); stable finding IDs and `contentKey`; templated reasons only.
- [ ] The verdict engine applies an optional calibration map, and marks results `calibrated: false` without one.
- [ ] Golden scenarios 1 to 18 (Appendix D) pass with scripted Jev answers, including the state assertions for blindness and comment stripping.

## M5 CLI end to end, renderers, demo
Status: TODO
- [ ] `remit review` in GitHub and local modes, with every flag in 10.1.
- [ ] `remit init`, `remit doctor` and `remit demo`. The demo runs offline on scenarios 1 and 2 in under `10 s`.
- [ ] Renderers, with snapshot tests: terminal; sticky comment (Appendix E.1); check-run summary and annotations model; rework comment (E.2); issue checklist (E.3); JSON; SARIF 2.1.0.
- [ ] Sanitization tests for mentions, links, HTML, images, bidi characters and very long quotes.
- [ ] The exit codes in 10.1, each tested.
- [ ] A README quickstart that goes from a fresh clone to `remit demo` in 5 minutes, then to a real PR review with keys. Verify it in a clean clone.
- [ ] The first dogfood run is recorded (3.5).

## M6 Evaluation system
Status: TODO
- [ ] The corpus D runner: `pnpm eval:golden` at `100%`.
- [ ] Corpus B: synthetic seeds, at least 4 each in TS, Python and Rust; when `GITHUB_TOKEN` exists, up to 30 mined real seeds (Appendix G.2); seed annotations; every mutation operator in G.1, with apply-and-reparse checks and expected labels.
- [ ] The corpus A loader, built from the PatchDiff package and Zenodo results. The label mapping is documented in `docs/eval.md`.
- [ ] The corpus C export format is defined (it gets populated in M8).
- [ ] Splits, the freeze, `eval/corpora/test.sha256` and `guard:split`.
- [ ] Metrics (11.4), calibration fitting (11.5), threshold tuning on dev, and the baselines (11.6).
- [ ] Reports (11.9) in markdown and HTML.
- [ ] **With keys:** the first live dev run is recorded to cassettes and reported.
- [ ] **Without keys:** the report is generated from fakes and clearly marked `not a real measurement`, and M10 records the blocker.

## M7 GitHub App and Action
Status: TODO
- [ ] A Hono server with `/webhooks`, `/setup` (the manifest flow), `/healthz`, `/readyz` and `/metrics`.
- [ ] Every event in 10.2 is handled, with signature verification, dedupe, debounce and cancellation of superseded jobs.
- [ ] Config comes from the default branch only, is validated, and errors show up in the check run.
- [ ] The sticky comment and the check run with batched annotations, plus optional inline comments and labels.
- [ ] Slash commands, with permission checks.
- [ ] The issue-time checklist, with `/remit confirm` and invalidation when the issue is edited.
- [ ] Rework mode and gate mode (including refusal) work end to end.
- [ ] The GitHub Action package, with docs per 10.3.
- [ ] Integration tests replay recorded webhook payloads against FakeGitHub. An end-to-end test runs through a local fake GitHub harness.
- [ ] `docs/github-app.md` exists, and the `security-reviewer` subagent returns `VERDICT: PASS`.

## M8 Persistence, feedback, dashboard
Status: TODO
- [ ] The Postgres schema and migrations from 10.4, with PGlite in tests.
- [ ] pg-boss queues with retries and a dead-letter list.
- [ ] Feedback from slash commands and the dashboard, plus implicit weak labels.
- [ ] The dashboard pages from 10.4, with GitHub OAuth and authorization. Accessibility checks include a keyboard navigation test and contrast.
- [ ] Corpus C exports from stored labels.
- [ ] An end-to-end test covering webhook, job, review, comment, slash-command feedback, dashboard and export.

## M9 Production hardening
Status: TODO
- [ ] A multi-stage Dockerfile that runs as non-root. `docker-compose.yml` has the server, the worker and Postgres, with health checks.; `docker compose up` works locally with fakes..
- [ ] Deploy guides for Fly.io, Railway and Render in `docs/operations.md`.
- [ ] Observability: structured logs with `reviewId`; Prometheus metrics for reviews, latency, provider calls, tokens, cost, findings and feedback; optional OpenTelemetry.
- [ ] Budgets, rate limiters, circuit breakers and graceful partial results, all with tests.
- [ ] Retention and deletion jobs, with tests.
- [ ] A load test with fakes: 50 concurrent PR events. Record p50 and p95 latency and the error rate in `docs/operations.md`.
- [ ] Chaos tests: Jev 400, 429, 529 and timeouts; GitHub 5xx; a database restart.
- [ ] Docs: `docs/security.md` (the threat model); `docs/operations.md` (a runbook with SLOs and alerts); CHANGELOG and CONTRIBUTING.
- [ ] The `security-reviewer` subagent returns `VERDICT: PASS`.

## M10 Eval-driven improvement
Status: TODO
- [ ] This needs live `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY`. Without them the milestone is `BLOCKED-HUMAN`, with exact unblock steps.
- [ ] A live dev baseline on corpora A, B and D (plus C if it has data), with both baselines.
- [ ] Up to 15 experiments per 11.7, each logged before and after.
- [ ] Freeze the question set and calibration, then do one test-split run.
- [ ] `docs/eval-results.md` compares results with the targets and the baselines, and states limitations honestly.

## M11 Stretch (optional, not required for done)
Status: TODO
- [ ] Blind spec tests: generate tests from the issue alone, never seeing the PR, and run them against the branch inside the user's own CI via the Action.
- [ ] Dual-model extraction, merged by quote overlap.
- [ ] Linear and Jira issue adapters.
- [ ] GitLab support.
