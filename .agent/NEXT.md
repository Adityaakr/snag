# Next

Milestone: M2 Providers, budgets, record and replay
Task: M2 gate.

Next action:
1. Run the `milestone-verifier` subagent on .agent/milestones/M2.md; fix every gap and rerun until VERDICT: PASS.
2. Set M2 Status: DONE and M3 IN_PROGRESS, log in SESSION_LOG.md, commit, `git tag m2-done`.
3. Start M3: packages/core/src/extract/ (IssueSnapshot-only prompt builder per Appendix B.1 as `xp-0.1.0`, output zod schema, quote validation with normalization, renumbering per section 5), architecture test that extract/ imports no PR types, task-list fast path and extraction modes, amendments, then `issue.v0` Jev call, 12 fixtures, `remit extract`.
