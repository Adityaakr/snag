# Next

Milestone: M9 Production hardening
Task: the M9 gate.

Next action:
1. Wait for the `security-reviewer` (started on 8d957ba); fix every high or medium finding and re-run until VERDICT: PASS; then check the last M9 item.
2. Run the `milestone-verifier` on `.agent/milestones/M9.md`. The Dockerfile item stays unchecked until `docker compose up` runs (B7: no container runtime here; `pnpm stack:smoke` covers the same topology), so M9 closes BLOCKED-HUMAN on B7 unless Docker becomes available.
3. Then M10 (BLOCKED-HUMAN without TYPESAFE_API_KEY and ANTHROPIC_API_KEY: record exact unblock steps) and docs/HANDOFF.md.
