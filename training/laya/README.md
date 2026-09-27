# remit-laya: fine-tuning strategy and training data (for review before any further training)

Status: **paused for your review.** No further fine-tuning runs until you approve this plan and this data.

## What we are training and why

Remit decides verdicts from typed questions about a requirement and the changed code, for example "how much of the requirement do these changes implement?" or "does any change do something different from the requirement?". TypeSafe's Jev normally answers them; signups are paused. Laya is an open model with the same question format. It runs locally, but as shipped it cannot read code against a spec.

The goal is to fine-tune Laya (`convaiinnovations/laya`, typed-decisions checkpoint, ModernBERT-large, 421M parameters) to answer Remit's own questions, keep the checkpoint as ours (`remit-laya`), and serve it at a 4,096-token window.

## What we have measured so far (verified)

| Engine, same held-out items | Target defects flagged | Notes |
|---|---|---|
| Laya as shipped | 0 of 21 (held-out seeds) | answers almost constant |
| remit-laya-v1 (fine-tuned) | 1 of 21 | learned the majority answer: "done", "no conflict" |
| Structured pipeline + Claude Sonnet 5 answering | 6 of 6 (7-item subset) | 0 false alarms on the clean item; about $0.16 per review |

The task is solvable from the information Remit already gives the model: a strong model gets it right. The gap is Laya's ability to discriminate.

**The latest diagnostic failed.** Trained repeatedly on the same 16 examples, the current recipe did not memorize them: accuracy stayed at 56%, and only a shared bias moved. With 22 of 28 layers frozen and small learning rates, the trainable part cannot separate inputs. That has to be fixed before any full run (step 1 below).

## The training data (this folder)

| File | What it is |
|---|---|
| `data/export/train.jsonl.gz` | **the exact 2,938 training examples** the next run would use (after twins, balancing and long-context padding) |
| `data/export/val.jsonl.gz` | the 1,036 validation examples (held-out seeds, natural class frequencies, no oversampling) |
| `data/oracle-records.jsonl.gz` | the raw 4,317 labeled examples before augmentation |
| `data/samples.md` | **start here:** one readable example per question and answer class, plus a matched original/twin pair |
| `data/splits.json` | which seed is training, validation or final test, with item and operator counts |
| `data/stats.json` | class balance per question and split, and the leakage checks |

Each example line has `question_key`, `answer_class`, `kind` (original or twin), `seedId`, `operator`, `state_tokens`, `question`, `state` and `target`.

### Where the labels come from

- **Source:** the mutation corpus (`eval/corpora/mutations`). There are 12 small seed repositories (TypeScript, Python, Rust), each a correct PR for an issue, with requirement annotations written by Claude Code (`annotated_by: claude-code`, not human-reviewed; see blocker B4). Operators derive defective versions from each seed: drop a requirement, flip a condition, remove one case, unwire a call, weaken or skip an unrelated test, inject a config change or a refactor, and claim all done.
- **How labels are made:** `OracleJev` (`packages/eval/src/oracle.ts`) runs Remit's real pipeline on each item and answers from the item's labels and its seed's annotations. It records a training label only when the labels decide the answer. For example:
  - dropped requirement: coverage = None, evidence = none;
  - flipped condition: conflict = yes, and asserts differently = yes (implementation and test are flipped together);
  - partial: coverage = Most;
  - unwired: coverage not labeled, because the code exists and the defect is its missing call site.
- **Twins:** every "done" example gets a counterfactual twin. The units that implement (or test) the requirement are replaced with realistic units from another seed on the same side of the split. The label becomes missing, and the candidate count stays identical.
- **Long context:** some examples are padded with other seeds' units, up to 4,096 tokens, with the deciding unit at varied positions.

### Splits (by seed family, before any augmentation)

- **Training, 7 seeds:** py-blog-slugs, py-csv-import, rs-cli-args, rs-config-parser, ts-flag-rules, ts-job-intervals, ts-money-format.
- **Validation, 2 seeds** (checkpoint selection and calibration only): py-retry-backoff, rs-semver-compare.
- **Final test, 3 seeds** (frozen, never touched): py-order-date-ranges, rs-lru-cache, ts-list-pagination. `OracleJev` refuses them.

### Class balance (training, after balancing)

- coverage: None 158, Most 54, Full 159
- conflict: no 237, yes 115
- asserts as stated: yes 246, no 247
- asserts differently: no 244, yes 117
- evidence: none 239, some 235
- test evidence: none 247, some 246
- serves: none 125, some 125

Validation keeps natural frequencies. For example, conflict is no 136 and yes 8, so we report per-class recall and balanced accuracy, not raw accuracy.

### Checks already done (see `stats.json`)

- No `D*` or temporary unit ids: every unit is `U1…Un`. The option text matches Remit's exactly (4,960 of 4,960 checked).
- All 292 twins have exactly as many candidates as their originals, so the count cannot reveal the answer.
- Training and validation seeds are disjoint. Test seeds appear nowhere.
- Questions with a single answer class in the data (claims, `loosens_test`) are not trained on, and they are evaluated for regressions.

### Known weaknesses of this data (please weigh these)

1. **Small and synthetic.** Only 7 training seeds, all written in one style by one annotator (Claude Code). Thousands of examples from 7 seeds are not thousands of independent tasks.
2. **Easy negatives.** In a twin, the replacement unit comes from another seed, so it is usually unrelated code. A model can learn "unrelated code means missing" without learning subtle mismatches.
3. **Few subtle positives.** "Conflict" positives come from only 20 flip-condition items. There are no examples of plausible-but-wrong implementations beyond those flips.
4. **Label noise.** It comes from requirements implemented by several units, seed test lists that may be incomplete, and "unwire" and "partial" cases.

## Proposed plan (needs your approval)

1. **Fix the training mechanics, about 30 minutes, $0.** Rerun the 16-example memorization check with the lower layers unfrozen (train 14 of 28 or all layers) and higher learning rates (head `1e-3`, encoder `5e-5`). Proceed only when it memorizes; that shows the trainer can learn from the input.
2. **Short focused diagnostic, about 45 minutes, $0.** Train only the discriminating questions (coverage, conflict, asserts as stated, asserts differently) on this data. Measure per-class recall on the validation seeds and on matched original/twin pairs. Accept only if missing recall and conflict recall are both clearly above what v1 achieved (v1 missed 20 of 21 target defects).
3. **If the diagnostic passes, one full run, about 5 to 7 hours, $0**, then evaluate end to end on the validation seeds (golden, mutations). **If it fails, stop fine-tuning Laya** and ship the hybrid: deterministic checks plus the Sonnet-backed engine for requirement verdicts, at about $0.16 per review.
4. **Harder data (only if step 2 shows a data limit):** same-seed "plausible but wrong" edits (boundary and operator changes where the requirement text states the value) instead of unrelated replacement units. Each would be checked against the seed's tests where possible.
5. **Final test, once, after freezing:** the 3 test seeds, with the `single_pass` baseline on the same items (about $0.80).

**OpenRouter budget:** $1.81 of $5 spent (strategy B ceiling check). Local training costs no API money, but it occupies the Mac's GPU for hours.

## Questions for you

1. Approve the plan above, or change it?
2. Are the Claude-written labels acceptable for training, or do you want to spot-check `samples.md` first (or add human-reviewed seeds)?
3. If fine-tuning fails the step-2 gate, is the Sonnet hybrid at about $0.16 per review acceptable as the product engine?
