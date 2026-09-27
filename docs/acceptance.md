# Acceptance contract

This contract defines what Remit must demonstrate before any release beyond experimental use. The bar is **at least 99% on every metric below, each reported separately**. A point estimate is not enough: the lower bound of the uncertainty interval must also clear the bar, as defined in the evidence rules. No metric is averaged into a composite. Merge blocking stays disabled until every metric is independently supported.

## A. Supported input scope

| Dimension | In scope | Out of scope (reported as unsupported, never scored as correct) |
|---|---|---|
| Languages | TypeScript and JavaScript, Python, Rust (tree-sitter units) | other languages (hunk-level units only) |
| Repositories | single-package repositories with a unified diff and readable base and head trees | monorepo-wide changes needing cross-package build knowledge |
| Change size | up to `budgets.max_units` (400) units; each verdict state up to the engine's window (4,096 tokens for Laya, 24,000 for Jev and LLM engines) | larger changes: partial review, reported as incomplete |
| Requirements | GitHub issue text and comments, task lists, quoted requirements (extraction) | requirements only in linked documents or images |
| Defect categories | missing, partial, contradicted requirement; tests asserting different behaviour; weakened or skipped tests; unexplained behavioural change | performance, security and style defects not stated in the issue |

## B. Units of evaluation

- **Question:** one typed answer (for example `forward.coverage` for one requirement). A diagnostic for the verdict engine, never a release metric.
- **Requirement:** the status of one requirement in one review (done, partial, missing, contradicted, not checkable, preexisting, deferred, uncertain).
- **Finding:** one surfaced problem (requirement, unit, test-integrity, claim mismatch) with its evidence.
- **PR review:** the complete result for one PR.
- **Issue-resolution task:** a SWE-bench-style task. **Not applicable**: Remit does not write patches (see section D).

## C. Correctness metrics (all proportions; each needs 99%)

| Metric | Numerator | Denominator | Notes |
|---|---|---|---|
| Finding precision | surfaced P0/P1 findings that are true problems | all surfaced P0/P1 findings | P2 notes are reported separately |
| Target-defect recall | defects that were planted or labelled and flagged **on the target requirement, with the correct defect type** | all target defects | Flagging an unrelated problem does not count. "Flagged with the wrong type" is reported next to it. |
| Requirement-status correctness | requirements whose status equals the label (or an accepted alternative listed in the item) | all labelled requirements | Abstentions (`uncertain`) count as not correct |
| Entire-review correctness | reviews where every labelled requirement, unit, fact and test-integrity expectation matches | all reviews, **including incomplete ones** | An incomplete review is never entirely correct |
| Clean-PR specificity | clean PRs with no P0/P1 finding | all clean PRs | |
| Complete-review rate | reviews with no provider, budget, overflow or parsing failure | all reviews attempted | |
| Abstention rate and decisive coverage | reported, not gated | | Abstention is a visible outcome, never a correct verdict |

## D. Benchmark registry

The full registry, built from primary sources, is in `docs/benchmark-registry.md`. Summary:

| Benchmark | Fits Remit's task | Use | Official metric |
|---|---|---|---|
| Corpus D (golden, 18 scenarios, this repo) | yes, requirement level | regression suite only (not independent: written by the same author as the pipeline) | entire-review correctness |
| Corpus B (mutations, 12 synthetic seeds, this repo) | yes, requirement level | train (7 seeds), validation (2), final test (3, frozen) | the section C metrics |
| Corpus A (SWE-bench Verified plus PatchDiff labels) | partial, PR level only | PR-level diagnostics | none official. Labels come from one study, and "clean" mostly means "no difference found". PAIChecker disagrees with "gold is clean" for 52 of 500 gold patches. |
| PAIChecker (PR-issue misalignment, manual labels, MIT) | yes, PR level | candidate independent evaluation (not yet integrated) | its published accuracy |
| SWE-bench family (issue resolution) | **no**: it grades patch-writing agents | only as an add-on (candidate-patch filtering with a fixed agent); no such agent exists here | % resolved |

**Claims Remit cannot make:** any SWE-bench score, state of the art on any benchmark, or requirement-level accuracy on real issues (no public requirement-level labels exist; corpus B is synthetic and Claude-annotated).

## Evidence rules

- Every metric reports its numerator, denominator and a 95% interval.
  - The interval is Wilson, plus a seed-clustered bootstrap when examples share seeds.
  - "Independently supported" requires the lower bound to be at least 99%, on data never used for training, tuning or threshold selection.
- With `n` independent examples and zero errors, the Wilson lower bound reaches 99% only at about `n ≥ 380`. Corpus B's frozen test split has 3 seeds (about 40 items), so it **cannot** support 99% for any metric, whatever the point estimate.
- Status labels for each claim: **Failed**; **Point estimate meets target, evidence insufficient**; **Independently supported under the declared protocol**.
- If final-test results inform any change, that split is retired from final-test status.
