# Eval corpus A: PatchDiff and SWE-bench Verified

How to build corpus A (BUILD_PROMPT 11.1) from the PatchDiff replication package and SWE-bench Verified. Everything below was checked against the live sources on `2026-09-26` unless it says "not verified".

## Sources at a glance

| Source | Where | Version checked | License |
| --- | --- | --- | --- |
| Paper | arXiv `2503.15223v2`, ICSE `2026`, DOI `10.1145/3744916.3764576` | v2, `2025-09-09` | arXiv perpetual non-exclusive license |
| PatchDiff GitHub repo | `github.com/ZJU-CTAG/PatchDiff` | one commit, `0a8ed608f9f1`, `2025-09-08` | none declared (no LICENSE file, GitHub API returns 404) |
| PatchDiff results on Zenodo | concept DOI `10.5281/zenodo.15030298` | latest record `18258368` (`2026-01-14`) | CC-BY-4.0 (all versions) |
| SWE-bench Verified | Hugging Face `princeton-nlp/SWE-bench_Verified` | main at `c104f840cc67`; PatchDiff pins `944835eeebcc` | none declared on the dataset card (see licenses) |

## The study

- **Title:** "Are 'Solved Issues' in SWE-bench Really Solved Correctly? An Empirical Study" by You Wang, Michael Pradel and Zhongxin Liu.
- **What PatchDiff is:** an LLM-based differential patch testing tool. It applies two patches (an agent patch and the gold, called "oracle", patch) to the same repo and asks an LLM to write tests whose outcome differs between them. A test that passes under one patch and fails under the other is a "differentiating test".
- **Agents studied** (all on SWE-bench Verified, all Claude 3.5 Sonnet based): OpenHands CodeAct 2.1, CodeStory Midwit (SWE-search), LearnByInteract. Patches come from the SWE-bench experiments leaderboard repo.
- **Headline numbers:** `877` plausible patches in total. `7.8%` pass the SWE-bench check but fail the full developer test suite. `29.6%` (`260`) are "suspicious": PatchDiff found a behavioral difference from gold. Of a `77` patch sample (`30%` of suspicious), `28.6%` (`22`) are certainly incorrect, `4` correct, `51` uncertain.

### Label vocabulary, stage by stage

1. **Plausible.** The agent patch resolved the instance under the official SWE-bench harness. Stored as the `resolved` list in each tool's `results.json`. Counts: OpenHands `265`, CodeStory `311`, LearnByInteract `301`.
2. **RQ1, fails developer tests.** The paper runs every developer test in the repo (not just the SWE-bench ones) under gold and under the agent patch. Stored in `results/RQ1_<Tool>_runall.json`, one key per instance that had any test pass under gold but fail under the agent patch. Field `difference` is either:
   - `functionality`: a real behavior failure. This is what the paper counts (`count_rq1.py` counts `difference == "functionality"` with a non-empty `oracle_pass_model_fail`). Counts: `19`, `26`, `23` (OpenHands, CodeStory, LearnByInteract), `68` total.
   - `coding_conventions`: only a style or code quality test failed, for example `sympy/utilities/tests/test_code_quality.py::test_files`. Counts: `4`, `4`, `28`.
3. **RQ2, behaviorally divergent ("suspicious").** Stored in `results/RQ2_<Tool>_difftests.json`. An instance is divergent when any attempt has a non-empty `differential_tests` list (`count_rq2.py`). Counts: OpenHands `72` of `217` keys, CodeStory `91` of `258`, LearnByInteract `97` of `249`; `260` total, matching the paper. The RQ2 key set includes most RQ1 instances, so an instance can be both (for example `12` of OpenHands' `72` are also RQ1 `functionality` failures).
4. **RQ3 and RQ4, manual labels.** Stored in `results/RQ34.csv`, `77` rows, one per (tool, instance). Every row is a divergent RQ2 instance. Two columns:
   - `diff_pattern` (RQ3 taxonomy, paper table 7): `divergent` ("Divergent implementations of sem-change", `36`), `noalignment` ("No alignment", `16`), `supplementary_more` ("Supplementary sem-change: explicitly handling more possible situations", `13`), `supplementary_change` ("Supplementary sem-change: supplementary change of application logics", `8`), `absent` ("Absent sem-change", the agent patch lacks a change gold makes, `4`).
   - `correctness` (RQ4, paper table 8): `incorrect_regression` (`11`, fixes the issue but breaks unrelated behavior), `incorrect_partial` (`6`, partial fix), `incorrect_irrelevant` (`3`, irrelevant behavioral changes), `incorrect_erroneous` (`2`, erroneous modifications), `correct_irrelevant` (`2`, the difference comes from irrelevant changes in the gold patch), `correct_invaliddt` (`2`, the differentiating test used illegitimate inputs), `uncertain` (`51`, correctness cannot be decided from the issue and repo).
   - `11` of the `77` are also RQ1 `functionality` failures ("Incorrect patches detected in RQ1" in table 8). In the CSV those `11` carry an `incorrect_*` value.

## File layout and formats

### GitHub repo (no results)

The GitHub repo has `data/` and `src/` only. It does not contain `results/`, `count_rq1.py` or `count_rq2.py`; those are only in the Zenodo zip.

| Path | Bytes |
| --- | --- |
| `data/dataset/swebench_verified/data-00000-of-00001.arrow` | `7773784` |
| `data/dataset/swebench_verified/dataset_info.json` | `1661` |
| `data/dataset/swebench_verified/state.json` | `249` |
| `data/tool_results/20241029_OpenHands-CodeAct-2.1-sonnet-20241022_verified/all_preds.jsonl` | `31227948` |
| `data/tool_results/20241029_OpenHands-CodeAct-2.1-sonnet-20241022_verified/results.json` | `8096` |
| `data/tool_results/20241221_codestory_midwit_claude-3-5-sonnet_swe-search/all_preds.jsonl` | `1476034` |
| `data/tool_results/20241221_codestory_midwit_claude-3-5-sonnet_swe-search/results.json` | `10612` |
| `data/tool_results/20250110_learn_by_interact_claude3.5/all_preds.jsonl` | `5196607` |
| `data/tool_results/20250110_learn_by_interact_claude3.5/results.json` | `11593` |
| `src/*.py`, `environment.yml`, `readme.md` | small |

Tool name to run directory (the names used in `RQ34.csv` and `RQ*_<Tool>_*.json`):

| Tool | Run directory |
| --- | --- |
| `OpenHands` | `20241029_OpenHands-CodeAct-2.1-sonnet-20241022_verified` |
| `CodeStory` | `20241221_codestory_midwit_claude-3-5-sonnet_swe-search` |
| `LearnByInteract` | `20250110_learn_by_interact_claude3.5` |

### Zenodo record

Versions under concept DOI `10.5281/zenodo.15030298` (all CC-BY-4.0):

| Record | Date | File | Bytes |
| --- | --- | --- | --- |
| `18258368` (latest) | `2026-01-14` | `PatchDiff_0115_1.zip` | `59563518` |
| `18251378` | `2026-01-14` | `PatchDiff_0115.zip` | `59561728` |
| `17074796` (the DOI in the repo README) | `2025-03-14` | `PatchDiff_0908.7z` | `40670426` |
| `15045390` | `2025-03-14` | `PatchDiff.7z` | `23425114` |

Use the latest zip. I listed its central directory and read individual entries with HTTP range requests (the server returns `206`). The contents of the older `.7z` versions were not verified.

The zip is the GitHub repo (identical `data/` and `src/` sizes) plus `src/count_rq1.py`, `src/count_rq2.py` and `results/`:

| `PatchDiff/results/...` | Uncompressed bytes | Compressed bytes | Needed for corpus A |
| --- | --- | --- | --- |
| `RQ34.csv` | `4807` | `758` | yes |
| `RQ1_OpenHands_runall.json` | `9567` | `1673` | yes |
| `RQ1_CodeStory_runall.json` | `15779` | `2485` | yes |
| `RQ1_LearnByInteract_runall.json` | `46065` | `6550` | yes |
| `RQ2_OpenHands_difftests.json` | `95852069` | `7846233` | yes (only the keys and `differential_tests`) |
| `RQ2_CodeStory_difftests.json` | `113254093` | `9294440` | yes |
| `RQ2_LearnByInteract_difftests.json` | `105763088` | `8833432` | yes |
| `RQ2_<Tool>_deepseek100.json`, `RQ2_<Tool>_qwen100.json` | `19` to `46` MB each | `1.3` to `5.3` MB | no (ablations with other LLMs) |
| `RQ2_baseline_libro_test_patches.json`, `RQ2_baseline_coverup_tests.json`, `RQ2_baseline_pynguin_tests.json` | up to `23` MB | up to `1.6` MB | no (test generation baselines) |

`sha256` of `RQ34.csv` as fetched: `44ac55898d4a9212ba0d3a980d1cb6401c59c562bfc1aee40aa8dadfcd623289`.

### Schemas with real examples

**`all_preds.jsonl`** (one JSON object per line; agent patch text lives here):

```json
{"instance_id": "django__django-17087", "model_name_or_path": "codestory-midwit", "model_patch": "diff --git a/django/db/migrations/serializer.py b/django/db/migrations/serializer.py\nindex d88cda6e20..d46528b73c 100644\n--- a/django/db/migrations/serializer.py\n+++ ..."}
```

- Row counts: OpenHands `499`, CodeStory `455`, LearnByInteract `500`. One row per instance.
- `model_name_or_path` values: OpenHands `claude-3-5-sonnet-20241022_maxiter_100_N_v2.1-no-hint-v0.5-multiaction-run_1`; CodeStory `codestory-midwit`; LearnByInteract `openhands` (sic).
- Quirk: `144` CodeStory rows spell the key `model_name_or_patch` (typo). The loader must accept both and should take the agent name from the run directory, not this field.
- Quirk: `model_patch` can be empty or null (`5` OpenHands rows, `1` CodeStory, `81` LearnByInteract; none of them resolved). Some resolved patches are huge (OpenHands max `5692148` bytes, LearnByInteract max `1934117`); medians are about `2` KB.
- Many resolved agent patches add their own test or reproduction files (paths matching `tests/`, `test_`, `reproduce`): OpenHands `158` of `265`, CodeStory `301` of `311`, LearnByInteract `235` of `301`. These are part of the agent's diff, not the benchmark's `test_patch`, so they stay in the corpus A diff.

**`results.json`** (per tool; `resolved` defines "plausible"):

```json
{"no_generation": ["astropy__astropy-8872", "django__django-11299"], "no_logs": [], "resolved": ["django__django-17087", "..."]}
```

Sizes: OpenHands `no_generation 6, no_logs 1, resolved 265`; CodeStory `45, 0, 311`; LearnByInteract `0, 90, 301`.

**`RQ1_<Tool>_runall.json`** (object keyed by `instance_id`):

```json
{"sphinx-doc__sphinx-8593": {"oracle_pass_model_fail": ["tests/test_util_docstrings.py::test_extract_metadata"], "difference": "functionality"},
 "sympy__sympy-14531": {"oracle_pass_model_fail": ["sympy/utilities/tests/test_code_quality.py::test_files"], "difference": "coding_conventions"}}
```

**`RQ2_<Tool>_difftests.json`** (object keyed by `instance_id`, value is a list of generation attempts):

```json
{"sphinx-doc__sphinx-9320": [{"idx": 4, "gen_test_file": "\n\"\"\"\n    test_quickstart_patches ...", "differential_tests": ["tests/sphinx_doc__sphinx_9320_1738828712_4620674.py::test_is_path_validation_error_patch_2"], "oracle_output": "py39: commands[0]> python -X dev -m pytest ...", "model_output": "py39: commands[0]> python -X dev -m pytest ..."}]}
```

- Most attempts have only `idx`, `gen_test_file`, `differential_tests` (a JSON list, usually empty). Attempts that produced a differentiating test sometimes also carry `oracle_output` and `model_output` (raw pytest logs).
- `idx` is an int and `differential_tests` is always a JSON list in all three files (checked every attempt). Running the authors' `count_rq2.py` on the files gives `72`, `91`, `97`, matching the paper; `count_rq1.py` gives `19`, `26`, `23`. The loader test should assert these totals.
- Instances with any differentiating test also give useful evidence: the test ids and the generated test file that separates the two patches.

**`RQ34.csv`**:

```
tool,instance_id,diff_pattern,correctness
OpenHands,django__django-12858,divergent,incorrect_partial
OpenHands,sympy__sympy-14711,supplementary_more,incorrect_regression
```

**SWE-bench Verified** (gold patches and issue text). Field names confirmed on the Hugging Face card and via the datasets-server rows API: `repo`, `instance_id`, `base_commit`, `patch` (gold code patch, no tests), `test_patch`, `problem_statement`, `hints_text`, `created_at`, `version`, `FAIL_TO_PASS` and `PASS_TO_PASS` (JSON-encoded string lists), `environment_setup_commit`, and on current main also `difficulty`. `500` rows, split `test`. The copy inside PatchDiff is revision `944835eeebcc` and lacks `difficulty`. Real row (truncated):

```json
{"repo": "astropy/astropy", "instance_id": "astropy__astropy-12907", "base_commit": "d16bfe05a744909de4b27f5875fe0d4ed41ce607", "patch": "diff --git a/astropy/modeling/separable.py b/astropy/modeling/separable.py\n...", "test_patch": "diff --git a/astropy/modeling/tests/test_separable.py ...", "problem_statement": "Modeling's `separability_matrix` does not compute separability correctly for nested CompoundModels\n...", "hints_text": "", "created_at": "2022-03-03T15:14:54Z", "version": "4.3", "FAIL_TO_PASS": "[\"astropy/modeling/tests/test_separable.py::test_separable[compound_model6-result6]\", ...]", "PASS_TO_PASS": "[...]", "environment_setup_commit": "298ccb478e6bf092953bca67a3d29dc6c35f6752", "difficulty": "15 min - 1 hour"}
```

### Linking

- Everything joins on `instance_id` (for example `django__django-16527`), which is the SWE-bench Verified `instance_id`.
- Agent identity comes from the run directory (or the `tool` column in `RQ34.csv` and the `<Tool>` in RQ file names).
- Agent patch: `all_preds.jsonl` `model_patch`. Gold patch: SWE-bench `patch`. Issue text: SWE-bench `problem_statement`. Base commit: SWE-bench `base_commit`.

## Mapping to Remit PR-level labels

One corpus A item is either a gold item (`gold:<instance_id>`) or an agent item (`<Tool>:<instance_id>`), with issue = `problem_statement`, diff = the patch, repo at `base_commit`. The benchmark `test_patch` is never included. Each label below carries a `label_source` and a `strength` so reports can slice by them.

| Case | Remit label | Strength | Count |
| --- | --- | --- | --- |
| Gold patch, one per SWE-bench Verified instance | `clean` | strong (by construction) | `500` |
| `RQ34.csv` `correctness` starts with `incorrect_` | `problem` | strong (manual) | `22` |
| `RQ34.csv` `correctness` starts with `correct_` | `clean` | strong (manual) | `4` |
| `RQ34.csv` `correctness = uncertain` | `problem` (per spec: behaviorally divergent) | weak | `51` |
| RQ1 `difference = functionality`, not in `RQ34.csv` | `problem` (fails developer tests that gold passes) | medium | `57` |
| RQ2 divergent, not in `RQ34.csv` and not RQ1 `functionality` | `problem` (automated divergence) | weak | computed by loader |
| RQ2 key, no differentiating test, no RQ1 entry | `clean` ("no divergence found") | weak | `429` |
| RQ1 `coding_conventions` only, not divergent | exclude | none | computed by loader |
| Resolved but absent from RQ1 and RQ2 | exclude (never tested by PatchDiff) | none | `145` |
| Not resolved | exclude (not plausible) | none | |

Across the three tools, RQ1 `functionality` or RQ2 divergent gives `283` distinct agent problem items (`79`, `100`, `104`).

Reverse-pass positives: `supplementary_more` (`13`) and `supplementary_change` (`8`) mean the agent patch changes more behavior than gold, which is the "does more than asked" signal. The study does not name the extra units; the loader can find candidates by diffing agent and gold at function level, but these unit labels would be Remit's own (`annotated_by: claude-code`). `absent` (`4`) maps to forward-side missing or partial.

### Ambiguities

- **"Plausible patches judged correct" barely exists.** Only `4` patches were manually judged correct. The large clean agent pool (`429`) is "PatchDiff found no difference", which is absence of evidence, not a correctness judgment. Report it separately from strong labels.
- **`uncertain` as problem.** The spec counts behaviorally divergent patches as positives, but the authors themselves could not decide `51` of `77`. Many are defensible implementation choices the issue does not pin down. Treating them as `problem` will inflate apparent false negatives. Report them as their own slice.
- **`correct_irrelevant` and `correct_invaliddt`** are clean for the agent patch, but `correct_irrelevant` also says the gold patch has changes unrelated to the issue, so the gold item for that instance may deserve a reverse-side finding. Keep the gold label `clean` but flag it.
- **`coding_conventions`** failures are real test failures but not issue-related; excluding them is a choice, record it in DECISIONS.md.
- **RQ2 is LLM-generated tests.** The paper filters flaky tests, and the totals here match the paper, but two table 8 cases show a generated test can be invalid.
- **Split leakage.** BUILD_PROMPT 11.2 splits by item ID hash. Gold and up to three agent patches share an issue, so hash on `instance_id` to keep them in the same split (the same idea as seeds and their mutations). Record this in DECISIONS.md.
- **Agent-added test files** are in many agent diffs; they affect Remit's test-integrity checks and should stay, but note them in reports.

## Licenses

- **PatchDiff repo:** no license file; GitHub reports none. Default copyright applies. Treat the code as reference only; do not vendor it.
- **Zenodo record:** CC-BY-4.0 on every version. Redistribution with attribution is allowed; cite the paper and the DOI.
- **SWE-bench Verified:** the Hugging Face card declares no license. The SWE-bench GitHub repo (harness) is MIT. The underlying issues and patches come from the upstream projects (django, sympy, astropy and others) under their own open source licenses. Not verified: an explicit license for the Verified dataset itself.
- **Agent patches:** originate from the SWE-bench experiments repo; its license could not be verified (GitHub API returns none). Zenodo republishes them under CC-BY-4.0.
- **Practical rule:** keep the raw files out of git (fetch them with a script and pin hashes), which avoids redistribution questions.

## Download sizes and per-item fetching

- **SWE-bench Verified:** one parquet file, `data/test-00000-of-00001.parquet`, `2096679` bytes. Per-row fetch works via `https://datasets-server.huggingface.co/rows?dataset=princeton-nlp/SWE-bench_Verified&config=default&split=test&offset=<n>&length=<k>`; the `filter` endpoint by `instance_id` returned "index is loading" when tried, so do not rely on it.
- **Agent patches and resolved lists:** per-tool files from GitHub raw (`raw.githubusercontent.com/ZJU-CTAG/PatchDiff/<sha>/data/tool_results/...`), `37.9` MB total for the three `all_preds.jsonl` plus `30` KB of `results.json`. No per-instance files exist; fetch per tool and slice.
- **Labels:** from the Zenodo zip. Whole zip is `59.6` MB, but single entries can be pulled with HTTP range requests: read the central directory from the last `~500` KB, then fetch each entry's local header plus compressed bytes and inflate (method `8`, raw deflate). Everything corpus A needs is about `26` MB compressed (`RQ34.csv` and RQ1 files under `11` KB; the three RQ2 files are the bulk) and about `315` MB inflated. The fetch script should reduce RQ2 to a small derived file (see below) and not keep the raw RQ2 JSON.
- The fetch script must go through `providers` (rule 7) with a recorded cassette or a checked-in hash manifest so unit tests stay offline.

## Loader format

Proposed layout. `raw/` is written by a fetch script (`pnpm eval:fetch-corpus-a` or similar) and is gitignored; `SOURCES.json` is committed.

```
eval/corpora/swebench/
  SOURCES.json                          # pinned URLs, revisions, sha256 per raw file
  raw/
    swebench_verified.jsonl             # HF parquet converted to JSONL, one row per instance
    patchdiff/
      tool_results/<run-dir>/all_preds.jsonl
      tool_results/<run-dir>/results.json
      results/RQ34.csv
      results/RQ1_<Tool>_runall.json
      derived/RQ2_<Tool>_divergent.json # reduced from RQ2_<Tool>_difftests.json
  dev/  test/                           # built items, split by hash of instance_id
```

The loader reads only `raw/`, never the network. It reads the Hugging Face JSONL rather than parquet so no parquet dependency is needed in Node.

### `SOURCES.json`

```json
{
  "swebench_verified": {"url": "hf://datasets/princeton-nlp/SWE-bench_Verified@c104f840cc67f8b6eec6f759ebc8b2693d585d4a/data/test-00000-of-00001.parquet", "sha256": "a45b1fe4e2f0c8390b2b2938ac83e92ed5979000856808f3679c07812e9e6dcd", "license": "unspecified"},
  "patchdiff_zip": {"url": "https://zenodo.org/api/records/18258368/files/PatchDiff_0115_1.zip/content", "bytes": 59563518, "license": "CC-BY-4.0", "entries": {"PatchDiff/results/RQ34.csv": "44ac55898d4a9212ba0d3a980d1cb6401c59c562bfc1aee40aa8dadfcd623289"}}
}
```

(The parquet `sha256` above is the LFS object id reported by Hugging Face; the zip entry hash is from my fetch. Fill the rest when the script runs.)

### `raw/swebench_verified.jsonl` (made-up rows, real schema)

```json
{"repo": "acme/widgets", "instance_id": "acme__widgets-101", "base_commit": "1111111111111111111111111111111111111111", "patch": "diff --git a/widgets/core.py b/widgets/core.py\n--- a/widgets/core.py\n+++ b/widgets/core.py\n@@ -10,7 +10,7 @@\n-    return x\n+    return x or 0\n", "test_patch": "diff --git a/tests/test_core.py b/tests/test_core.py\n...", "problem_statement": "size() returns None for empty widgets\nIt should return 0.", "hints_text": "", "created_at": "2023-01-02T03:04:05Z", "version": "1.2", "FAIL_TO_PASS": "[\"tests/test_core.py::test_empty_size\"]", "PASS_TO_PASS": "[\"tests/test_core.py::test_size\"]", "environment_setup_commit": "2222222222222222222222222222222222222222", "difficulty": "<15 min fix"}
{"repo": "acme/widgets", "instance_id": "acme__widgets-202", "base_commit": "3333333333333333333333333333333333333333", "patch": "diff --git a/widgets/io.py b/widgets/io.py\n...", "test_patch": "diff --git a/tests/test_io.py b/tests/test_io.py\n...", "problem_statement": "load() crashes on a trailing newline", "hints_text": "Probably strip() the input.", "created_at": "2023-02-03T04:05:06Z", "version": "1.3", "FAIL_TO_PASS": "[\"tests/test_io.py::test_trailing_newline\"]", "PASS_TO_PASS": "[]", "environment_setup_commit": "4444444444444444444444444444444444444444", "difficulty": "15 min - 1 hour"}
```

### `raw/patchdiff/tool_results/<run-dir>/all_preds.jsonl`

```json
{"instance_id": "acme__widgets-101", "model_name_or_path": "example-agent-v1", "model_patch": "diff --git a/widgets/core.py b/widgets/core.py\n--- a/widgets/core.py\n+++ b/widgets/core.py\n@@ -10,7 +10,7 @@\n-    return x\n+    return 0 if x is None else x\n"}
{"instance_id": "acme__widgets-202", "model_name_or_patch": "example-agent-v1", "model_patch": ""}
```

(The second row shows the real key typo and an empty patch, both of which the loader must tolerate.)

### `raw/patchdiff/tool_results/<run-dir>/results.json`

```json
{"no_generation": ["acme__widgets-202"], "no_logs": [], "resolved": ["acme__widgets-101", "acme__widgets-303"]}
```

### `raw/patchdiff/results/RQ34.csv`

```
tool,instance_id,diff_pattern,correctness
OpenHands,acme__widgets-101,supplementary_more,incorrect_regression
CodeStory,acme__widgets-303,divergent,uncertain
```

### `raw/patchdiff/results/RQ1_<Tool>_runall.json`

```json
{"acme__widgets-101": {"oracle_pass_model_fail": ["tests/test_core.py::test_negative_size (tests.test_core.SizeTests)"], "difference": "functionality"},
 "acme__widgets-303": {"oracle_pass_model_fail": ["tests/test_code_quality.py::test_files"], "difference": "coding_conventions"}}
```

### `raw/patchdiff/derived/RQ2_<Tool>_divergent.json`

Derived by the fetch script: every key of `RQ2_<Tool>_difftests.json`, with the union of its non-empty differentiating test ids (an empty list means "tested, no divergence found"). The source zip entry name and its `sha256` go in `SOURCES.json`.

```json
{"acme__widgets-101": ["tests/acme__widgets_101_1738866941_5387232.py::test_size_with_patch2"],
 "acme__widgets-303": []}
```

### Item ids and labels the loader emits

- `gold:<instance_id>` and `<Tool>:<instance_id>`, with `label` in `problem | clean`, plus `label_source` (`gold`, `rq34_manual`, `rq1_devtests`, `rq2_divergent`, `rq2_no_divergence`), `strength` (`strong | medium | weak`), `diff_pattern` and `correctness` when present, and `tool` and `model_name_or_path` for agent items.
- Split: stable hash of `instance_id`, `70 / 30`.
- The loader test should assert the real totals: `877` resolved, `260` divergent (`72 / 91 / 97`), `68` RQ1 `functionality`, `77` RQ34 rows (`22` incorrect, `4` correct, `51` uncertain).
