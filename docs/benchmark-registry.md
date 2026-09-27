# Benchmark registry for Remit

Compiled `2026-09-27` from primary sources (arXiv abstracts and HTML full text, official GitHub repos, Hugging Face dataset cards and APIs, the SWE-bench leaderboard source file). Anything not confirmed from a primary source is marked UNVERIFIED. Numbers are copied, never estimated.

Remit's task, for reference: given an issue and a PR diff, decide per requirement `done`, `partial`, `missing` or `contradicted`; judge whether tests assert the issue's behaviour; flag unexplained behaviour changes. Remit is a reviewer. It does not write patches.

How to read the "fit" column:

- **high**: the benchmark's inputs are (issue or spec, code change) and its labels judge whether the change does what the spec asked, or does more.
- **partial**: shares inputs or one sub-question (for example defect finding in a PR, or patch correctness) but not the requirement-level judgment.
- **none**: measures something Remit does not do (for example producing patches), usable only indirectly.

## Summary table

| Benchmark | Category | Fit | Usable as | Licence (data) |
| --- | --- | --- | --- | --- |
| PAIChecker labelled data (SWE-bench Verified, SWE-Gym, SWE-bench Multilingual) | issue-PR alignment | high | dev and test (human labels), not train for test items | MIT (repo) |
| PatchDiff study labels (corpus A source) | patch correctness on SWE-bench Verified | partial to high | dev and test (already corpus A) | CC-BY-4.0 (Zenodo) |
| SWE-Shield (design constraint compliance) | spec compliance of agent patches | partial to high | test only if released; data release UNVERIFIED | UNVERIFIED |
| SWR-Bench | PR review, defect finding | partial | test | CC BY 4.0 per paper; repo UNVERIFIED |
| c-CRAB | review agent evaluation via executable tests | partial | test | none declared on GitHub |
| CodeFuse-CR-Bench / SWE-CARE | PR review with linked issue | partial | test (SWE-CARE also has training data) | Apache-2.0 (SWE-CARE HF card and repo) |
| Sphinx | PR review, checklist coverage | partial | test once released | data not released at time of check |
| MCR-Bench | multi-round code review | partial | test | UNVERIFIED |
| Martian Code Review Bench | PR review comments, offline and online | partial | test | MIT (repo, per its post) |
| CodeReviewer | review activities on diff hunks | partial (quality estimation only) | train, dev, test | UNVERIFIED (Zenodo record 6900648); code MIT |
| UTBoost | test adequacy on SWE-bench | partial | label cleaning, dev | MIT (repo) |
| SWE-ABS | test strengthening on SWE-bench Verified and Pro | partial | label cleaning, dev | MIT (repo) |
| SWE-Bench+ | solution leakage and weak tests | partial | label cleaning, contamination slicing | UNVERIFIED |
| APR patch correctness (Wang et al. ASE 2020; Quatrain) | patch correctness, bug report vs patch | partial | train, dev | UNVERIFIED |
| SWE-bench, Verified, Lite, Multilingual, Multimodal, Pro, Multi-SWE-bench | patch-producing agents | none (direct) | only as a source of issues and patches, or for a reranking add-on | varies, see below |
| SWE-bench BM25 retrieval, Loc-Bench, SweRank | retrieval and localization | partial (Remit's retrieval stage) | dev and test for retrieval only | Apache-2.0 (LocAgent repo); others see below |
| Issue-commit link recovery (EALink, EasyLink benchmark) | traceability | partial | dev | UNVERIFIED |
| Calibration practice (ECE, Brier, AURC, risk-coverage) | metrics, not datasets | n/a | apply on every corpus | n/a |

## What Remit already uses: corpus A

Sources read: `docs/eval.md`, `docs/eval-corpus-a.md`, `eval/corpora/swebench/SOURCES.json`, `packages/eval/src/corpora/swebench.ts`.

- **Inputs.** Issue = SWE-bench Verified `problem_statement` (first line as title). Diff = either the gold `patch` (item `gold:<instance_id>`) or a resolved agent patch from one of three Claude 3.5 Sonnet based agents (OpenHands CodeAct 2.1, CodeStory Midwit, LearnByInteract), taken from the PatchDiff replication package (item `<Tool>:<instance_id>`). The benchmark `test_patch` is never shown. Agent-added test files stay in the diff.
- **Sources.** SWE-bench Verified via the Hugging Face datasets-server rows API (licence recorded as "unspecified (upstream project licenses; harness MIT)"). PatchDiff labels from Zenodo record `18258368` (DOI `10.5281/zenodo.18258368`, CC-BY-4.0). Every raw file is pinned by `sha256` in `SOURCES.json`, fetched `2026-09-26`.
- **Label granularity.** PR level only: `problem` or `clean`, each with a `label_source` and `strength`. `labels.requirements` is empty. There are no requirement-level, test-integrity or unit-level labels in corpus A.
- **Label rules** (first match wins, from `labelAgentPatch`):

| Case | PR label | Source | Strength |
| --- | --- | --- | --- |
| Gold patch | `clean` | `gold` | strong |
| `RQ34.csv` `incorrect_*` (manual) | `problem` | `rq34_manual` | strong |
| `RQ34.csv` `correct_*` (manual) | `clean` | `rq34_manual` | strong |
| `RQ34.csv` `uncertain` | `problem` | `rq34_manual` | weak |
| RQ1 `functionality` (fails developer tests gold passes) | `problem` | `rq1_devtests` | medium |
| RQ2 has a differentiating test | `problem` | `rq2_divergent` | weak |
| RQ1 `coding_conventions` only | excluded | | |
| RQ2 tested, no differentiating test | `clean` | `rq2_no_divergence` | weak |
| Untested, unresolved, empty or over `200 KB` | excluded | | |

- **Counts** (from `docs/eval.md`, fetch of `2026-09-26`): `500` gold; `277` problem; `926` clean (`500` gold, `422` no divergence, `4` manually correct); `174` excluded. Raw data reproduces the paper: `877` plausible patches, `260` divergent, `68` RQ1 functionality failures, `77` manual labels (`22` incorrect, `4` correct, `51` uncertain).
- **What the labels mean.** `problem` means "this plausible patch passes SWE-bench's tests but fails more developer tests than gold, or behaves differently from gold under an LLM-generated differential test, or was judged incorrect by the study's authors". `clean` means "gold patch", "judged correct by the authors" (`4` items), or "PatchDiff found no behavioural difference" (absence of evidence).
- **Is this an official metric?** No. SWE-bench's official metric is `% resolved` (FAIL_TO_PASS and PASS_TO_PASS tests pass). All agent patches in corpus A are, by construction, *resolved* under that metric. The PatchDiff labels are research findings from one study (Wang, Pradel, Liu, ICSE 2026, arXiv `2503.15223`), not a benchmark with an official metric or leaderboard. Remit's corpus A metric (AUROC of problem vs clean, plus slices) is Remit's own.
- **Known issues with corpus A found in this research.**
  - **Gold is not always clean.** PAIChecker's human labels (below) mark `68` of the `500` SWE-bench Verified gold PRs as misaligned with their issue (`22` with a scope-creep label, `30` with a defective-PR label, counted from `labelled_data/swe-bench-analysis.csv`). Corpus A labels every gold patch `clean` with strength `strong`. For scope-creep instances, a correct Remit reverse-pass finding would currently be scored as a false alarm.
  - **`uncertain` counted as problem** inflates positives with cases the study's authors could not decide.
  - **Clean agent pool is weak.** Only `4` agent patches were judged correct by humans.
  - **Single, mostly bug-report requirements, Python only.**

## 1. Code review and defect verification

### SWR-Bench

- **Source:** arXiv `2509.01494` (v2 revised `2026-06-05`), FSE 2026, "SWR-Bench: Assessing LLM Performance in Real-World Code Review Comment Generation".
- **Licence:** CC BY 4.0 per the paper. Repository is anonymous in the paper; URL and repo licence UNVERIFIED.
- **Task:** given a full PR with project context, generate review comments. `1000` manually verified PRs from `12` Python projects drawn from SWE-bench: `500` Change-PRs (had defects later fixed) and `500` Clean-PRs.
- **Ground truth:** change-actions, each PR annotated by two of five annotators, Cohen's kappa reported as `66.08` (paper's notation); `11` change-action types split into functional and evolutionary.
- **Metric:** precision, recall and F1 over "hits" (a ground-truth change-action matched by at least one predicted one), judged by an LLM with about `90%` agreement with humans.
- **Baselines (paper):** best was PR-Review with Gemini-2.5-Pro, F1 `19.38%` (precision `16.65%`, recall `23.18%`); functional changes F1 `26.26%`; Multi-Review aggregation with Gemini-2.5-Flash at `n=10` reached F1 `21.91%`.
- **Fit to Remit: partial.** Has clean PRs (useful for false-alarm rate) and functional defects, but no requirement-level labels and the issue is not the reference; the task is free-form comment generation.
- **Use:** test only (small; labels are the evaluation). Remit output would need mapping to comments.
- **Contamination:** repos overlap SWE-bench; PRs and fixes are public on GitHub. Paper does not state a date cutoff (per HTML full text).

### c-CRAB (Code Review Agent Benchmark)

- **Source:** arXiv `2603.23448` (v2 `2026-04-07`), Zhang, Pan, Yusuf, Ruan, Shariffdeen, Roychoudhury. Data: `github.com/c-CRAB-Benchmark/dataset`.
- **Licence:** paper states CC BY 4.0; the GitHub repo declares no licence (GitHub API).
- **Task:** `184` PR instances, `234` executable tests, `67` repos, derived from SWE-CARE. Human review comments are turned into tests that fail on the original patch and pass once the reviewed issue is fixed. A coding agent revises the PR using the tool's review; the metric is the share of tests that then pass.
- **Baselines (paper):** Claude Code `32.1%`, Devin `24.8%`, PR-Agent `23.1%`, Codex `20.1%`, union of all tools `41.5%`.
- **Fit: partial.** Measures whether a review surfaces what humans flagged, via a downstream fixer. Remit could be scored only by feeding its findings to a fixing agent, which confounds Remit with the fixer.
- **Use:** test only.
- **Contamination:** public PRs; SWE-CARE collection dates UNVERIFIED.

### CodeFuse-CR-Bench and SWE-CARE

- **Source:** arXiv `2509.14856` (`2025-09-18`), Guo et al. (Ant Group and others). Data repo `github.com/inclusionAI/SWE-CARE` (Apache-2.0) and HF `inclusionAI/SWE-CARE` (card licence `apache-2.0`). The paper's own GitHub and HF links are placeholders ("xxx") in v1.
- **Task:** end-to-end review of `601` instances from `70` Python projects; merged PRs linked to closing issues, with PR, issue, commit history and repository context; `9` problem domains (bug fix, feature, refactor, docs, tests and CI, performance, security, dependencies, style).
- **Metrics:** rule-based (location similarity, BLEU-4, defect-match precision, recall, F1) and model-based (a reward model and LLM-as-judge across quality dimensions).
- **Baselines (paper):** Gemini 2.5 Pro highest comprehensive score `52.37%`; the reward model reached `80.64%` F1.
- **Fit: partial.** Instances include the linked issue, so issue-aware review is possible, but the ground truth is human review comments, not requirement satisfaction.
- **Use:** SWE-CARE has more data (possible training source; size UNVERIFIED); CodeFuse-CR-Bench as test.
- **Contamination:** public GitHub history.

### Sphinx

- **Source:** arXiv `2601.04252` (`2026-01-06`), Zhang et al.
- **Task and metric:** PR review generation scored by checklist coverage, completeness and precision; also a training method (CRPO).
- **Baselines:** "up to 40%" checklist coverage improvement over baselines (abstract). Absolute numbers not extracted.
- **Data:** release pending at time of check. Licence UNVERIFIED.
- **Fit: partial.** **Use:** none until released.

### MCR-Bench

- **Source:** arXiv `2608.27442` (`2026-08-27`), ISSTA 2026. `2,269` multi-round review tasks, five languages, defect metadata and state labels.
- **Data URL and licence:** UNVERIFIED. Metrics and numbers not extracted beyond "limited overall performance in defect detection".
- **Fit: partial** (defect detection across review rounds). **Use:** test, pending access.

### Martian Code Review Bench (v0)

- **Source:** vendor post `withmartian.com/post/code-review-bench-v0`, repo `github.com/withmartian/code-review-benchmark` (MIT per the post; repo licence not independently checked).
- **Task:** offline gold set of known issues in PRs (built on datasets from Augment and Greptile) plus online signals from developer actions; `200,000+` PRs with monthly refresh.
- **Metric:** precision, recall, F1. Post states no tool exceeded `63%` recall on known issues.
- **Fit: partial.** Vendor-run, not peer reviewed. **Use:** test for defect-finding only.

### CodeReviewer

- **Source:** arXiv `2203.09095`, ESEC/FSE 2022, Li et al. Code `github.com/microsoft/CodeBERT/tree/master/CodeReviewer` (repo MIT). Data on Zenodo record `6900648` (licence UNVERIFIED).
- **Tasks:** quality estimation (does this diff hunk need a comment), comment generation, code refinement. Nine languages.
- **Sizes and results** (from the paper as summarised on the Hugging Face paper page; not cross-checked against the PDF tables): quality estimation about `266k` / `31k` / `31k`, precision `78.60`, recall `65.63`, F1 `71.53`, accuracy `73.89`; comment generation BLEU-4 `5.32`; refinement BLEU `82.61`, exact match `30.32`.
- **Fit: partial.** Hunk-level, no issue or requirement. Quality estimation is loosely related to "is this change suspicious".
- **Use:** possible pre-training or auxiliary data; not a meaningful test of Remit's claim.
- **Contamination:** widely used since 2022; very likely in LLM training data.

### Patch correctness and SWE-bench label-quality studies

These are not benchmarks with leaderboards; they supply labels on whether a test-passing patch is really correct.

- **PatchDiff** (arXiv `2503.15223`, ICSE 2026, Wang, Pradel, Liu). `7.8%` of plausible patches fail the full developer test suite; `29.6%` behave differently from gold; of divergent patches inspected, `28.6%` are certainly incorrect; resolution rates inflated by about `6.2` points. Supplementary behaviour changes account for `27.3%` of divergences. Already corpus A. Fit partial to high (patch correctness against an issue, with some "does more than asked" labels, but no requirement labels).
- **UTBoost** (arXiv `2506.09289`, ACL 2025; repo MIT). `36` instances with insufficient tests; `345` erroneous patches labelled passed in the original SWE-bench; ranking changes `40.9%` on Lite and `24.4%` on Verified. Fit partial: extra "resolved but wrong" labels for label cleaning.
- **SWE-ABS** (arXiv `2603.00520`, ICML 2026; repo `github.com/OpenAgentEval/SWE-ABS`, MIT). Strengthened tests for SWE-bench Verified and Pro; README cites `312` strengthened instances and `847` killed patches. Fit partial: more patch-correctness labels. Exact dataset access and licence of the HF datasets UNVERIFIED.
- **SWE-Bench+** (arXiv `2410.06992`). Of SWE-Agent + GPT-4 passes: `32.67%` solution leakage, `31.08%` weak tests; resolution drops from `12.47%` to `3.97%` after filtering; over `94%` of issues predate LLM cutoffs. Fit partial: contamination and leakage slicing for corpus A.
- **Agentless SWE-bench Lite-S** (arXiv `2407.01489`). Manual classification of Lite problems for exact-patch leakage and misleading descriptions; subset excludes them. Counts not extracted (UNVERIFIED).
- **APR patch correctness assessment.** Wang et al., "Automated Patch Correctness Assessment: How Far are We?", ASE 2020: `902` patches from `21` APR tools (Java, Defects4J era); best single technique detects at most `53.5%` of overfitting patches. Quatrain (arXiv `2208.04125`, Tian et al.): treats correctness as "does the patch answer the bug report", `9,135` patches, AUC `0.886`. Fit partial: bug-report-to-patch alignment, Java, method-level, old and contaminated. Licences UNVERIFIED.

## 2. Requirement alignment and issue-PR consistency

### PAIChecker labelled data (highest fit found)

- **Source:** arXiv `2607.28587` (v1 `2026-07-30`, v2 `2026-08-04`), ASE 2026, Manyi Wang, Junjielong Xu, Pinjia He. Repo `github.com/manyi-w/PAIChecker` (redirect from `manyiResearch/PAIChecker`), MIT, `labelled_data/` folder.
- **Task:** decide whether a PR and its linked issue are misaligned, and classify how. Taxonomy (repo README):
  - `SC` PR scope creep: the PR delivers functionality beyond what the issue requests.
  - `DP` defective PR: the PR introduces a bug or is an incomplete fix needing later correction.
  - `FP` follow-up PR: supplements or corrects an earlier PR for the same issue.
  - `IS` incomplete specification: the issue is revised in later discussion and the PR implements the later requirements.
  - `UL` unspecified literal: the PR adds a fixed literal that tests assert exactly but the issue never specifies.
  - `Others`, and `No Misalignment`.
- **Labels:** manual, two annotators, Cohen's kappa `0.91` (binary) and `0.86` (fine-grained), third author adjudicated (paper HTML).
- **Data** (counted from the CSVs on `2026-09-27`):
  - `swe-bench-analysis.csv`: `500` SWE-bench Verified instances (plus `3` blank rows), `432` no misalignment, `68` misaligned (`13.6%`). Pattern mentions: SC `22`, DP `30`, IS `18`, FP `3`, UL `1` (multi-label rows count once per pattern). Also carries per-agent resolved flags for many leaderboard runs.
  - `swe_bench_multilingual.csv`: `300` instances, `227` no misalignment.
  - `swe_gym_all.csv`: `2,287` rows, `1,275` no misalignment (paper reports `2,438` instances and `44.3%` misaligned; the CSV row count differs, reason UNVERIFIED).
  - Small discrepancy: the paper's table gives SC-1 `12` on Verified; the CSV has `11` plain SC-1 plus combined labels.
- **Metric and baselines (paper):** binary accuracy, exact match and macro F1. PAIChecker best: SWE-Gym `92.12%` binary accuracy (Gemini-3.1-Pro, exact match `84.66%`, macro F1 `79.21%`); SWE-bench Multilingual `91.67%` binary accuracy.
- **Fit to Remit: high.** Same inputs (issue, PR). `SC` is exactly Remit's reverse pass ("did more than asked"). `DP` and `IS` map to forward-side `partial` or `missing` relative to the issue as written. `UL` relates to "tests assert behaviour the issue does not specify". Labels are per PR, not per requirement.
- **Use:** dev and test for PR-level alignment. The Multilingual set gives non-Python coverage. SWE-Gym labels could train or calibrate, but SWE-Gym is not disjoint in repositories from SWE-bench, so keep repository-level separation. The Verified labels also directly correct corpus A's "gold is clean" assumption.
- **Contamination:** issues and PRs are public and old (most predate model cutoffs); the labels were published `2026-08`, after most current model cutoffs but possibly not future ones. PAIChecker ships Claude Code and Codex skills, which a model could have seen.

### SWE-Shield (design constraint compliance)

- **Source:** arXiv `2604.05955` (`2026-04-07`), Yu et al., "Does Pass Rate Tell the Whole Story? Evaluating Design Constraint Compliance in LLM-based Issue Resolution".
- **Task:** for agent patches, check compliance with design constraints mined from PR review threads and linked to issues. `495` issues, `1,787` validated constraints, `6` repos (Verified variant: Django, SymPy; Pro variant: Ansible, Teleport, Flipt, OpenLibrary).
- **Labels:** constraint-issue associations checked by two annotators (kappa `0.78`); compliance judged by three LLMs with majority vote; human-LLM agreement `80.8%` (kappa `0.79`) on `318` patches.
- **Baselines (paper):** Live-SWE-agent (Gemini-3.0) on Verified: pass rate `76.95%`, design satisfaction `42.80%`; Lingxi-v1.5 (Kimi-K2): `70.25%` and `32.64%`; SWE-agent (Claude-Sonnet-4.5) on Pro: `42.69%` and `50.20%`. Association between passing tests and design satisfaction Cramér's V at most `0.11`.
- **Fit: partial to high.** Checklist-style judgment of a patch against natural-language constraints, close to Remit's per-requirement verdicts, but the constraints are implicit project conventions, not the issue's requirements, and the labels are LLM-produced.
- **Use:** test, if the replication package is public. Data URL and licence UNVERIFIED.

### Issue-commit link recovery

- EALink (arXiv `2308.10759`, ASE 2023; six Apache projects) and EasyLink with a larger benchmark (arXiv `2507.09199`: `9,319` issues, `20` projects, about `1,530` false links per issue; Precision@1 `75.03%`).
- **Fit: partial.** Decides whether a commit belongs to an issue, a coarse version of alignment. No requirement or correctness labels. Licences UNVERIFIED. Could supply hard negatives (unrelated diffs for an issue).

### Not found

No public benchmark was found that labels **each requirement** of an issue as done, partial, missing or contradicted against a PR, or that labels whether the PR's tests assert the issue's behaviour. Ticket compliance features in commercial reviewers (for example PR-Agent) have no published benchmark that could be verified. Remit's corpus B (synthetic mutations) and golden set remain the only requirement-level labels.

## 3. Coding-agent issue resolution benchmarks

These evaluate **patch-producing agents**. The official metric is `% resolved`: a generated patch is applied in Docker and the instance counts as resolved when all FAIL_TO_PASS and PASS_TO_PASS tests pass (SWE-bench paper, arXiv `2310.06770`, ICLR 2024). A reviewer like Remit has no score on these benchmarks. It can only be evaluated as an add-on:

- **Reranking or filtering:** given `k` candidate patches per instance, pick one (or abstain). Report resolved rate of the selected patch versus a baseline selector (random, majority, first) and versus oracle pass@k, with the same candidate pool. Published precedents use verifiers: R2E-Gym (arXiv `2504.07164`) reports `34.4%` pass@1 rising to `51%` with a hybrid verifier on Verified; SWE-Gym (arXiv `2412.21139`, ICML 2025) reports `32.0%` on Verified and `26.0%` on Lite with fine-tuned agents plus verifiers.
- **Precision of rejection:** among patches Remit rejects, the share that are not resolved (or are resolved but wrong per PatchDiff, UTBoost or SWE-ABS).
- A resolved-rate gain from reranking is a claim about the combined system on that candidate pool, not about Remit alone, and not a leaderboard entry.

| Benchmark | Source | Size | Data licence | Notes |
| --- | --- | --- | --- | --- |
| SWE-bench (full) | arXiv `2310.06770`, HF `princeton-nlp/SWE-bench` | `2,294` issue-PR pairs, `12` Python repos | HF card declares none; harness `SWE-bench/SWE-bench` MIT | original paper best: Claude 2 `1.96%` |
| SWE-bench Verified | OpenAI post "Introducing SWE-bench Verified" (direct fetch returned 403; facts from its indexed text), HF `princeton-nlp/SWE-bench_Verified` | `500` | HF card declares none | annotated for well-specified issue (0 to 3) and valid tests; `38.3%` of screened samples underspecified, `61.1%` with unfair tests (from the post's indexed text; UNVERIFIED by direct fetch) |
| SWE-bench Lite | `swebench.com/lite.html` | `300` test, `23` dev | HF card declares none | single-file gold patches, at most `3` hunks, problem statement at least `40` words |
| SWE-bench Multilingual | `swebench.com/multilingual.html`, HF `SWE-bench/SWE-bench_Multilingual` | `300`, `42` repos, `9` languages | MIT (HF card) | |
| Multi-SWE-bench | arXiv `2504.02605`, repo Apache-2.0, HF `ByteDance-Seed/Multi-SWE-bench` | `1,632` instances, `7` languages, `68` annotators | HF card `other` | plus `4,723` RL instances |
| SWE-bench Pro | arXiv `2509.16941`, repo `scaleapi/SWE-bench_Pro-os` MIT | `1,865` (public `11` repos, held-out `12`, commercial `18`) | HF card declares none | contamination-resistant design; numbers not extracted |

**Leaderboard snapshot** (from `SWE-bench/swe-bench.github.io` `data/leaderboards.json`, fetched `2026-09-27`; `checked` is the site's verification flag):

- Verified: `79.2` Sonar Foundation Agent + Claude 4.5 Opus (`2025-12-05`, not checked); `79.2` live-SWE-agent + Claude 4.5 Opus (`2025-12-15`, not checked); `78.8` TRAE + Doubao-Seed-Code (`2025-09-28`, not checked, multiple attempts).
- Lite: `60.33` ExpeRepair-v1.0 + Claude 4 Sonnet (`2025-06-25`, not checked); top checked entry seen `56.67` SWE-agent + Claude 4 Sonnet.
- Multilingual (mini-SWE-agent, one attempt, checked): `72.7` Gemini 3 Flash, `72.0` Claude 4.6 Opus.
- SWE-bench Pro public leaderboard numbers: UNVERIFIED (not fetched).

**Fit: none directly.** They are useful to Remit as (a) a source of issues, gold PRs and many agent patches with resolved flags (the PAIChecker CSV bundles resolved flags for over a hundred runs), and (b) a reranking add-on evaluation.

**Contamination:** SWE-Bench+ reports over `94%` of SWE-bench issues predate LLM cutoffs; gold patches are on GitHub; leaderboard patches are public in `SWE-bench/experiments` (no licence declared on GitHub). Any model Remit uses may have memorised gold patches, which can bias it toward calling gold-like patches correct.

## 4. Retrieval and localization for code

Relevant to Remit's retrieval stage (finding the code a requirement touches), not its verdicts.

- **SWE-bench BM25 recall** (arXiv `2310.06770`, Table 3, recall against files edited by the gold patch):

| BM25 recall | 13k | 27k | 50k |
| --- | --- | --- | --- |
| Avg. | `29.58` | `44.41` | `51.06` |
| All | `26.09` | `39.83` | `45.90` |
| Any | `34.77` | `51.27` | `58.38` |

  Retrieval corpora on HF (`princeton-nlp/SWE-bench_bm25_13K` and siblings) use Pyserini BM25; licence not declared on the card.
- **Loc-Bench** (LocAgent, arXiv `2503.09089`; repo `gersteinlab/LocAgent` Apache-2.0; HF `czlll/Loc-Bench_V1`, card licence not declared). `560` issues (`242` bug, `150` feature, `29` security, `139` performance), collected after October 2024 to limit contamination. Metric Acc@k: success only if all gold locations are in the top k, at file, module and function level. Reported: on SWE-bench Lite, fine-tuned Qwen2.5-32B LocAgent file Acc@5 `92.7%`, function Acc@10 `77.0%`; on Loc-Bench, Agentless (Claude-3.5) file Acc@5 `67.5%`, function Acc@10 `42.7%`.
- **SweRank** (arXiv `2505.07849`, ICLR 2026; repo licence NOASSERTION on GitHub; paper CC BY 4.0). Retrieve-and-rerank localization; evaluated on SWE-bench Lite and Loc-Bench with Acc@k; releases SweLoc training data. Numbers not extracted.
- **Fit: partial.** Remit's inputs include the diff, so "where is the change" is known; the useful measure is whether Remit retrieves the *context* needed (callers, tests). Gold-file recall and Acc@k on the diff-touched files are a reasonable proxy for Remit's retrieval of related code. **Use:** dev and test for retrieval components only.

## 5. Calibration and selective prediction practice

These are metrics and protocols, not datasets.

- **ECE and reliability diagrams; temperature scaling:** Guo et al., "On Calibration of Modern Neural Networks", ICML 2017, arXiv `1706.04599`.
- **Binned ECE is biased and underestimates error; scaling-binning calibrator and a debiased estimator:** Kumar, Liang, Ma, "Verified Uncertainty Calibration", NeurIPS 2019, arXiv `1909.10155`.
- **Choice of calibration measure (binning, class-conditional, norm) changes method rankings:** Nixon et al., "Measuring Calibration in Deep Learning", arXiv `1904.01685`.
- **Selective classification, risk-coverage trade-off with a guaranteed risk:** Geifman and El-Yaniv, arXiv `1705.08500` (NeurIPS 2017).
- **AURC and E-AURC:** commonly attributed to Geifman, Uziel, El-Yaniv, "Bias-Reduced Uncertainty Estimation for Deep Neural Classifiers", ICLR 2019, arXiv `1805.08206`. The abstract page does not mention them; the definition in the full text is UNVERIFIED here.
- **Calibration of code LLMs:** Spiess et al., "Calibration and Correctness of Language Models for Code", ICSE 2025, arXiv `2402.02047`: code models are poorly calibrated out of the box; Platt scaling helps but unevenly across tasks.
- **Brier score** (Brier 1950) and isotonic regression are standard; primary sources not fetched here.

**Recommended practice for Remit** (grounded in the sources above):

- Report ECE with the bin count and binning scheme stated, plus a debiased or adaptive variant and Brier score, since binned ECE alone can mislead (Kumar et al.; Nixon et al.).
- Report out-of-sample calibration only (Remit already uses 5-fold cross-validated isotonic ECE, per `docs/eval.md`).
- For abstention, report the risk-coverage curve and AURC over requirement verdicts, with the abstention rate, so "calibrated" is backed by selective-prediction evidence.
- Give confidence intervals (bootstrap) for every metric on small slices such as the `22` strong manual problems.

## Claims Remit can and cannot make

**Can claim, with the stated scope:**

- PR-level discrimination (AUROC, precision, recall, false-alarm rate) on corpus A against PatchDiff-derived labels, sliced by label source and strength, stating that these labels are one study's findings and not an official benchmark metric.
- PR-level issue-alignment accuracy against PAIChecker's human labels on SWE-bench Verified gold PRs and SWE-bench Multilingual, if that corpus is added, compared with PAIChecker's published `91.67%` binary accuracy on Multilingual (same data, same binary task) and its SWE-Gym numbers.
- Requirement-level metrics on corpus B and the golden set, stating they are synthetic or self-annotated (`annotated_by: claude-code`).
- Out-of-sample calibration and risk-coverage on those same corpora.
- A reranking gain on a stated SWE-bench candidate pool, as a system-level claim.

**Cannot claim:**

- Any SWE-bench, SWE-bench Verified, Lite, Multi-SWE-bench or Pro score, or leaderboard position. Remit does not produce patches.
- State of the art on code review benchmarks (SWR-Bench, CodeReviewer, CodeFuse-CR-Bench, c-CRAB, Martian) without running their official protocols.
- Requirement-level accuracy on real-world issues: no public requirement-level benchmark exists, and corpus A has no requirement labels.
- That gold SWE-bench patches are clean ground truth: PAIChecker marks `13.6%` of Verified gold PRs misaligned.
- That corpus A's `clean` agent items are correct: only `4` were judged correct by humans.
- Test-integrity accuracy on real data: no public benchmark labels whether a PR's tests assert the issue's behaviour (UTBoost and SWE-ABS judge benchmark tests, not PR-authored tests).
- Freedom from contamination on SWE-bench-derived data.
