# Experiments

Eval experiments (M6 and later) use the protocol in BUILD_PROMPT 11.7. Test-split runs are logged here too.

## Experiments

(none yet)

## Dogfood labels

From M5 on: finding id, milestone, what Remit said, whether it was right.

(none yet)

### Dogfood run 1: M5 (`pnpm remit review --issue .agent/milestones/M5.md --diff m4-done..HEAD`), 2026-09-26

No keys, so extraction used the task-list fast path and there were no Jev verdicts (all `uncertain`); only extraction and code facts can be labeled.

| Finding | What Remit said | Right? | Action |
| --- | --- | --- | --- |
| extraction R1 to R7 | 7 requirements, one per M5 task-list item, quotes exact | right | none (sub-bullets of item 3 are not separate requirements; the fast path quotes the line only) |
| X1 | `suppression_added` in README.md:66 (`@ts-ignore`) | wrong: prose mentioning the marker | fixed: suppression facts skip docs units, with a test |
| X2 | `dependency_added` `pino` in packages/cli/package.json | right | none (added for `--verbose` logs) |
| X3 | `new_symbol_unreferenced` `checkRun` | right | none (used by the GitHub App in M7) |
| X4 | `new_symbol_unreferenced` `renderChecklist` | right | none (used by the issue checklist in M7) |
| X5, X6 | `suppression_added` `biome-ignore` in sanitize.ts | right | none (deliberate: control-character regexes, justified inline) |
| verdicts | 7 requirements `uncertain`, 154 units `uncertain` | expected without Jev | rerun with keys (B1) |
- 2026-09-26T17:22:28.991Z mutations/dev simulated (not a real measurement): 0/128 items correct, requirement F1 0.30, PR recall 0.85, false alarms 9.94, P0 precision 0.19, cost $0.0000. Report: eval/reports/2026-09-26T17-22-28-991Z
