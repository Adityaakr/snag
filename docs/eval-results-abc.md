# A vs B vs C: measured comparison (2026-09-27)

Systems, all scored by `scripts/eval/compare.mjs` with the definitions in `docs/acceptance.md`:
- **A:** single-pass review, one Claude Sonnet 5 call per PR (via OpenRouter), prompt `sp-0.2.0`, given Remit's extracted requirements.
- **B:** structured Remit pipeline with Sonnet 5 answering the typed questions (`jev.engine: llm`), including the D37 fix unless noted.
- **C:** structured Remit pipeline with the local fine-tuned Laya checkpoint (remit-laya-v1).

Raw predictions and scored results: `eval/results/abc-2026-09-27/`. Every row is on exactly the same items.

**99% acceptance: FAILED.** No metric is independently supported at 99% (details in section 4).

## 1. Comparison on the held-out development seeds

Mutation corpus, validation seeds py-retry-backoff and rs-semver-compare (never used for training). 27 items with predictions from both A and C. Requirements are fixed (task lists), so this is Track A: verdict quality with correct requirements.

| Metric | A (single pass) | A + deterministic facts | C (Laya v1) |
|---|---|---|---|
| Target defect flagged, any type | 21/23, 91.3% [73, 98] | 23/23, 100% [86, 100] | 3/23, 13.0% [5, 32] |
| Target defect recall, correct type | 16/23, 69.6% [49, 84] | 18/23, 78.3% [58, 90] | 3/23, 13.0% [5, 32] |
| Finding precision (P0/P1, all PRs) | 21/23, 91.3% [73, 98] | 23/25, 92.0% [75, 98] | 3/11, 27.3% [10, 57] |
| False findings on defective PRs | 2 on 23 | 2 on 23 | 7 on 23 |
| Clean-PR false-positive rate | 0/4 | 0/4 | 1/4 |
| Requirement-status correctness | 101/108, 93.5% [87, 97] | 101/108, 93.5% [87, 97] | 64/108, 59.3% [50, 68] |
| Entire-review correctness | 19/27, 70.4% [52, 84] | 21/27, 77.8% [59, 89] | 1/27, 3.7% [1, 18] |
| Abstentions (`uncertain` requirements) | 0/108 | 0/108 | 26/108 |
| Failed or incomplete reviews | 0/27 after one retry; 10/29 on the first attempt (truncated output) | same | 2/27 |
| Cost per review | $0.029 | $0.029 (facts are free) | no API cost; local GPU |
| Latency p50 / p95 | 17.2 s / 47.5 s | same | not recorded for this run |

**B was not run on all 27 items.** At about $0.16 per review that would cost about $3.50, over the budget. On the 7-item subset where B has answers:

| Metric (7 items) | A | B before D37 | B after D37 | C |
|---|---|---|---|---|
| Target recall, correct type | 5/6 | 4/6 | 4/6 | 0/6 |
| Target flagged, any type | 6/6 | 6/6 | 6/6 | 0/6 |
| Finding precision | 6/6 | **6/9** | 6/6 | 0/2 |
| Entire-review correctness | 6/7 | 4/7 | 4/7 | 0/7 |
| Cost per review | $0.025 | $0.158 | $0.158 | local |

**B's precision: 6/9, not the 50% I reported earlier.**
- B surfaced 9 P0/P1 findings on those 7 PRs: 6 correct requirement findings and 3 false "unexplained behavioural" unit findings (all on `client/retry.py`).
- The earlier 50% counted only the three imperfect reviews (3 correct and 3 false) and wrongly left out B's three correct findings on the other defective PRs.
- The false findings were caused by a verdict rule, not by the model (D37). The same cached answers with the fix give 6/6.

**Real repositories (clean-PR specificity).** A was run on 30 SWE-bench Verified gold patches (11 repositories, at most 3 each) and flagged **9/30** (12 requirement findings and 7 unexplained-unit findings).
- These are unadjudicated. PAIChecker reports that 13.6% of gold patches are misaligned with their issue, so some flags may be correct.
- Even so, specificity on real code is far below 99%.
- C was not evaluated here: its extraction needs paid LLM calls.

## 2. Ablation of B's components on top of A

| Step | Items | Useful catches added | False findings added | Cost added | Decision |
|---|---|---|---|---|---|
| A (single pass) | 27 | baseline | baseline | $0.029 per review | foundation |
| + requirement decomposition (Remit's extracted requirements vs A's own) | 7 | not separable: both variants PR-recall 1.0 and FP 0 (aggregate only) | not separable | extraction call | unmeasured |
| + deterministic facts (weakened or skipped tests) | 27 | **+2** (skip_test, weaken_assertion) | 0 | $0 | **keep** |
| + unit-role analysis (B reverse questions, after D37) | 7 | 0 | 0 (3 before D37) | part of $0.13 per review | not demonstrated; not exercised on inject cases |
| + model test-integrity checks | 7 | 0 | 0 | part of $0.13 per review | not demonstrated |
| Full B requirement verdicts instead of A's | 7 | -1 correct-type catch, -2 correct statuses | 0 | +$0.13 per review | reject for now |

## 3. Representative errors

- **True positive (A):** `rs-semver-compare.flip_condition.R3` flagged as contradicted with the right requirement. Every held-out flip was caught by A (5/5).
- **Wrong defect type, the dominant A error (4 cases):** `py-retry-backoff.drop_requirement.R1` is labelled missing; A says contradicted. A reads the remaining code as "does something else" where the requirement is simply not implemented.
- **Disputed labels (kept visible):**
  - `py-retry-backoff.partial_requirement.R2` (A: contradicted): the removed case makes the code raise on the first 429, the opposite of the requirement.
  - `py-retry-backoff.unwire.R1` (A: contradicted): the audit proposes relabelling it contradicted.
  - Under the audit's resolutions, A's correct-type recall would be 18/23 (A + facts 20/23). The table above uses the original labels.
- **False positives (A):**
  - `inject_config`: A calls R3 contradicted although it is done.
  - `unwire.R1`: A calls R4 partial although it is done.
  - skip and weaken items: A labels the weakened test file "unexplained behaviour" (a real defect, but the wrong finding type).
- **Clustering:** all 8 imperfect A reviews come from one seed (py-retry-backoff); rs-semver-compare has none. The effective sample size is closer to the number of seeds than to the number of items.
- **C (Laya):** near-constant answers. Stage A retraining on fixed, adjudicated data still gave 0/43 missing recall and conflict false positives on 92% of held-out negatives (EXPERIMENTS E2). **Laya training is paused.**

## 4. The 99% acceptance requirements

Intervals are Wilson 95% intervals over items. Items from the same seed are correlated (2 seeds here), so the intervals are optimistic. A seed-clustered analysis would be wider. Nothing below comes from the frozen final test, which remains untouched.

| Requirement (≥99%) | Best measured (A + facts, held-out dev) | Status |
|---|---|---|
| Finding precision | 23/25 = 92.0% [75, 98] | **Failed** |
| Target-defect recall (correct type) | 18/23 = 78.3% [58, 90] | **Failed** |
| Requirement-status correctness | 101/108 = 93.5% [87, 97] | **Failed** |
| Entire-review correctness | 21/27 = 77.8% [59, 89] | **Failed** |
| Clean-PR specificity | 4/4 on mutations; 21/30 = 70% on SWE-bench gold (unadjudicated) | **Failed** (the 4/4 point estimate is not evidence at n=4) |
| Complete-review rate | 29/29 with one retry; 19/29 first attempt | **Point estimate meets target (with retry), evidence insufficient**; failed without retry |

## 5. Resources

- **OpenRouter:** $3.54 of the $5 cap spent in this phase. That includes the 7-item B and A runs, A on 29 held-out items plus retries, and A on 30 SWE-bench gold patches.
- **Local compute:** Apple M5 GPU. Stage A took about 25 min (74 steps, 14 to 27 s per step under contention). Evaluation runs as noted.

## 6. Recommendation and next experiment

**Recommendation.** Use **A + deterministic facts** as the foundation for a comment-only pilot candidate. It is simpler, 5 times cheaper than B, and at least as accurate on every measured metric. It is **not** release-ready: every 99% requirement fails.

**Next experiment:** the defect-type and false-positive error modes of A.
- Add an explicit "is the stated behaviour implemented anywhere in the diff?" step before "does it contradict?".
- Evaluate on the untouched final test only after freezing.
- Build an adjudicated clean-PR set (for example PAIChecker's labelled SWE-bench Verified subset) to measure specificity on real code with enough examples to bound it. About 380 independent error-free cases are needed before a 99% lower bound is even possible.
