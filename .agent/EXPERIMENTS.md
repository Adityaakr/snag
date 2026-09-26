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

### Dogfood run 2: M6 (`pnpm remit review --issue .agent/milestones/M6.md --diff m5-done..HEAD`), 2026-09-26

No keys: task-list extraction (9 requirements, one per M6 item; item 2 quotes only "Corpus B:", the known fast-path limit from run 1), no Jev verdicts. 400 units (the unit cap), mostly corpus JSON. Code facts labeled:

| Finding | What Remit said | Right? | Action |
| --- | --- | --- | --- |
| calibrate.ts:67 | `catch_broadened`: empty `catch` block added | right | fixed: the fallback is explicit (`nogit`) with a comment |
| generate.ts:107 | `new_symbol_unreferenced`: `writeMutationCorpus` | right | fixed: removed (the CLI loops over `writeSeedItems`) |
| shadow.ts:73 | `new_symbol_unreferenced`: `shadowItem` | right | none: the corpus C export format is defined in M6 and first used by M8's exporter |
| swebench.ts:15 | `secret_like`: high-entropy token | wrong: a PatchDiff run directory name (`20241221_codestory_midwit_claude-3-5-sonnet_swe-search`) | none; guard:secrets does not flag it |


### Dogfood run 3: M7 (`pnpm remit review --issue .agent/milestones/M7.md --diff m6-done..HEAD`), 2026-09-26

No keys: task-list extraction (10 requirements), no Jev verdicts; 315 units (the Action bundle in `packages/action/dist` is filtered as generated). Code facts:

| Finding | What Remit said | Right? | Action |
| --- | --- | --- | --- |
| fixtures/webhooks/*.json (18 facts) | `secret_like` high-entropy token | wrong: GitHub GraphQL `node_id` values | fixed: `node_id` lines are identifier context in secrets.ts, with a regression test (key patterns on such lines still match) |
| packages/cli/src/providers.ts:33 | `public_api_changed`: exported `cacheDir` removed | wrong: it is re-exported from @remit/providers, so the CLI API is unchanged | none (re-exports are not declarations; a known limit of the line-based detector) |


### Dogfood run 4: M8 (`pnpm remit review --issue .agent/milestones/M8.md --diff m7-done..HEAD`), 2026-09-27

No keys: task-list extraction (6 requirements), no Jev verdicts; 360 units. Code facts:

| Finding | What Remit said | Right? | Action |
| --- | --- | --- | --- |
| pg-queue.ts:60,69 | `catch_broadened`: empty `.catch` on `createQueue` | right: a lost connection would be hidden | fixed: `getQueue` check, then create; errors surface |
| dashboard-api.ts:149 | `catch_broadened`: empty `.catch` on the request body | right, intended: invalid JSON becomes `null` and the zod check returns 400 | none |
| db/pglite-server.ts:8 | `new_symbol_unreferenced`: `startPgliteServer` | right: a test harness in src, like fake-harness.ts | none |
| queue.ts:6 | `public_api_changed`: exported type `Job` removed | right: jobs became serializable `JobSpec` data for pg-boss | none |

## Eval runs

- 2026-09-26T17:22:28.991Z mutations/dev simulated (not a real measurement): 0/128 items correct, requirement F1 0.30, PR recall 0.85, false alarms 9.94, P0 precision 0.19, cost $0.0000. Report: eval/reports/2026-09-26T17-22-28-991Z (local only, superseded)
- 2026-09-26T17:40:19.484Z mutations/dev simulated (not a real measurement): 0/128 items correct, requirement F1 0.30, PR recall 0.85, false alarms 9.94, P0 precision 0.20, cost $0.0000. Report: eval/reports/2026-09-26T17-40-19-484Z (superseded by 2026-09-26T17-51-01-962Z)
- 2026-09-26T17:50:10.881Z mutations/dev simulated (not a real measurement): 0/128 items correct, requirement F1 0.30, PR recall 0.85, false alarms 9.94, P0 precision 0.20, cost $0.0000. Report: eval/reports/2026-09-26T17-50-10-881Z (local only, superseded)
- 2026-09-26T17:51:01.962Z mutations/dev simulated (not a real measurement): 0/128 items correct, requirement F1 0.30, PR recall 0.85, false alarms 9.94, P0 precision 0.20, cost $0.0000. Report: eval/reports/2026-09-26T17-51-01-962Z
