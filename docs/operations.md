# Operating Remit

How to deploy, observe and run the Remit GitHub App. Setting up the App itself is covered in `docs/github-app.md`.

## Topology

One image (`Dockerfile`, non-root, Node 22). `REMIT_ROLE` sets what a process does.

| Role | Does | Port |
|---|---|---|
| `web` | HTTP: `/webhooks`, `/setup`, `/auth/*`, `/api/*`, the dashboard, `/healthz`, `/readyz`, `/metrics`. Sends jobs to pg-boss and runs the database migrations. | `PORT` (3000) |
| `worker` | Consumes pg-boss jobs: reviews, checklists, slash commands, and the nightly cleanup and recalibration. | `WORKER_PORT` (3001): `/healthz`, `/readyz`, `/metrics` |
| `all` | Both, in one process (the default). Without `DATABASE_URL` it uses PGlite on disk and an in-process queue; good for one small installation. | `PORT` |

**Postgres** holds the tables from BUILD_PROMPT 10.4 and the pg-boss queues.
- Migrations run when the web process starts, under an advisory lock.
- Start workers after the web process is healthy. `docker-compose.yml` does this with `depends_on: service_healthy`.

**Scaling**
- Web processes are stateless; scale them for webhook and dashboard traffic.
- Scale workers for review throughput. Each worker runs 4 jobs per queue at once.

## Local

`docker-compose.yml` is for local use only: it has a fixed Postgres password, binds port 3000 to localhost, and runs a fake GitHub. Use the deploy guides below for production.

- `docker compose up` starts Postgres, a fake GitHub, the web process and the worker. No credentials are needed.
- `docker compose run --rm smoke` sends a signed webhook and waits for the check run and the sticky comment.
- `pnpm stack:smoke` runs the same topology as local processes (no Docker): PGlite stands in for Postgres. It is part of `pnpm test:slow`.
- To use a real App locally, see the comment at the top of `docker-compose.yml` and "Local development" in `docs/github-app.md`.

## Configuration

Set these environment variables. Every variable also has a `NAME_FILE` form that reads the value from a file, for mounted secrets. Numeric settings are validated at startup.

**Multi-process deployments:** give every process its credentials through the environment or `*_FILE`. `/setup` stores credentials in its own container's `DATA_DIR`, which other replicas and the worker do not see unless `DATA_DIR` is a shared volume.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | for `web` and `worker` | Postgres 14 or later |
| `REMIT_ROLE` | no | `web`, `worker` or `all` |
| `PUBLIC_URL` | yes | the address GitHub sends webhooks to |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY[_FILE]`, `GITHUB_WEBHOOK_SECRET[_FILE]` | yes | or store them encrypted with `/setup` and `SECRETS_ENCRYPTION_KEY` |
| `GITHUB_APP_SLUG` | no | read from `GET /app` at startup when unset |
| `GITHUB_API_URL` | no | GitHub Enterprise Server, or the local fake |
| `TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY` | for real verdicts | without them, verdicts are `uncertain` and only task lists are read |
| `SESSION_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | for the dashboard | the session secret must be at least 32 characters |
| `REMIT_DAILY_BUDGET_USD` | no | per installation, default `20`. Every run reserves `budgets.max_usd_per_review` (capped at a quarter of this budget) in the `spend_ledger` table and settles to its real spend, whether it finished, was cancelled or failed. Issue checklists count against the same budget. |
| `REMIT_REVIEWS_PER_HOUR` | no | per installation, default `200`; past it, PR and issue events wait 5 minutes. This smooths bursts and does not cap cost; the daily budget does. The count is kept per web process. |
| `REMIT_LLM_PRICES` | no | JSON, model id to `{"input": n, "output": n}` in USD per million tokens, added to the built-in table. Budgets use the higher of this price and the repository's `llm_prices`, and a model with no price here is not called (extraction falls back to the task list). |
| `REMIT_JEV_PRICE_PER_MILLION_USD` | no | default `0.042`; the floor for Jev's price, which a repository can raise but not lower. |
| `METRICS_TOKEN` | no | bearer token for `/metrics` on the web and worker ports |
| `LOG_LEVEL` | no | `info` by default |
| `OTEL_*` | no | see "Tracing" |

## Deploy guides

Every platform runs the same image twice, as `web` and `worker`, next to a managed Postgres. Set the variables above as platform secrets.

### Fly.io

1. `fly launch --no-deploy` in the repository root (it finds the Dockerfile), then `fly postgres create` and `fly postgres attach`. Attaching sets `DATABASE_URL`.
2. Add processes and checks to `fly.toml`:

   ```toml
   [processes]
     web = "env REMIT_ROLE=web node packages/server/dist/main.js"
     worker = "env REMIT_ROLE=worker node packages/server/dist/main.js"

   [env]
     PORT = "3000"
     WORKER_PORT = "3001"

   [[services]]
     processes = ["web"]
     internal_port = 3000
     protocol = "tcp"
     [[services.ports]]
       port = 443
       handlers = ["tls", "http"]
     [[services.http_checks]]
       path = "/healthz"
       interval = "15s"
       timeout = "3s"
   ```

   Each process sets its role in its command (secrets apply to every process). The image's `HEALTHCHECK` covers the worker.
3. Set the secrets: `fly secrets set GITHUB_APP_ID=... GITHUB_APP_PRIVATE_KEY="$(cat key.pem)" GITHUB_WEBHOOK_SECRET=... PUBLIC_URL=https://<app>.fly.dev ...`
4. `fly deploy`, then `fly scale count web=2 worker=2`.

### Railway

1. Create a project from the repository. Railway builds the Dockerfile.
2. Add the PostgreSQL plugin and reference it with `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
3. Create two services from the same repository:
   - `web`: `REMIT_ROLE=web`, public networking on port 3000, health check path `/healthz`;
   - `worker`: `REMIT_ROLE=worker`, no public networking.
4. Put the shared variables in a shared variable group. Set `PUBLIC_URL` to the web service's domain, then deploy.

### Render

Use a Blueprint (`render.yaml`):

```yaml
databases:
  - name: remit-db
    plan: basic-256mb
services:
  - type: web
    name: remit-web
    runtime: docker
    healthCheckPath: /healthz
    envVars:
      - key: REMIT_ROLE
        value: web
      - key: DATABASE_URL
        fromDatabase: { name: remit-db, property: connectionString }
      - fromGroup: remit-secrets
  - type: worker
    name: remit-worker
    runtime: docker
    envVars:
      - key: REMIT_ROLE
        value: worker
      - key: DATABASE_URL
        fromDatabase: { name: remit-db, property: connectionString }
      - fromGroup: remit-secrets
```

Create the `remit-secrets` environment group with the App credentials, provider keys and `PUBLIC_URL`.

## Observability

**Logs** are pino JSON on stderr with `service`, `role` and, for review work, `reviewId`, `repo` and `pr`.
- Credentials are redacted by path: authorization headers, tokens, private keys, webhook and client secrets, and API keys.
- Messages never include issue text or code.

**Metrics** are served at `/metrics` (web and worker ports) in the Prometheus text format:

| Metric | Type | Labels |
|---|---|---|
| `remit_webhooks_total` | counter | `event`, `result` (`handled`, `ignored`, `duplicate`, `bad_signature`, `invalid`) |
| `remit_reviews_total` | counter | `status` (`done`, `cancelled`, `failed`) |
| `remit_review_seconds` | histogram | buckets 1 to 300 s |
| `remit_review_cost_usd_sum` | counter | |
| `remit_provider_calls_total` | counter | `provider`, `kind` |
| `remit_provider_tokens_total` | counter | `provider`, `direction` |
| `remit_provider_cost_usd_total` | counter | `provider` |
| `remit_findings_total` | counter | `priority` |
| `remit_feedback_total` | counter | `label`, `source` |
| `remit_jobs_cancelled_total` | counter | `key` |
| `remit_budget_skips_total` | counter | |
| `remit_reviews_delayed_total` | counter | |

Per-call usage (tokens, cost and latency, with no content) is also stored in the `api_calls` table.

**Tracing** is optional. Remit creates a `remit.review` span per review through `@opentelemetry/api`, which is a no-op until you register an SDK. To export spans, add `@opentelemetry/sdk-node` and `@opentelemetry/auto-instrumentations-node` to the image. Then start with `NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"` and `OTEL_EXPORTER_OTLP_ENDPOINT=...`.

## SLOs

| SLO | Target | Measured by |
|---|---|---|
| Webhook availability (2xx or 401 for bad signatures) | 99.9% monthly | load balancer, `remit_webhooks_total` |
| Review latency, webhook to check run | p50 at most 30 s, p95 at most 120 s (live providers) | `remit_review_seconds` |
| Reviews completed (not `failed`) | 99% of reviews | `remit_reviews_total` |
| Cost per review | p50 at most $0.10 | `remit_review_cost_usd_sum` and `api_calls` |

## Alerts and runbook

| Alert | Condition | What to do |
|---|---|---|
| Webhooks rejected | `rate(remit_webhooks_total{result="bad_signature"}[10m]) > 1` | The webhook secret was rotated on GitHub but not here, or someone is probing. Compare the secret; check the source IPs. |
| Reviews failing | `sum(rate(remit_reviews_total{status="failed"}[15m])) / sum(rate(remit_reviews_total[15m])) > 0.05` | Read worker logs by `reviewId`. GitHub 5xx and database errors retry, and the dead-letter list (dashboard, Metrics) shows jobs that failed every retry. Redeliver from GitHub's App settings, or reply `/remit review`. |
| Slow reviews | `histogram_quantile(0.95, rate(remit_review_seconds_bucket[30m])) > 120` | Check provider latency in `api_calls`, and the worker count and queue depth (`pgboss.job` by state). Scale workers. |
| Provider outage | `rate(remit_circuit_open_total[5m]) > 0` or many `uncertain` verdicts | The circuit breaker fails fast after 5 consecutive failures for 30 s. Reviews finish with partial results and a warning. Check the provider status page. No action is needed unless it lasts. |
| Budget exhausted | `increase(remit_budget_skips_total[1h]) > 0` | An installation hit `REMIT_DAILY_BUDGET_USD`. Raise it if expected. Otherwise look for PR spam (`remit_reviews_delayed_total`). |
| Database down | `/readyz` failing, or pool warnings `database connection dropped` | Pools reconnect on their own after a restart (chaos-tested). If the database stays down, jobs wait in pg-boss and resume. |

**Routine tasks**
- **Rotate the webhook secret:** set the new value on GitHub and in `GITHUB_WEBHOOK_SECRET`, then restart the web processes. Deliveries signed with the old secret fail until the restart.
- **Rotate the App private key:** generate a new key on GitHub, deploy it, then delete the old key on GitHub.
- **Retention:** the `cleanup` job runs nightly at 03:15 UTC (pg-boss schedule, or a daily timer in the single-process mode). It deletes expired payloads and text columns (`retention_days`) and delivery ids older than 30 days. GitHub signatures carry no timestamp, so ids are kept that long to block replays.
- **Uninstall:** `installation.deleted` deletes the installation's reviews, findings, feedback and checklists.
- **Backups:** use the platform's Postgres backups. Default rows hold no code or issue text, so backups contain only verdicts, answers, hashes, paths and line ranges, plus payloads when retention is on.

## Load test (fakes)

`packages/server/src/load.slow.test.ts` sends 50 concurrent `pull_request.opened` events for 50 PRs. The setup is the web app, the pg-boss queue (8 jobs at once in one worker), the Postgres store (PGlite) and a fake GitHub. The providers are the golden scenario's scripted Jev and LLM, so the numbers measure Remit's own overhead, not model latency.

Run on 2026-09-27 on an Apple silicon laptop (Node 22):

| Events | Accepted | Reviewed | Errors | Error rate | p50 webhook to stored review | p95 | Total |
|---|---|---|---|---|---|---|---|
| `50` | `50` | `50` | `0` | `0%` | `2.0 s` | `3.1 s` | `3.7 s` |

With live providers, review latency is dominated by Jev and the LLM (BUILD_PROMPT 11.8 targets a p50 of at most 30 s). M10 measures it live.

## Chaos tests

`packages/server/src/chaos.test.ts` runs in `pnpm verify`:

| Fault | Result |
|---|---|
| Jev 400 | fatal, not retried; the review completes with `uncertain` verdicts and a warning |
| Jev 429 and 529 | retried with backoff, then the same partial result |
| Jev timeout | the request is aborted at `timeoutMs`, retried, then partial result |
| GitHub 5xx (transient) | retried; the review completes |
| GitHub 5xx (persistent) | the check run ends `neutral` with "could not finish"; the job fails, so pg-boss retries it and dead-letters it after the last retry |
| Database restart | pools reconnect; a job sent after the restart is reviewed and stored; dropped idle connections are logged, not thrown |

Circuit breakers (`packages/providers/src/common/circuit.ts`) open after 5 consecutive retryable failures and fail fast for 30 s. A superseded job stops starting provider calls at once.
