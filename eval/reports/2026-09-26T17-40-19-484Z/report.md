# Remit eval: mutations (dev)

> Not a real measurement. Answers came from the simulated Jev stand-in (no keys), so these numbers check the plumbing, not model quality.

Run `2026-09-26T17:40:19.484Z`, git `f3c635e72750`, provider mode `simulated`, Jev `simulated-jev`, questions `qs-0.1.0`, extraction `xp-0.1.0`.

## Summary

| Metric | Value |
|---|---|
| Items | `128` (`0` fully correct, `0.0%`) |
| Requirement problems: precision / recall / F1 | `0.18` / `0.95` / `0.30` |
| Abstention rate (uncertain) | `0.0%` of `512` labeled requirements |
| Unexplained behavioral units: precision / recall | `0.01` / `0.89` |
| Test integrity: precision / recall | `0.50` / `1.00` |
| PR level (any P0 vs problem): precision / recall | `0.87` / `0.85` |
| False alarms (P0 or P1 per clean PR) | `9.94` over `18` clean items |
| P0 precision | `0.20` (`59` of `299`) |
| AUROC, problem vs clean (strongest P0/P1 finding) | `0.54` |
| Latency p50 / p95 | `17 ms` / `25 ms` |
| Cost total / p50 per review | `$0.0000` / `$0.0000` |
| Tokens: Jev in / LLM in / LLM out | `0` / `0` / `0` |
| Truncation rate | `0.0%` |

## Targets (11.8)

| Target | Goal | Actual | Met |
|---|---|---|---|
| Recall: drop_requirement | `>= 0.85` | `1.00` | yes |
| Recall: flip_condition | `>= 0.60` | `0.85` | yes |
| Recall: weaken_assertion | `>= 0.90` | `1.00` | yes |
| Recall: inject_config | `>= 0.70` | `0.89` | yes |
| False alarms on clean seeds | `<= 0.15` | `9.44` | no |
| P0 precision | `>= 0.80` | `0.20` | no |
| ECE after calibration (5-fold) forward.coverage.level3 | `<= 0.10` | `0.09` | yes |
| ECE after calibration (5-fold) forward.coverage.level2 | `<= 0.10` | `0.01` | yes |
| ECE after calibration (5-fold) forward.coverage.missing | `<= 0.10` | `0.07` | yes |
| ECE after calibration (5-fold) forward.conflict | `<= 0.10` | `0.00` | yes |
| ECE after calibration (5-fold) tests.asserts_differently | `<= 0.10` | `0.00` | yes |
| ECE after calibration (5-fold) reverse.loosens_test | `<= 0.10` | `0.01` | yes |
| ECE after calibration (5-fold) reverse.behavior_change | `<= 0.10` | `0.00` | yes |

## Mutation operators

| Operator | Items | Detected (recall) | Every label correct |
|---|---|---|---|
| claim_all_done | `9` | `1.00` | `0` |
| drop_requirement | `36` | `1.00` | `0` |
| flip_condition | `20` | `0.85` | `0` |
| inject_config | `9` | `0.89` | `0` |
| inject_refactor | `9` | `0.00` | `0` |
| partial_requirement | `9` | `0.89` | `0` |
| skip_test | `9` | `1.00` | `0` |
| unwire | `9` | `1.00` | `0` |
| weaken_assertion | `9` | `1.00` | `0` |

## Extraction stability

Mean Jaccard over quotes `1.00` on `7` of `7` sampled issues (task-list extraction, deterministic by construction).

## Requirement confusion matrix

Rows are labels, columns are verdicts.

| label \ verdict | contradicted | deferred | done | missing | partial |
|---|---|---|---|---|---|
| contradicted | `0` | `0` | `3` | `8` | `9` |
| done | `0` | `1` | `55` | `218` | `153` |
| missing | `0` | `0` | `0` | `39` | `8` |
| partial | `0` | `0` | `1` | `10` | `7` |

## Calibration

| Question key | Samples | ECE raw | ECE after isotonic (5-fold) | Brier raw |
|---|---|---|---|---|
| forward.conflict | `512` | `0.06` | `0.00` | `0.04` |
| forward.coverage.level2 | `512` | `0.19` | `0.01` | `0.11` |
| forward.coverage.level3 | `512` | `0.66` | `0.09` | `0.59` |
| forward.coverage.missing | `512` | `0.51` | `0.07` | `0.41` |
| reverse.behavior_change | `101` | `0.56` | `0.00` | `0.40` |
| reverse.loosens_test | `721` | `0.10` | `0.01` | `0.02` |
| tests.asserts_differently | `512` | `0.06` | `0.00` | `0.04` |

## Worst items

- [rs-semver-compare.clean](items/rs-semver-compare.clean.json): R1 missing (expected done); R2 partial (expected done); R3 missing (expected done); R4 partial (expected done)
- [ts-job-intervals.clean](items/ts-job-intervals.clean.json): R1 missing (expected done); R2 missing (expected done); R4 missing (expected done); src/schedule.ts#parseDuration unexplained_behavioral (expected implements)
- [py-blog-slugs.clean](items/py-blog-slugs.clean.json): R1 missing (expected done); R2 missing (expected done); R3 missing (expected done); R4 partial (expected done)
- [py-retry-backoff.clean](items/py-retry-backoff.clean.json): R1 partial (expected done); R2 partial (expected done); R3 partial (expected done); tests/test_retry.py#test_sleeps_grow_between_attempts unexplained_behavioral (expected implements)
- [ts-flag-rules.clean](items/ts-flag-rules.clean.json): R1 partial (expected done); R2 missing (expected done); R3 missing (expected done); R4 partial (expected done)
- [rs-cli-args.clean](items/rs-cli-args.clean.json): R2 partial (expected done); R3 missing (expected done); R4 missing (expected done); src/args.rs#parse_args unexplained_behavioral (expected implements)
- [rs-config-parser.clean](items/rs-config-parser.clean.json): R1 missing (expected done); R2 missing (expected done); R3 missing (expected done); src/parser.rs#unquote unexplained_behavioral (expected implements)
- [py-csv-import.clean](items/py-csv-import.clean.json): R2 partial (expected done); R3 partial (expected done); R4 partial (expected done); importer/csv_import.py#import_rows unexplained_behavioral (expected implements)
- [ts-money-format.clean](items/ts-money-format.clean.json): R1 partial (expected done); R2 missing (expected done); R3 missing (expected done); R4 missing (expected done)
- [py-blog-slugs.inject_refactor.blog_reading_time.py](items/py-blog-slugs.inject_refactor.blog_reading_time.py.json): R1 missing (expected done); R2 missing (expected done); R3 missing (expected done); R4 partial (expected done)
