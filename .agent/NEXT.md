# Next

Milestone: M4 Retrieval, Jev question sets, verdicts, routing
Task: M4 gate.

Next action:
1. Run the `milestone-verifier` subagent on .agent/milestones/M4.md; fix every gap and rerun until VERDICT: PASS.
2. Set M4 DONE and M5 IN_PROGRESS, log it, commit, `git tag m4-done`.
3. Start M5: renderers in packages/core/src/render (terminal, sticky comment E.1, check-run summary and annotations, rework E.2, issue checklist E.3, JSON, SARIF 2.1.0) with sanitization per 6.10, then `remit review` (GitHub and local modes, all flags, exit codes), `remit init`, `remit demo` (scenarios 1 and 2 offline, under 10 s), README quickstart verified in a clean clone, first dogfood run (3.5).
