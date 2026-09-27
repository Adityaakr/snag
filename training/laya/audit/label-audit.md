# Label audit: remit-laya training data

Scope: the 9 dev seeds (train: py-blog-slugs, py-csv-import, rs-cli-args, rs-config-parser, ts-flag-rules, ts-job-intervals, ts-money-format; val: py-retry-backoff, rs-semver-compare). I did not open the test seeds. Sources: `packages/eval/src/oracle.ts`, `packages/eval/src/mutations/operators.ts`, `scripts/laya/train.py`, each seed's `seed.json`, `base/` and `head/`, the dev items under `eval/corpora/mutations/dev/`, and `training/laya/data/{export/*.jsonl.gz,oracle-records.jsonl.gz}`. For every flip, partial, drop and unwire item, I diffed the mutated head tree against the seed head.

## Highest-impact problems

1. **Twins can be spotted without reading code (shortcut).** A twin swaps the requirement's implementing or test units for units from other seeds on the same side of the split. Unpadded originals never contain units from another seed; unpadded twins always do.
   - On rows under 1,024 state tokens (the padding floor), the rule "any unit whose file is not in the seed → missing/none/no" gets `0.875–0.912` accuracy on train and `0.875–0.950` on val.
   - On all rows, a two-feature rule (foreign unit present and `n_units <= N`) gets `0.73–0.76` on train and `0.74–0.79` on val. Majority baselines are `0.50–0.62`.
   - Other languages: `705/779` train twins and `297/297` val twins contain at least one unit in another language. There are only two val seeds, one Python and one Rust, so every val twin mixes the two.
   - "Missing" is mostly learned from twins: coverage=`0` is `139` twins vs `19` originals in train, and `67` vs `8` in val. So val missing-recall mostly measures the shortcut.
2. **28% of the train `asserts_differently=yes` positives are doubtful** (33 of 117 rows, from 4 of 15 train flip items). In each, the flipped test does not assert behaviour contrary to the requirement. It only stops checking the stated case.
3. **Partial and unwire items are labelled `conflict=no`, even when their behaviour matches flips labelled `conflict=yes`.** Example: `ts-job-intervals.flip_condition.R3` rejects `1s`, which the requirement says to accept, and is labelled conflict=yes. `ts-job-intervals.partial_requirement.R1` rejects `2h`, which the requirement also says to accept, and is labelled conflict=no. The conflict question's own text counts "the opposite outcome" as a conflict.
4. **A substring bug in `refMatches` (`oracle.ts:55`: `a.includes(b) || b.includes(a)`) produces wrong evidence and serves targets.**
   - rs-config-parser: unit `get` matches R4's ref `Config/get_bool`.
   - rs-semver-compare: the test `parse_errors_name_the_input` matches R1/R2's ref `parse`, and `parse` matches R4's test ref.
5. **Evidence is a single-answer question with a spread target.** "Which entry *most directly* implements…" is trained on a uniform spread over every implementing ref. That puts half or a third of the mass on callers, enum types and type aliases (for example `ArgError` 0.5, `Currency` 0.33).

## Disputed labels

| itemId | question | current label | issue | proposed |
|---|---|---|---|---|
| py-csv-import.flip_condition.R4 | tests.asserts_differently | yes (5 train rows) | Flipped test (`tests/test_csv_import.py:53`, `81`→`101`) still asserts 80 accepted and 101 rejected. Both agree with "names longer than 80 are rejected". It is weaker, not contrary. Flip spec at seed.json:135. | relabel no |
| py-csv-import.flip_condition.R4 | tests.asserts_as_stated | no | Test asserts part of the stated behaviour (80 ok, >80 rejected for 101) but misses 81–100. | uncertain (exclude) |
| rs-cli-args.flip_condition.R1 | tests.asserts_differently | yes (16 rows) | Flipped test asserts `-J 8` works. The requirement is silent on `-J` and says nothing forbidding it. Only the impl contradicts (`-j` no longer aliased). seed.json:33. | uncertain (exclude) |
| rs-config-parser.flip_condition.R2 | tests.asserts_differently | yes (6 rows) | Flipped test asserts `%` lines are comments. The requirement is silent on `%`, and the test just drops the `;` check. seed.json:60. | uncertain (exclude) |
| ts-job-intervals.flip_condition.R2 | forward.conflict, tests.asserts_differently | yes, yes | Impl still throws `DurationError`, but the message is `invalid duration` without the value: an omitted part (partial), not contrary behaviour. The test's `toThrow('invalid duration')` is a substring check and does not assert that the value is absent. seed.json:105. | uncertain (conflict), relabel asserts_differently no |
| ts-job-intervals.flip_condition.R1 | forward.conflict | yes | Requirement never states that `m` is 60,000 ms. The contradiction rests on convention only. | keep (low risk) |
| rs-config-parser.flip_condition.R4 | forward.conflict | yes | `"no" => Some(true)`. Requirement says "reads yes/no", which implies no→false but does not state it. | keep |
| ts-flag-rules.partial_requirement.R1 | forward.conflict | no | Domain check removed, so users outside the domain get the flag on, the opposite of "must match every list". | uncertain |
| ts-job-intervals.partial_requirement.R1 | forward.conflict | no (2) | `2h` now throws, the opposite of "accepts h". Same shape as flip R3, which is labelled yes. | uncertain |
| rs-semver-compare.partial_requirement.R2 (val) | forward.conflict | no (2) | `"2"` now returns an error instead of `2.0.0`. | uncertain |
| py-csv-import.partial_requirement.R3 | forward.conflict | no (1) | `5 Mar 2024` is now reported as `bad signup_date`. | uncertain |
| py-retry-backoff.partial_requirement.R2 (val) | forward.conflict | no (2) | 429 is now raised on the first failure. The requirement explicitly says 429 is retried. | uncertain |
| py-retry-backoff.unwire.R1 (val) | forward.conflict | no (2) | Unwire leaves `delay = attempt` (delays 1, 2, 3), which contradicts "start at base_delay, double". | relabel yes or exclude |
| ts-flag-rules.unwire.R2 | forward.conflict | no (2) | Rollout is skipped, so `percent: 0` users get the flag on, the opposite of "off for everyone". | uncertain |
| rs-config-parser.* (R4, 12 of 13 records) | forward.evidence | spread {get, get_bool} | Substring bug: `get` is R3's lowercasing, not R4. 14 export rows. R4 twins also drop `get`. | relabel get_bool only |
| rs-config-parser.* (unit `get`) | reverse.serves | {R3, R4} (13 records) | Same bug. | relabel R3 |
| rs-semver-compare.* (unit `parse_errors_name_the_input`) | reverse.serves | {R1, R2, R4} (14 records) | `"parse_errors…".includes("parse")`. It is only R4's test. | relabel R4 |
| rs-semver-compare.* (unit `parse`) | reverse.serves | {R1, R2, R4} (13 records) | R4's test ref contains "parse". `parse` does not implement Display. | relabel {R1, R2} |
| ts-job-intervals.* R1 | tests.test_evidence | spread over 3 tests incl. `keeps the job name` | `keeps the job name` (seed.json:30) asserts only `.name == 'sync'`. It was a base test, so it is not an R1 assertion. 9 export rows. | relabel (drop that test) |
| ts-flag-rules.* R2 (done) | tests.asserts_as_stated | yes | Tests only check that `bucketOf` is deterministic, which is trivially true, and the 0/100 extremes. The stated "percent of users" and "hash of flag name and user id" are not asserted. | uncertain |
| ts-flag-rules.* R4 (done) | tests.asserts_as_stated | yes | Test skips targeting and rollout but not the schedule (`startsAt`) check. | keep-weak / uncertain |
| py-blog-slugs.* R3, py-retry-backoff.* R2 (done) | tests.asserts_as_stated | yes | The single-word >60 cut is untested (R3). 502 and 504 are untested (R2). | keep-weak |
| py-csv-import.drop_requirement.R1, claim_all_done.R1 | forward.coverage | 0 | Empty email is still skipped, via `is_valid_email('')`, just with the wrong message. That is closer to Touched. The verdict sums 0+1, so it is harmless there. | keep |
| ts-job-intervals.drop_requirement.R1 (R2 via dropLabels) | forward.evidence | none | The `DurationError` class that names the value is still in the diff but never thrown. | keep / uncertain |

## Answers per question

**1. Contradiction positives.** All 20 dev flips (15 train, 5 val) contradict the requirement on the implementation side. Two of them rest on implication rather than text: ts-job R1 (the ms value of `m`) and rs-config R4 (no→false). One is arguably partial, not contradicted: ts-job R2. On the test side, 3 flips replace the stated value with a different input instead of a different expected result, so the flipped test is just silent on the stated case: py-csv R4, rs-cli R1, rs-config R2. The rest assert behaviour contrary to the requirement, for example rs-cli R2 (65 accepted), ts-flag R3 (off at `startsAt`) and ts-money R1 (`980.00 JPY`). The oracle hard-codes `asserts_differently=yes` for every contradicted label (`oracle.ts:177`).

**2. Missing and partial.**
- Drop: every drop reverts to base, or deletes the symbol when base lacks it. No dropped behaviour pre-exists in base, and none is implemented elsewhere.
- Soft cases:
  - py-csv R1: empty emails are still skipped by R2's code.
  - ts-job drop R1: `DurationError` is left defined but unused. R2 is labelled missing via `dropLabels`.
- Partial: all 9 partials remove a case the requirement names (ae, `5 Mar 2024`, 429, `-j`, `on`, `2`, domains, `h`, EUR). The issue is question 3 of the list above: removing a named case often produces the opposite outcome for that input, yet the label is conflict=no.

**3. Multi-function implementations.**
- `forward.evidence` asks for the single entry that "most directly implements". The oracle target is `spread(hits)` over every implementing ref (`oracle.ts:156-160`), while the flow answer steers to the first key.
- Spread cases:
  - two-way: py-blog R1/R3 {helper, slugify}, py-csv R2/R3, py-retry R1–R3, rs-cli R1/R2/R4, rs-config R1/R3, ts-job R1/R2, ts-money R2/R4, rs-semver R1/R4;
  - three-way: ts-flag R2 {bucketOf, inRollout, isEnabled}, ts-money R1 {Currency, CURRENCIES, formatMoney}.
- The evidence is not jointly necessary for the answer. It picks one unit, and the verdict uses a single pick (`requirement.ts:223`).
- The spread target caps top-1 probability at 0.5 or 0.33. It also makes the dead-implementation rule (`requirement.ts:228`) depend on which of the helper or the caller the model picks.
- Proposed fix: weight the primary helper (for example 0.7), or score evidence as "top pick ∈ hits".

**4. Test alignment.**
- Test labels are derived from the implementation label, not from test content. `asserts_as_stated=1` iff the requirement label is `done` and any listed test is present (`oracle.ts:172`), and 0 for missing or contradicted.
- That matches the tests in most cases. Exceptions:
  - the flip tests above;
  - ts-job R1's listed `keeps the job name`, which does not test R1;
  - thin tests for ts-flag R2 and R4.
- No seed's `unrelatedTest` is also a requirement test, so the weaken and skip items do not corrupt requirement labels.

**5. Twins.**
- The missing label holds in the cases I checked. For every requirement, the kept same-seed units do not implement it. A few edit related code (ts-flag R3 keeps `FlagRule` with the `startsAt?` field; py-blog R2 keeps `truncate`), which is "Touched", and Touched is summed into missing.
- Test twins sometimes keep tests that exercise the behaviour indirectly. py-retry R1 keeps `test_logs_each_retry`, which asserts the first delay is `0.5`. ts-job R1 keeps the tests that use `0s`/`1h`. None asserts the stated values, so `no` is defensible.
- The real problem with twins is the shortcut in problem 1.

**6. Touched (level 1).** It is never a target. The verdict engine folds it into missing: `missingP = cal(rc0 + rc1)` (`requirement.ts:141`). The partial branch requires `rc2 >= max(rc0, rc1, rc3)` (`:192`). Mass on level 1 is therefore equivalent to None, so leaving it untrained costs nothing for verdicts. It does leave the level-1 head uncalibrated.

**7. Split isolation.** Seeds are disjoint. Among lines longer than 25 characters, val shares none with train (py-retry) or only 2 Rust boilerplate lines (rs-semver: `#[derive(Debug, PartialEq)]` and the `fmt` signature). Issue phrasing is distinct.
- Shared template: every seed has 4 checkbox requirements, a numeric config function edited by `inject_config`, and a rename refactor. Every flip is a single-token edit to one implementation and one test.
- Within train, near-identical states repeat across items (clean, drop of another requirement, and so on): 2,544 forward/tests rows, 2,407 unique contents, no conflicting labels.
- Leakage risk is low. Style homogeneity is high: one author, one template.

**8. Shortcuts.** The strong one is foreign units (problem 1). Lexical overlap between the requirement text and the best unit's symbol and diff gives `0.73–0.75` on train and `0.64–0.73` on val. That partly reflects legitimate retrieval, but twins inflate it.

Mitigations:
- Build twins from same-seed decoys: the mutated head of the drop item for the same requirement, which exists for every requirement.
- Pad originals and twins with the same number of foreign units.
- Draw donors from the same language.
- Report val metrics separately for originals and twins.
