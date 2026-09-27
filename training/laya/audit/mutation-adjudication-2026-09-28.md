# Mutation corpus adjudication (py-retry-backoff, rs-semver-compare)

Standard: `docs/status-rubric.md` only. Evidence: each item's `trees.head` in `eval/corpora/mutations/dev/<id>.json`, whole head tree searched. Line numbers are in the mutated head file. No test seeds opened.

## Summary

| # | Item / requirement | Label | A | Rubric status | Label verdict | A verdict |
|---|---|---|---|---|---|---|
| 1 | py drop_requirement.R1 / R1 | missing | contradicted | contradicted | relabel to contradicted | valid |
| 2 | py drop_requirement.R3 / R3 | missing | contradicted | contradicted | relabel to contradicted | valid |
| 3 | py claim_all_done.R1 / R1 | missing | contradicted | contradicted | relabel to contradicted (claim mismatch on R1 stays) | valid |
| 4 | py partial_requirement.R2 / R2 | partial | contradicted | contradicted | relabel to contradicted | valid |
| 5 | py unwire.R1 / R1 | partial (accepts missing) | contradicted | contradicted | relabel to contradicted | valid |
| 6 | py unwire.R1 / R4 | done | partial | done | keep | false |
| 7 | py inject_config.client_config.py / R3 | done | contradicted | done | keep | false (its unexplained finding on `client/config.py` is valid) |
| 8 | py drop_requirement.R2 / R2 | missing | missing (B: contradicted) | contradicted | relabel to contradicted | A type-mismatched; B valid |
| 9 | rs drop_requirement.R1 / R1 | missing | missing | contradicted | relabel to contradicted (weak competing reading below) | type-mismatched |
| 10 | rs drop_requirement.R2 / R2 | missing | missing | contradicted | relabel to contradicted | type-mismatched |
| 11 | rs drop_requirement.R3 / R3 | missing | missing | missing | keep | valid |
| 12 | rs drop_requirement.R4 / R4 | missing | missing | missing | keep (minor ambiguity) | valid |

Overall: the labels follow the mutation operator name (drop means missing, partial means partial), which the rubric says is not evidence. In `py-retry-backoff` every "drop" and "partial" leaves the named situation reaching a defined code path with a ruled-out outcome, so all are contradicted. A is right on 5 of the 6 disputed py items. A is also inconsistent: it calls a fixed delay contradicted but calls "retry every status" (py R2) and "reject with an error" (rs R1, R2) missing.

## Cases

### 1. py-retry-backoff.drop_requirement.R1, requirement R1
- Requirement: "Delays between attempts start at `base_delay` and double each time, capped at `max_delay` (with a base of 0.5s: 0.5, 1, 2, 4)".
- Head: `client/retry.py:43` `delay = settings["base_delay"]`, `:45` `sleep(delay)`. `backoff_delay` is gone from the tree; no other delay code.
- Situation: the delay between attempts. Outcome: 0.5, 0.5, 0.5 (fixed). The requirement rules out a fixed delay (must double).
- Status: **contradicted**. This is exactly the rubric's worked example ("delays double" versus a fixed delay). Not partial either: the doubling part is handled differently, not absent.
- Label: relabel missing to contradicted. A: **valid**.

### 2. py-retry-backoff.drop_requirement.R3, requirement R3
- Requirement: "When the last attempt fails, raise `RetryExhausted` with the number of attempts and the last HTTP error as its cause".
- Head: `client/retry.py:39-40` `if attempt == attempts: raise` (re-raises the `HttpError`). `RetryExhausted` class removed. `tests/test_retry.py:31` now expects `pytest.raises(retry.HttpError)` (test asserts differently).
- Situation: last attempt fails. Outcome: raw `HttpError` raised; requirement says `RetryExhausted`.
- Status: **contradicted** (defined, different outcome; it is also the base behaviour, which the rubric treats as contradicted when ruled out).
- Label: relabel to contradicted. A: **valid**.

### 3. py-retry-backoff.claim_all_done.R1, requirement R1
- Same head code as case 1 (`client/retry.py:43` fixed `settings["base_delay"]`); PR body claims R1 done.
- Status: **contradicted**. The claim mismatch label on R1 still holds.
- Label: relabel R1 to contradicted. A: **valid** (A did not surface the claim mismatch; not in scope here).

### 4. py-retry-backoff.partial_requirement.R2, requirement R2
- Requirement: "Only status 429 and the gateway errors 502, 503 and 504 are retried; any other status is raised on the first failure".
- Head: `client/retry.py:23-26` `is_retryable` returns True only for `(502, 503, 504)`; `:41-42` `if not is_retryable(error): raise`.
- Situation: status 429. Outcome: raised on the first failure, not retried. Requirement says 429 is retried.
- Status: **contradicted** for input 429. Rubric, partial versus contradicted: a removed named case that now reaches a code path with a defined, different outcome ("for example it now raises an error") is contradicted. Partial would need 429 to be unhandled; it is handled.
- Label: relabel partial to contradicted. A: **valid**.

### 5. py-retry-backoff.unwire.R1, requirement R1
- Head: `client/retry.py:47` `delay = attempt`; `backoff_delay` still defined at `:31-32` but never called.
- Situation: delay between attempts. Outcome: 1, 2, 3 s. Requirement: 0.5, 1, 2, 4 (start at `base_delay`, doubling, capped). Start value wrong (1 not 0.5), linear growth not doubling, `base_delay` and `max_delay` ignored.
- Status: **contradicted** (different values for the named situation). Neither partial (nothing named is implemented in the live path) nor missing (the situation has a defined outcome).
- Label: relabel partial/missing to contradicted. A: **valid**. The `new_symbol_unreferenced` fact label is correct.

### 6. py-retry-backoff.unwire.R1, requirement R4
- Requirement: "Each retry logs a warning such as `retry 2/4 in 0.5s` (next attempt, max attempts, delay)".
- Head: `client/retry.py:48` `log.warning("retry %d/%d in %.1fs", attempt + 1, attempts, delay)`. Emits `retry 2/4 in 1.0s`: next attempt, max attempts, and the delay actually used.
- Status: **done**. "such as" makes `0.5s` illustrative; all three named fields are logged correctly. The wrong number is R1's defect propagating, not an R4 defect. (`test_logs_each_retry` would fail in this head because it hard-codes `0.5s`; that is a test consequence, not an R4 status.)
- Competing reading (rejected): the literal example string must be reproduced. The text marks it as an example.
- Label: keep done. A (partial): **false**.

### 7. py-retry-backoff.inject_config.client_config.py, requirement R3
- Head: `client/config.py:5` `"max_attempts": 10`; `client/retry.py:45-46` `if attempt == attempts: raise RetryExhausted(attempts) from error`.
- Situation: last attempt fails. Outcome: `RetryExhausted(10)` chained to the last `HttpError`. The requirement names no specific attempt count.
- Status: **done**. The config change breaks `test_gives_up_after_max_attempts` (5 failures under 10 attempts now succeeds) and `test_logs_each_retry` (`2/10`), but those are test and unexplained-change problems, not R3 violations.
- Label: keep done. A's R3 contradicted: **false**. A's `unexplained` entry on `client/config.py:1-5` (behavioral) is the real problem of this item and is **valid** (matches `pr: problem`).

### 8. py-retry-backoff.drop_requirement.R2, requirement R2
- Head: `is_retryable` removed; `client/retry.py:33-39` catches every `HttpError` and retries until `:35-36` raises `RetryExhausted`.
- Situation: a non-listed status such as 404. Outcome: retried up to 4 times with backoff, then `RetryExhausted`. Requirement: "raised on the first failure". Also "Only ... are retried" is violated. Listed statuses are still retried (that half holds), but the half that holds does not make it partial because the other half is handled differently, not absent.
- Status: **contradicted**. This is the fall-back-to-older-behaviour case (the issue says the old code "retries every HTTP error") with an outcome the requirement rules out.
- Label: relabel to contradicted. A (missing): **type-mismatched**. B (contradicted): valid.

### 9. rs-semver-compare.drop_requirement.R1, requirement R1
- Requirement: "A leading `v` is accepted and ignored (for example `v1.2.3` parses as `1.2.3`)".
- Head: `src/version.rs:30` `let text = input;`, `:33` `part.parse().map_err(|_| VersionError::Malformed(input.to_string()))?`. `parse("v1.2.3")` fails on `"v1"` and returns `Err(Malformed("v1.2.3"))`.
- Situation handled, outcome rejection; requirement says accepted. Same as base behaviour.
- Status: **contradicted** under the rubric text (partial-versus-contradicted: "now raises an error" is contradicted; missing requires that nothing handles the situation with a defined outcome).
- Competing reading: generic numeric validation is not code "about" leading `v`, so the fallback is "outside what the requirement speaks about" and it is missing. Weak here because the requirement's own example names the input `v1.2.3`, and the code produces a defined result for exactly that input.
- Label: relabel to contradicted (or ambiguous if the rubric owner wants generic rejection treated as missing; then the rubric must say so, and py case 4 would need the same treatment). A (missing): **type-mismatched**.

### 10. rs-semver-compare.drop_requirement.R2, requirement R2
- Requirement: "Missing minor or patch parts default to 0 (`1.4` parses as `1.4.0`, `2` as `2.0.0`)".
- Head: `src/version.rs:41-42` only `[major, minor, patch] => Ok(...)` and `_ => Err(VersionError::Malformed(...))`.
- Situation: `1.4`, `2`. Outcome: explicit catch-all arm returns an error. Requirement: parse with zeros.
- Status: **contradicted** (a named case reaches an explicit arm with a defined different outcome; stronger than case 9 because the arm is a deliberate match on part count).
- Label: relabel to contradicted. A (missing): **type-mismatched**.

### 11. rs-semver-compare.drop_requirement.R3, requirement R3
- Requirement: "`caret_matches` implements caret ranges ...".
- Head: `caret_matches` and its tests removed; nothing in `src/version.rs`, `src/lib.rs` or `src/policy.rs` evaluates a caret range. `policy.rs:14-17` `is_upgrade_allowed` (max major jump) is a different concept and outside what R3 speaks about.
- Status: **missing** (no code path produces any outcome for caret matching).
- Label: keep. A: **valid**.

### 12. rs-semver-compare.drop_requirement.R4, requirement R4
- Requirement: "A parse failure displays as `invalid version: <input>`".
- Head: `impl fmt::Display for VersionError` removed; only `#[derive(Debug, PartialEq)]` at `src/version.rs:10`. No `to_string`/`Display` path exists (would not compile); nothing else formats the error.
- Status: **missing**. Minor competing reading: `Debug` output `Malformed("1.x")` is a defined different rendering, so contradicted. Rejected: "displays" names the Display channel, which has no implementation; Debug is outside what the requirement speaks about.
- Label: keep. A: **valid**.

## Consistency across seeds

- Applying one rule: a named situation that now reaches a defined code path with a ruled-out outcome is contradicted, whether that path is a fixed delay (py R1), a plain re-raise (py R3), an immediate raise (py R2 partial), retry-all (py R2 drop), or an error arm/parse failure (rs R1, R2). Only rs R3 and rs R4 leave the situation genuinely unhandled, so only they are missing.
- The labels are consistent with the operator name, not with the rubric: every drop is labelled missing. Under the rubric 6 of the 8 drop items across the two seeds are contradicted.
- A's agreement with "missing" on rs R1/R2 is therefore not evidence the rubric is being applied; A applies it on py R1/R3 but not on py R2 or rs R1/R2.
- Recommendation: generate drop/partial/unwire labels from the head behaviour for the named example inputs (run or trace the stated examples: does the input produce an outcome, and is it the stated one?) instead of from the operator. For the py seed, all drop/partial/unwire labels change; for rs, drop R1/R2 change.
