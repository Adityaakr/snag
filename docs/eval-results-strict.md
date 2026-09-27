# Strict evaluation results (2026-09-28)

This supersedes the metrics in `docs/eval-results-abc.md`, which used a lenient scorer and unadjudicated labels. Scorer: `packages/eval/src/compare/score.ts` (tests in `score.test.ts`), CLI `scripts/eval/compare.ts`. Raw outputs: `eval/results/strict-2026-09-28/`. Rubric: `docs/status-rubric.md`.

**99% acceptance: FAILED on every metric.** Nothing below is from the frozen final test, which is untouched.

## 1. Evaluator fixes (verified by tests)

| Defect in the old evaluation | Fix |
|---|---|
| A target counted as detected from its status alone, even when no finding reached the user | Target recall counts only surfaced P0/P1 findings. Requirement-status accuracy is reported separately. |
| Any finding on a problem requirement counted as correct, whatever its type | One-to-one matching by requirement **and** type. Unit and test defects match by overlapping lines, not by file. |
| Duplicate findings could each count | A second finding on an already-matched defect is a duplicate and counts against precision |
| Entire-review ignored labelled facts, unit roles and test integrity | Aligned with `docs/acceptance.md`: every labelled requirement, unit, fact, test-integrity and claim expectation; no incorrect finding; complete |
| Defects whose location the labels cannot resolve were silently scored | They are **unmeasured** and reported as such |
| File-level fact labels were checked against an arbitrary unit of that file | Only symbol-level labels constrain lines |
| A claim-mismatch reason on a finding was split into two findings | It is one finding with a claim facet |
| **Reports dropped passing items in runs over 50 items** (15 of 128 C items were never written) | Every item is dumped (regression test) |
| Cached timings mixed with live inference | Cached calls are flagged and excluded from latency |

Reproduction of the old A + facts figures (lenient scorer, all 29 held-out items): precision 25/29, correct-type recall 20/25, entire-review 21/29. The strict scorer gives 20/29, 19/25 and 20/29 on the original labels. Every difference is itemised in `.agent/EXPERIMENTS.md` (E6):
- **5 type mismatches** that the old scorer counted as correct;
- **1 unsurfaced claim mismatch** (rs-semver `claim_all_done`: right status, but no claim finding);
- **2 test-file unit findings,** now duplicates of the deterministic test-integrity finding.

## 2. Labels (adjudicated against the written rubric)

- **Mutation labels follow the operator's name, not the code.** 9 of 12 audited held-out cases are contradicted, not missing or partial: the situation still reaches a defined code path whose outcome the requirement rules out (`training/laya/audit/mutation-adjudication-2026-09-28.md`). The corrections are applied as an overlay (`eval/labels/adjudicated-2026-09-28.json`), and the corpus files are unchanged. One case is marked ambiguous (rs-semver drop R1). The same systematic error probably affects the training seeds; that is a hypothesis, not yet audited.
- **Real SWE-bench gold patches:** every finding of A was adjudicated (`training/laya/audit/swebench-gold-adjudication-2026-09-28.md`, finding labels in `eval/labels/swebench-gold-findings-2026-09-28.json`). The 9/30 figure is an **unadjudicated flag rate**, not specificity.

## 3. Results

### Held-out mutation seeds, all 29 attempted items (2 seeds), adjudicated labels

| Metric | A | A + deterministic facts | A + facts + E4 | C (Laya v1) |
|---|---|---|---|---|
| Target defect surfaced, correct type | 16/25 = 64% [45, 80] | 20/25 = 80% [61, 91] | 20/25 = 80% [61, 91] | 4/25 = 16% [6, 35] |
| Target defect surfaced, any type | 21/25 = 84% | 23/25 = 92% [75, 98] | 23/25 = 92% | 5/25 = 20% |
| Finding precision (surfaced P0/P1) | 18/25 = 72% [52, 86] | 22/29 = 76% [58, 88] | 22/29 = 76% [58, 88] | 4/14 = 29% [12, 55] |
| Incorrect findings: type mismatch / duplicate / false | 5 / 0 / 2 | 3 / 2 / 2 | 3 / 2 / 2 | 1 / 0 / 9 |
| Clean PRs with any finding | 0/4 | 0/4 | 0/4 | 1/4 |
| Requirement-status accuracy | 111/116 = 96% | 111/116 = 96% [90, 98] | 111/116 = 96% | 76/116 = 66% |
| Entire-review correctness | 17/29 = 59% | 20/29 = 69% [51, 83] | 20/29 = 69% | 3/29 = 10% |
| Complete reviews | 29/29 after one retry (19/29 first attempt) | same | same | 29/29 |
| Abstentions | 0/116 | 0/116 | 0/116 | 21/116 |

The table with the original labels is in `eval/results/strict-2026-09-28/heldout-original/comparison.md`. With original labels, A + facts reaches 19/25 correct type, 20/29 precision and 20/29 entire-review.

### Shared 7 items (the only items with B predictions), adjudicated labels

| Metric | A + facts + E4 | B (structured, Sonnet 5) | C (Laya v1) |
|---|---|---|---|
| Target surfaced, correct type | 4/6 | 5/6 | 0/6 |
| Finding precision | 4/6 | 5/6 | 0/2 |
| Requirement-status accuracy | 26/28 | 26/28 | 17/28 |
| Entire-review correctness | 5/7 | 5/7 | 0/7 |

**A and B cannot be separated on 7 items.** With the original labels A looked better (5/6 vs 4/6); with rubric-adjudicated labels B does.

### Real repositories: 30 SWE-bench Verified gold patches (finding-level adjudication, issue plus diff only)

| System | Flagged PRs (unadjudicated rate) | Findings: valid / type-mismatched / false / undecidable | Precision (decidable) | Adjudicated-clean PRs flagged |
|---|---|---|---|---|
| A (sp-0.2.0) | 9/30 | 1 / 1 / 14 / 3 | 1/16 = 6% [1, 28] | 5/10 |
| A + E4 | 7/30 | 1 / 1 / 10 / 3 | 1/12 = 8% [1, 35] | 3/10 |
| A-v3 (E5) | 9/30 | 2 / 0 / 14 / 3 | 2/16 = 12.5% [3, 36] | 4/10 |
| A-v3 + E4 | 6/30 | 2 / 0 / 7 / 3 | 2/9 = 22% [6, 55] | 2/10 |

"Adjudicated clean" means 10 PRs the adjudicator judged to have no misalignment. Undecidable PRs are excluded.

## 4. Experiments

| Exp | Observed failure | Change | Evidence | Decision |
|---|---|---|---|---|
| E4 | A flags code it cites as evidence for a done requirement as "unexplained" (pylint-4551) | Post-processing rule: an unexplained region overlapping evidence for a done requirement is not surfaced | Real patches: false 14 to 10, valid 1 to 1, undecidable unchanged. Mutations: no change (0 affected). | **Keep.** It removes only self-contradicting findings; no loss seen on either set. |
| E5 | 7 of 14 real-patch false findings come from invented or speculative "requirements" | Product prompt `sp-0.3.0`: extract only what the issue asks for (B.2 stays verbatim for the baseline) | Real patches: invented requirements removed, pylint type corrected (valid 1 to 2), but 6 new false "unexplained" findings on fix-path code; false 14 to 14. With E4: false 7, precision 2/9. **Not run on the mutation set** (about $0.90 would exceed the remaining budget). | **Not adopted yet.** Mixed on one set, untested on the other. |

## 5. Remaining error taxonomy

**Real patches** (A-v3 + E4, 7 false findings):
- fix-path code called unexplained: 5 (matplotlib x3, requests-1142, and one pylint region cited for a *partial* requirement);
- a requirement already done but reported partial: 1 (sklearn-11578 R1);
- an invented requirement from the old code line: 1 (sklearn-11578 R2).

**Mutation held-out** (A + facts + E4, adjudicated labels):
- type mismatches: 3 (contradicted cases reported missing on rs-semver R1 and R2, one of them ambiguous);
- duplicates: 2 (A's unit finding on a weakened test next to the deterministic test finding);
- false: 2 (py unwire R4 reported partial; py inject_config R3 reported contradicted);
- claim mismatch never surfaced by A: 2 claim items (A has no claim-checking output).

## 6. Cost and latency (including failures and retries)

| Run | Reviews | API spend including failed attempts and retries | Per review |
|---|---|---|---|
| A held-out mutations (task-list requirements, no extraction) | 22 live | $0.937 ($0.609 first pass with 10 truncated outputs, $0.328 retries) | $0.043 |
| A on SWE-bench gold, own extraction in the same call | 30 | $0.507 (including 3 retries after a budget-cap bug) | $0.017 |
| A-v3 on SWE-bench gold | 30 | $0.53 | $0.018 |
| B on 7 items | 7 | $1.81 including a probe and a budget-starved run; $1.10 for the valid run | $0.158 marginal, $0.26 with waste |

Live latency (A, held-out): p50 17.2 s, p95 47.5 s over 27 live calls; 2 cached calls excluded. Latency of failed first attempts was not recorded before this change, so end-to-end latency with retries is a lower bound. C's local inference cost (GPU time) was not metered per review.

**OpenRouter spend this phase:** $4.07 of the $5 cap.

## 7. Status against the 99% contract

| Metric | Best measured (development data) | Status |
|---|---|---|
| Finding precision | 76% (mutations, A + facts + E4); 22% on real patches | Failed |
| Target-defect recall, correct type | 80% (mutations) | Failed |
| Requirement-status accuracy | 96% [90, 98] | Failed |
| Entire-review correctness | 69% | Failed |
| Clean-PR specificity | 8/10 adjudicated-clean real PRs unflagged with A-v3 + E4; 4/4 mutation clean PRs | Failed on real code (n too small either way) |
| Complete reviews | 29/29 with one retry; 19/29 first attempt | Point estimate meets target with retry, evidence insufficient |

Intervals are Wilson 95% over items. Items share seeds or repositories, so they are optimistic.

## 8. Verified, hypothesised, unmeasured

- **Verified (command ran, tests pass):** the evaluator fixes and their tests; the dump bug and its fix; E4's effect on both sets; every number in the tables above.
- **Hypotheses:**
  - the training seeds share the operator-name labelling error, which may have contributed to Laya's failure;
  - an issue-scope rule plus a fix-path definition of "explained" would remove most remaining real-patch false findings.
- **Unmeasured:** B on anything beyond 7 items; E5 on the mutation set; C's per-review compute cost; latency including failed attempts; any independent evidence at the 99% level.

## 9. Next decision

Redefine "unexplained change" around the fix path, and ask whether it needs a model at all. The largest remaining real-code error is fix-path code flagged as unexplained (5 of 7 false findings after E4 and E5). The next justified step is a deterministic or cheap check: a changed region is explained when it lies on the call path of code the review cites as evidence, or changes a symbol that evidence code uses. Evaluate it first on the cached predictions (free, since only post-processing changes), then with new predictions on both sets, which needs about $1.50, more than the remaining $0.93. Until then, keep A + facts + E4 in comment-only experimental use.
