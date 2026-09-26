# Next

Milestone: M6 Evaluation system
Task: corpus D runner and eval package scaffolding.

Next action:
1. M6 (evaluation system): corpus D runner (`pnpm eval:golden` at 100%), corpus B synthetic seeds (4 each TS, Python, Rust) with annotations and every G.1 mutation operator (apply-and-reparse), corpus A loader (PatchDiff + Zenodo; no network in tests), corpus C export format, splits and freeze (`eval/corpora/test.sha256`, `guard:split`), metrics, isotonic calibration, threshold tuning on dev, baselines, reports (md + html, Satoshi font). Without keys, the dev report is from fakes and marked `not a real measurement`; M10 records the blocker.
