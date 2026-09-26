# Next

Milestone: M9 Production hardening
Task: the M9 gate.

Next action:
1. The `security-reviewer` returned VERDICT: PASS (round 6, c561fd9); the item is checked. The first milestone-verifier run found four gaps (tsbuildinfo, /shared ownership, weak static test, no DECISIONS entry), fixed in c5a19fe (D33); M9 is set to BLOCKED-HUMAN on B7. The re-audit is running at c5a19fe; fix any gaps it reports.
2. M10 is BLOCKED-HUMAN on B8 and docs/HANDOFF.md exists. Finish with one turn that shows `pnpm verify` exit 0 and `pnpm progress --check` printing ALL REQUIRED MILESTONES TERMINAL.
3. Once keys exist, follow B8 in `.agent/BLOCKERS.md` in order.
