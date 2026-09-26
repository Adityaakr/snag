# Next

Milestone: M6 Evaluation system
Task: the M6 gate.

Next action:
1. Run the `milestone-verifier` subagent on `.agent/milestones/M6.md` and fix every gap it reports.
2. On PASS: M6 status `BLOCKED-HUMAN` (8 of 9 items; "With keys" waits on B5: TYPESAFE_API_KEY and ANTHROPIC_API_KEY), commit, tag `m6-done`.
3. Then start M7 (GitHub App and Action): Hono server with `/webhooks`, `/setup`, `/healthz`, `/readyz`, `/metrics`.
