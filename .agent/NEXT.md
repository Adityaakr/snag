# Next

Milestone: M9 Production hardening
Task: the M9 gate.

Next action:
1. The `security-reviewer` returned VERDICT: PASS (round 6, c561fd9); the item is checked. The `milestone-verifier` is running on `.agent/milestones/M9.md` at 66fbb49. Fix any gaps. Then set M9 to BLOCKED-HUMAN on B7 (the Dockerfile item stays unchecked until `docker compose up` runs).
2. M10 is BLOCKED-HUMAN on B8 and docs/HANDOFF.md exists. Finish with one turn that shows `pnpm verify` exit 0 and `pnpm progress --check` printing ALL REQUIRED MILESTONES TERMINAL.
3. Once keys exist, follow B8 in `.agent/BLOCKERS.md` in order.
