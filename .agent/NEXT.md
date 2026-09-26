# Next

Milestone: M1 Contracts and diff analysis (offline)
Task: M1 gate.

Next action:
1. Run the `milestone-verifier` subagent on .agent/milestones/M1.md. Fix every gap and rerun until VERDICT: PASS.
2. Set M1 Status: DONE, set M2 Status: IN_PROGRESS, log the gate in SESSION_LOG.md, commit, `git tag m1-done`.
3. Start M2 with the Jev adapter (packages/providers): JevProvider interface, FakeJev (scripted, throws on unscripted calls, records states), token estimation and packing, then LiveJev over @typesafe-ai/sdk 0.6.0 with SDK retries off (DECISIONS D5), then CachedJev.
