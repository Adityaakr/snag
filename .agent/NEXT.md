# Next

Milestone: M5 CLI end to end, renderers, demo
Task: M5 gate.

Next action:
1. Run the `milestone-verifier` subagent on .agent/milestones/M5.md; fix every gap and rerun until VERDICT: PASS.
2. Set M5 DONE and M6 IN_PROGRESS, log it, commit, `git tag m5-done`.
3. Start M6 (evaluation system): corpus D runner (`pnpm eval:golden` at 100%), corpus B synthetic seeds (4 each TS, Python, Rust) with annotations and every G.1 mutation operator (apply-and-reparse), corpus A loader (PatchDiff + Zenodo; no network in tests), corpus C export format, splits and freeze (`eval/corpora/test.sha256`, `guard:split`), metrics, isotonic calibration, threshold tuning on dev, baselines, reports (md + html, Satoshi font). Without keys, the dev report is from fakes and marked `not a real measurement`; M10 records the blocker.
