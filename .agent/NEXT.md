# Next

Milestone: M0 Bootstrap and loop infrastructure
Task: `.claude/settings.json` (Appendix A.1), then the M0 gate.

Next action:
1. If the human approved it, write `.claude/settings.json` exactly as BUILD_PROMPT Appendix A.1 and add a test that parses it and checks the hook commands point at executable scripts.
2. Run `pnpm verify`, check the last M0 item with evidence, commit.
3. M0 gate: audit per Appendix F.1 (milestone-verifier loads next session; until then run the same checklist by hand or through a general-purpose agent), fix gaps, set Status: DONE, commit, `git tag m0-done`.
4. Start M1 with the zod contracts in packages/core/src/contracts/ (install zod 4.x pinned exactly).
