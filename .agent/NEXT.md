# Next

Milestone: M9 Production hardening
Task: container and deployment.

Next action:
1. Read M9 in BUILD_PROMPT section 13 and `.agent/milestones/M9.md`.
2. Multi-stage Dockerfile (non-root), docker-compose with server, worker and Postgres plus health checks; `docker compose up` works with fakes. Split a worker entry point (pg-boss consumers) from the web server.
3. docs/operations.md: deploy guides for Fly.io, Railway and Render.
4. Observability (pino with redact paths and reviewId, Prometheus metrics for reviews, latency, provider calls, tokens, cost, findings and feedback, optional OpenTelemetry); budgets (per-installation daily), rate limiters, circuit breakers, graceful partial results; retention and deletion tests; a load test (50 concurrent PR events); chaos tests; the D30 carry-overs (AbortSignal into runReview, Renovate, CI pnpm audit, docs/security.md, token permissions, slug lookup).
