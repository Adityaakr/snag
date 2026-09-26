# Next

Milestone: M7 GitHub App and Action
Task: GitHub write methods and the Hono server skeleton.

Next action:
1. Extend the GitHub provider (types, LiveGitHub, FakeGitHub, CachedGitHub where it applies) with the write and App methods M7 needs: check runs (create, update, annotations batched 50 per call), issue comments (list, create, update: sticky upsert by a hidden marker), labels, pull review comments, collaborator permission, repository default branch, and installation tokens (App JWT).
2. packages/server: Hono app with `/webhooks` (HMAC SHA-256, constant-time compare, delivery dedupe, 202 fast), `/setup` (manifest flow), `/healthz`, `/readyz`, `/metrics`; an in-memory job queue with a 30 s debounce per PR and cancellation of superseded jobs (pg-boss arrives in M8).
3. Review job per 10.2, slash commands with permission checks, issue checklist, rework and gate modes, then packages/action (node24, esbuild bundle) and docs/github-app.md and docs/github-action.md; security-reviewer at the gate.
