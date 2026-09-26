# Evaluation

How Remit is measured (BUILD_PROMPT 11). Run it with `pnpm eval:golden`, `pnpm eval:dev` and, only for the frozen check, `pnpm eval:test --gate`.

## Corpora

| Corpus | Where | Items | Labels |
|---|---|---|---|
| D `golden` | `fixtures/golden/` | `18` Appendix D scenarios | exact expected verdicts; always run scripted; never split |
| B `mutations` | `eval/corpora/mutations/` | seeds plus every G.1 operator | requirement statuses, unit roles, facts, PR level |
| A `swebench` | `eval/corpora/swebench/` | SWE-bench Verified gold patches and plausible agent patches | PR level (`problem` or `clean`), with a label source and strength |
| C `shadow` | `eval/corpora/shadow/` | real reviews with human feedback (from M8) | human feedback |

Every item has the same shape (`packages/eval/src/item.ts`): the review input, optional base and head trees, the config, labels, and optional scripted provider answers.

## Corpus B: seeds and mutations

- **Seeds** live in `eval/corpora/mutations/seeds/<id>/`: `seed.json` (the annotation), `issue.md` (a task list, so requirement ids are stable), `pr.md`, and full `base/` and `head/` trees. At least `4` synthetic seeds per language (TS, Python, Rust). Annotations carry `annotated_by: claude-code` and are listed in `.agent/BLOCKERS.md` as optional human spot checks.
- **Operators** (`packages/eval/src/mutations/operators.ts`) edit the head tree with tree-sitter, re-parse every touched file, and recompute the diff against base. A seed and all its mutations share a split.

| Operator | Edit | Expected label |
|---|---|---|
| `drop_requirement(Rk)` | revert Rk's implementing and test units (whole symbols, or the statements and expressions the annotation names when a symbol is shared) | Rk `missing`; PR `problem` |
| `flip_condition(Rk)` | change one literal or operator in Rk's code and the matching expected value in its test | Rk `contradicted`; PR `problem` |
| `partial_requirement(Rk)` | remove one case (switch case, match arm, pair, if) and its assertion | Rk `partial`; PR `problem` |
| `weaken_assertion` | `toBe` to `toBeDefined()`, `assert a == b` to `assert a`, `assert_eq!` to `assert!(..is_some())` in an unrelated test | `assertion_weakened` fact and a test integrity finding; PR `problem` |
| `skip_test` | `it.skip`, `@pytest.mark.skip`, `#[ignore]` on an unrelated test | `test_skipped` fact; PR `problem` |
| `inject_config` | change a runtime default in an unrelated config module | unit `unexplained_behavioral`; PR `problem` |
| `inject_refactor` | rename a local variable in an unrelated function | unit `unexplained_benign` (or filtered or supporting); PR `clean` |
| `unwire(Rk)` | replace the call of Rk's new function with its first argument | Rk `partial` (or `missing`); `new_symbol_unreferenced`; PR `problem` |
| `claim_all_done` | `drop_requirement(R1)` plus a PR body claiming every requirement is done | R1 `missing` with a P0 claim mismatch |

Regenerate items with `pnpm remit mutate --seed <path>` (one seed) or `pnpm remit mutate --all`. Test-split items are frozen, so regenerating them must produce identical bytes.

**Real seeds** (G.2) need `GITHUB_TOKEN`. `pnpm eval:mine-seeds` scans the repositories in `MINING_REPOS` (license re-checked: MIT, Apache-2.0, BSD, ISC, 0BSD or Unlicense only). It keeps merged PRs (2024 to 2026) that close exactly one issue stating at least 2 explicit requirements and change 20 to 800 lines, not dominated by generated files or lockfiles. Candidates land in `eval/corpora/mutations/real/<id>/` with the issue, PR text, changed file versions, license and SHAs; every GitHub response is cached in `eval/cassettes/github/`. A candidate becomes a seed once someone writes its `seed.json`.

## Corpus A: SWE-bench Verified and PatchDiff

Source: the PatchDiff study, "Are 'Solved Issues' in SWE-bench Really Solved Correctly?" (You Wang, Michael Pradel, Zhongxin Liu; ICSE 2026). The study labels come from the Zenodo record `10.5281/zenodo.18258368` (CC-BY-4.0), and the issue text and gold patches from SWE-bench Verified. `docs/eval-corpus-a.md` has the file formats and source details.

`pnpm eval:fetch-a` downloads the raw files through the providers HTTP client into `eval/corpora/swebench/raw/` (gitignored). It records URLs and hashes in `SOURCES.json` and rebuilds the items. The loader never touches the network.

- **Issue:** the SWE-bench `problem_statement` (first line as title).
- **Diff:** the agent patch, or the gold patch for gold items. The benchmark `test_patch` is never included. Test files the agent added itself stay in its diff.
- **Items:** `gold:<instance_id>` and `<Tool>:<instance_id>` for `OpenHands`, `CodeStory` and `LearnByInteract`.

### Label mapping

Rules are applied in order for each plausible (resolved) agent patch. The first match wins.

| Case | PR label | Source | Strength |
|---|---|---|---|
| Gold patch | `clean` | `gold` | strong |
| `RQ34.csv` correctness `incorrect_*` (manual) | `problem` | `rq34_manual` | strong |
| `RQ34.csv` correctness `correct_*` (manual) | `clean` | `rq34_manual` | strong |
| `RQ34.csv` correctness `uncertain` (behaviorally divergent, undecided) | `problem` | `rq34_manual` | weak |
| RQ1 `difference = functionality` (fails developer tests that gold passes) | `problem` | `rq1_devtests` | medium |
| RQ2 has a differentiating test (behaviorally divergent from gold) | `problem` | `rq2_divergent` | weak |
| RQ1 `coding_conventions` only | excluded | | |
| RQ2 tested, no differentiating test | `clean` ("no divergence found", not a correctness judgment) | `rq2_no_divergence` | weak |
| Never tested by PatchDiff, not plausible, empty patch, or patch over `200 KB` | excluded | | |

Counts from the fetch on `2026-09-26`: `500` gold; `277` problem; `926` clean (`500` gold, `422` no divergence, `4` manually correct); `174` excluded (`145` untested, `20` coding conventions only, `8` oversized, `1` empty). The raw data matches the paper: `877` plausible patches, `260` divergent (`72`, `91`, `97`), `68` RQ1 functionality failures, and `77` manual labels (`22` incorrect, `4` correct, `51` uncertain).

**Caveats**
- Only `4` agent patches were manually judged correct. The large clean agent pool is absence of evidence.
- `uncertain` counts as a problem because the spec treats behaviorally divergent patches as positives, but the authors could not decide those `51`. Reports slice corpus A by source and strength.
- Patches that change more behavior than gold (`supplementary_more`, `supplementary_change`) are reverse-pass positives. The study does not name the units, so there are no unit labels for them.
- Corpus A is mostly single-requirement Python bug reports. Report it separately, and never tune only to it. It has no hard target: the report gives AUROC for problem against clean.
- Extraction for corpus A needs an LLM (problem statements have no task lists), so corpus A runs only with keys.

## Splits and freezing

- `70%` dev and `30%` test, by the first `32` bits of `sha256` of the item's group id. The group is the seed id for corpus B and the SWE-bench `instance_id` for corpus A, so a gold patch and its agent patches share a split.
- `eval/corpora/test.sha256` lists a hash for every test file. `guard:split` (part of `pnpm verify`) fails if any test file changes, appears or disappears.
- The test split runs only through `pnpm eval:test --gate`. Log every run in `.agent/EXPERIMENTS.md`. The `eval-analyst` subagent never opens test items.

## Modes

- `scripted`: recorded answers (golden only).
- `simulated`: a heuristic stand-in for Jev that answers from lexical overlap and never reads labels. It is a plumbing check and a weak baseline. Every report from it starts with "Not a real measurement".
- `live`: cached real providers over `eval/cassettes/`. Runs stop at `EVAL_MAX_USD` (default `$20`).
