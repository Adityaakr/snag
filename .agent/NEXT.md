# Next

Milestone: M8 Persistence, feedback, dashboard
Task: the Postgres schema and migrations.

Next action:
1. Read BUILD_PROMPT 10.4 and M8 in section 13, and `.agent/milestones/M8.md`.
2. Add Drizzle schema and drizzle-kit migrations for every table in 10.4, tested on PGlite; implement the server `Store` and `DeliveryStore` on it (parameterized queries only).
3. pg-boss queues (`review`, `reextract`, `recalibrate`, `cleanup`) with retries and a dead-letter list behind the `JobQueue` interface; payload retention and the cleanup job.
4. Feedback (slash, dashboard, implicit weak labels), the dashboard pages with GitHub OAuth, and corpus C exports (`remit-shadow-1`), then the end-to-end test.
