# Next

Milestone: M9 Production hardening
Task: the M9 gate.

Next action:
1. The sixth `security-reviewer` run is on c561fd9 (round 5 fixes: own-key finite prices, non-finite costs close budgets). Fix every high or medium finding and re-run until VERDICT: PASS. Then check the last M9 item.
2. Run the `milestone-verifier` on `.agent/milestones/M9.md`. The Dockerfile item stays unchecked (B7), so M9 closes BLOCKED-HUMAN. Tag `m9-done` only if it is DONE.
3. M10 is BLOCKED-HUMAN on B8 and docs/HANDOFF.md exists. Finish with one turn that shows `pnpm verify` exit 0 and `pnpm progress --check` printing ALL REQUIRED MILESTONES TERMINAL.
4. Once keys exist, follow B8 in `.agent/BLOCKERS.md` in order.
