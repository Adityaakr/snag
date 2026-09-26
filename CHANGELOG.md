# Changelog

All notable changes to Remit. The format follows Keep a Changelog, and versions follow semantic versioning once released.

## Unreleased

### Added
- **Core:** contracts with JSON Schema export, the blind extraction prompt with quote anchoring, question sets `qs-0.1.0`, the pure verdict engine, calibration maps, routing with gate refusal, claims checking, and renderers for comments, rework requests, checklists, check runs, the terminal, SARIF and JSON.
- **Analysis:** a unified diff parser, file classification, tree-sitter symbols, change units, 17 code-fact detectors and BM25 retrieval.
- **Providers:** Jev, Anthropic and OpenAI-compatible LLMs, and a GitHub reader and writer with App auth.
  - Record and replay, budgets, retries, circuit breakers, cancellation, and a per-call usage log.
- **Pipeline:** one review end to end, reproduced exactly by the 18 golden scenarios.
- **CLI:** `remit review`, `extract`, `units`, `doctor`, `init`, `demo`, `eval`, `mutate`, `calibrate` and `report`.
- **Evaluation:**
  - corpus D (golden), corpus B (12 synthetic seeds with the G.1 mutation operators), corpus A (SWE-bench Verified with PatchDiff labels) and the corpus C export format;
  - a frozen test split, metrics, isotonic calibration, threshold tuning, baselines and reports.
- **GitHub App:**
  - signed webhooks with dedupe, debounce and cancellation;
  - sticky comments and check runs, slash commands, the issue-time checklist, and rework and gate modes;
  - `/setup` through the manifest flow.
- **GitHub Action:** a Node 24 bundle that works through the API only.
- **Persistence:** a Postgres schema and migrations, pg-boss queues with dead letters, feedback (slash commands, dashboard and implicit weak labels), and corpus C exports.
- **Dashboard:** a React app with GitHub OAuth, the labeling queue, metrics and settings.
- **Operations:**
  - web and worker roles, a Dockerfile and docker-compose;
  - structured logs, Prometheus metrics and optional OpenTelemetry;
  - budgets and rate limits, and chaos and load tests.

### Security
- Everything in `docs/security.md`: data minimization by default, sanitized output, config from the default branch only, no execution of PR code, and a token-gated setup that never overwrites credentials.
