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


### Dogfood run 5: M9 (`pnpm remit review --issue .agent/milestones/M9.md --diff m8-done..HEAD`), 2026-09-27

No keys: task-list extraction (9 requirements), no Jev verdicts; 175 units. Code facts:

| Finding | What Remit said | Right? | Action |
| --- | --- | --- | --- |
| ci.yml:24 | `ci_changed` | right, intended: audit, slow and docker jobs | none |
| chaos.test.ts:57 | `retry_or_timeout_added`: `timeoutMs` 50 | right, intended: the Jev timeout chaos case | none |
| chaos.test.ts:175 | `catch_broadened`: empty `.catch` | right, intended: polling while the database restarts | none |
| db/client.ts:52 | `catch_broadened`: empty `.catch` on the advisory unlock | right, intended: a dead connection already released the lock | comment added |
| db/client.ts:37, pglite-server.ts:16, main.ts:42 | `public_api_changed` | right: optional parameters and new members, backwards compatible | none |

## Eval runs

- 2026-09-26T17:22:28.991Z mutations/dev simulated (not a real measurement): 0/128 items correct, requirement F1 0.30, PR recall 0.85, false alarms 9.94, P0 precision 0.19, cost $0.0000. Report: eval/reports/2026-09-26T17-22-28-991Z (local only, superseded)
- 2026-09-26T17:40:19.484Z mutations/dev simulated (not a real measurement): 0/128 items correct, requirement F1 0.30, PR recall 0.85, false alarms 9.94, P0 precision 0.20, cost $0.0000. Report: eval/reports/2026-09-26T17-40-19-484Z (superseded by 2026-09-26T17-51-01-962Z)
- 2026-09-26T17:50:10.881Z mutations/dev simulated (not a real measurement): 0/128 items correct, requirement F1 0.30, PR recall 0.85, false alarms 9.94, P0 precision 0.20, cost $0.0000. Report: eval/reports/2026-09-26T17-50-10-881Z (local only, superseded)
- 2026-09-26T17:51:01.962Z mutations/dev simulated (not a real measurement): 0/128 items correct, requirement F1 0.30, PR recall 0.85, false alarms 9.94, P0 precision 0.20, cost $0.0000. Report: eval/reports/2026-09-26T17-51-01-962Z
- 2026-09-26T22:11:21.632Z golden/all live: 1/18 items correct, requirement F1 0.00, PR recall 0.22, false alarms 0.00, P0 precision 0.50, cost $0.0000. Report: eval/reports/2026-09-26T22-11-21-632Z
- 2026-09-26T22:17:32.055Z golden/all live: 1/18 items correct, requirement F1 0.33, PR recall 0.11, false alarms 0.11, P0 precision 1.00, cost $0.0000. Report: eval/reports/2026-09-26T22-17-32-055Z

## 2026-09-27 Live extraction through OpenRouter (not an experiment; first live data)

- Model `anthropic/claude-opus-5.5` via OpenRouter, the 12 M3 extraction fixtures, cost `$0.25`. Report: `eval/reports/extraction-live-openrouter.json`; cassettes in `fixtures/cassettes`.
- 9 of 12 match the expected ids exactly: amended, duplicates, image_only, injection, long_issue, non_english, prose, two_issues, vague. So injection resistance, quote anchoring and "no requirements" cases held live.
- 3 over-extract compared with the labels:
  - checklist: adds the user-need line ("Users need to export reports.") and splits the constraint from its non-goal ("no background job"). The non-goal split is arguably right.
  - examples: turns two worked examples into separate requirements. The labels treat examples as part of R1.
  - non_goals: the same quote appears as R1 and R2, which the duplicate check should have merged. It also adds the second non-goal as R4.
- Candidate experiments for M10 (dev only; wording changes bump the prompt version): tell extraction that examples illustrate a requirement rather than add one, and that a user-need statement is context, not a requirement. Merge identical quotes before validation.

## 2026-09-27 Laya as the Jev engine (golden, live)

- Setup: local `laya-typed-decisions` (snapshot 55cf4c4e) behind scripts/laya/server.py, window 4096; extraction through OpenRouter (Opus 5.5).
- Golden 1/18. Answers barely depend on the code:
  - coverage `1.9`-`2.4` of `3` for done and missing requirements alike (three_reqs_one_missing: R2 done `2.14`, R3 missing `2.15`);
  - conflict `0.55`-`0.64` for matching and contradicting code (misread_self_consistent `0.62`);
  - asserts_as_stated and asserts_differently both `0.6`-`0.7` on the same tests.
- The other checkpoints were no better on a hand probe (404 required, code returns 400): english coverage "fully" `0.90`, conflict `0.04`; multilingual conflict `0.38`.
- Conclusion: not usable as shipped. Calibration cannot fix answers without discrimination. A candidate for later: fine-tune on Remit dev labels (distilled from the LLM engine).

## 2026-09-27 LLM engine (jev.engine: llm), first live runs

- A single probe (404 required, 400 returned) through Sonnet 5 gave conflict `0.95` and coverage "partly" `0.90`: correct.
- Golden three_reqs_one_missing (single review): R2 done (`0.80`), R3 missing (`1.0`, P0), R1 uncertain. R1 is the extra user-need requirement from live extraction ("Add an export to the reports page."), a known over-extraction. Cost `$0.10`, 16 calls.
- The full golden run was invalid: the OpenRouter account ran out of credits mid-run (HTTP 402). Retries opened the circuit breaker, and most items got no answers. The 402 handling is fixed (D34). Needs credits to rerun (B9).

## 2026-09-27 remit-laya-v1 fine-tune (D35), epoch 0

- Data: OracleJev over the mutation dev split, 3,325 unique examples; val = held-out seeds rs-semver-compare and py-retry-backoff (never trained on). Lengths up to 4,096 tokens (p90 about 3,400).
- Training: top 6 encoder layers plus head, soft cross-entropy, bf16 on MPS, about 65 s per optimizer step (8 batches).
- Held-out val, as shipped then after epoch 0:
  - overall accuracy `0.436` to `0.751`, NLL `1.316` to `0.890`;
  - forward.conflict `0.055` to `0.940`, forward.coverage `0.674` to `0.878`;
  - tests.asserts_differently `0.050` to `0.943`, tests.test_evidence `0.446` to `0.906`.
- Weak: tests.asserts_as_stated `0.418` and reverse.serves `0.400`. Claims are too few to judge (n=8).
- Caveat: conflict and asserts_differently are mostly negative. The discrimination on contradicted items is measured by the mutation eval, not by this accuracy.

## 2026-09-27 remit-laya-v1 end-to-end evals (local engine, $0)

- Golden (scripted extraction): as shipped `1/18`, remit-laya-v1 `5/18`; requirement F1 `0.00` to `0.50`.
- Mutations dev (all 9 seeds, 7 trained on): as shipped `0/128` correct, F1 `0.02`, PR recall `0.13`; v1 `15/128`, F1 `0.06`, PR recall `0.28`, false alarms `0.78`.
- Held-out seeds only (rs-semver-compare, py-retry-backoff): v1 detected `1/21` targeted requirement defects; PR recall `0.26`.
- Verdict mix (v1): missing to done `31`, contradicted to done `19`. The model learned the majority answers.
- Diagnosis: class imbalance. Coverage targets are mostly Full, and conflict and asserts_differently mostly no (20 flips, 36 drops in all). The 82% question accuracy was largely the majority rate; per-question accuracy is the wrong selection metric.
- Next (v2): counterfactual negatives (each done forward/tests example gets a twin with the implementing or testing units removed, so coverage None and evidence none), class-balanced sampling, balanced accuracy per question.

## 2026-09-27 v2 stopped, ceiling check, mechanics check, paused for review

- **v2 stopped** at step 90 of 394 (2h12m), for two reasons. The first was two confirmed training-input shortcuts: distractor ids `D*`, and twins with one fewer candidate. The second was a flat loss (1.42 to 1.44 from step 50). The trainer has no resumable checkpointing, so about 2 hours were lost. The log and launch config are in `.laya/runs/v2-stopped`. Both shortcuts are fixed (6ba07f2) and verified in the export.
- **Eval infrastructure bug.** The per-review config cap ($0.50) was the run-wide tracker's limit, so it starved the first strategy-B run. Fixed (d677096). EVAL_MAX_USD is now the run cap, and incomplete reviews are reported.
- **Ceiling (strategy B, Sonnet 5 as the LLM engine), 7 held-out items:** target defects flagged 6/6, 4/7 fully correct, 0 false alarms on 1 clean item, $1.10 ($0.16 per review). The task is solvable from Remit's context; Laya's discrimination is the gap.
- **Strategy A (`single_pass`):** unmeasured. OpenRouter rejects its schema (HTTP 400, the JSON tuple for line ranges). Still open.
- **Mechanics check FAILED:** 16 examples, 15 passes, accuracy flat at 0.562; only a shared bias moved (val NLL 0.954 to 0.839). The recipe (22 of 28 layers frozen, lr head 1e-4 and encoder 2e-5) cannot separate inputs.
- **Paused for the user's review** of the strategy and data: `training/laya/README.md`. OpenRouter spend is $1.81 of $5.

## 2026-09-27 E1 Trainer mechanics diagnosis (scripts/laya/mechanics.py)

- **Observed failure:** the train.py `--overfit 16` check kept accuracy flat (0.562) while val NLL fell.
- **Hypothesis:** broken training mechanics (gradient flow, optimizer membership, masks, precision, checkpointing, bucketing) versus insufficient learning signal.
- **Setup:** 27 hand-written, unambiguous examples in matched pairs (training/laya/mechanics/examples.jsonl). No augmentation, no dropout, no weight decay, full-batch steps.
- **Instrumentation (all passed):**
  - every marker lands on a [MASK] token;
  - noul option order is [false, true], matching the targets;
  - all trainable tensors are in the optimizer;
  - gradients and updates reach the top 6 layers, the head and the scorer.
- **Results (fit at 60 steps, bf16, 22 of 28 layers frozen, lr head 1e-4 and encoder 2e-5):**
  - plain: 27/27 by step 40;
  - with checkpointing: 26/27;
  - with bucketing: 26/27;
  - with dropout: 27/27.
  - The 5 matched contradiction pairs flip correctly (e.g. P(conflict) 0.017 for the 404 case versus 0.641 for the 400 case). Before training, the model's sensitivity to the defect was about -0.04. Decisions are identical after save and reload.
- **Conclusion:** the mechanics are sound. The earlier "shared bias" was a per-option, input-independent offset in the scorer (a lean toward one option's text across all examples of a question type). It lowered NLL without flipping any argmax. On 16 long, subtle oracle examples, 90 small steps were too few to learn more. Decision: keep the recipe; the bottleneck is the data (E2).

## 2026-09-27 Label audit (training/laya/audit/label-audit.md) and benchmark registry (docs/benchmark-registry.md)

- **Twin shortcut remains.** Unpadded originals never contain other-seed units, and twins always do. Every val twin mixes Python and Rust. "Any foreign unit means missing" scores 0.875 to 0.95. Missing is taught almost only by twins.
- **About 28% of train `asserts_differently=yes` are doubtful** (the flipped test still agrees with the requirement, or stops checking it).
- **Conflict=no on some partial and unwire cases** that produce the opposite outcome, inconsistent with the flips.
- **`refMatches` substring bug** (`get` matches `get_bool`).
- **Evidence targets** spread over every implementing unit although the question asks for the most direct one.
- **Benchmark registry:** no public benchmark scores requirement status. PAIChecker (PR-issue misalignment, manual labels, MIT) is the closest fit and contradicts corpus A's "gold is clean" on 52 of 500 gold patches. SWE-bench scores cannot be claimed for a reviewer.

## 2026-09-27 Trainer repairs (evaluation semantics, manifests, resumable training)

- **Evidence-style questions** (forward.evidence, tests.test_evidence, reverse.serves) are scored as "any one positive-weight unit is correct"; the loss stays distributional.
- **Encoding writes an immutable manifest** (.laya/runs/<name>/manifest.json(l)): per-example source, seed, kind (original, twin, padded), input and target hashes, length, and class, plus tokenizer sha1, laya version, records sha1, config, rejection reasons and per-class counts. The dataset sha1 guards resumes.
- **Nothing is truncated.** Rejections are counted by reason. The trainer refuses records from test-split seeds.
- **Validation is reported by kind** (original, twin, padded) next to per-class recall.
- **Resumable training:** atomic latest.pt (trainable weights, optimizer, scheduler, RNG, epoch, next batch, batch order, step, best) every --ckpt-every steps, plus best.pt. Earlier experiments are never overwritten.
  - Tested: a run was killed (kill -9) at step 6, batch 12 of 95, then resumed with an identical dataset hash, continuing from batch 12 to step 48.
- **Measured throughput** (focused keys, short inputs, accum 2): about 3.5 s per optimizer step on the Apple M5 GPU.
