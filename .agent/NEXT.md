# Next

Milestone: M7 GitHub App and Action
Task: the M7 gate.

Next action:
1. Wait for the `security-reviewer` subagent (started on HEAD after da33b0d) and fix every high or medium finding; re-run it until VERDICT: PASS, then check the last M7 item ("docs/github-app.md exists, and the security-reviewer ... PASS").
2. Run the `milestone-verifier` on `.agent/milestones/M7.md`; fix gaps until PASS.
3. Status DONE, commit, tag `m7-done`, then start M8 (Postgres schema with Drizzle and PGlite, pg-boss queues, feedback, dashboard, corpus C exports).
