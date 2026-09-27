# Label audit: dev mutation items

Scope: all `83` targeted items (drop_requirement, partial_requirement, unwire, flip_condition, claim_all_done) in the 9 dev seeds, judged against `docs/status-rubric.md` from the head tree only, plus `18` spot-checks (2 per seed) of requirements labelled done in each clean item. Test seeds were not opened. Row-level evidence is in `label-audit-all.jsonl`.

## How the rubric was applied

- **Contradicted:** the targeted situation still reaches code that gives a defined outcome the requirement rules out. That covers an older rule for the same thing (fixed delay, spaces-to-hyphen, `toFixed` rounding, `$-4.20`, `Number()` as raw ms), a catch-all that errors (`Malformed`, `MissingEquals`, `UnknownFlag`, "bad signup_date", `TypeError`), or a catch-all that misclassifies the input (`-j` becomes a file, `"on"` returns `None`).
- **Missing:** no code reads the named field or property, so the input passes through unchanged (no truncation, no length or range check, no dedup, quotes kept, targeting fields ignored).
- **Unwire:** a helper that is never called is dead code. It is not a partial implementation, so the status is missing, or contradicted when the replacement produces a ruled-out value.

## By operator

| Group | Items | Agree | Disagree | Ambiguous |
|---|---|---|---|---|
| claim_all_done | `9` | `2` | `6` (missing -> contradicted `6`) | `1` |
| clean spot-check | `18` | `18` | `0` (-) | `0` |
| drop_requirement | `36` | `20` | `15` (missing -> contradicted `15`) | `1` |
| flip_condition | `20` | `18` | `0` (-) | `2` |
| partial_requirement | `9` | `1` | `7` (partial -> contradicted `7`) | `1` |
| unwire | `9` | `0` | `8` (partial -> contradicted `3`, partial -> missing `5`) | `1` |
| total | `101` | `59` | `36` | `6` |


## By seed

| Group | Items | Agree | Disagree | Ambiguous |
|---|---|---|---|---|
| py-blog-slugs | `11` | `6` | `4` (missing -> contradicted `3`, partial -> missing `1`) | `1` |
| py-csv-import | `11` | `7` | `3` (missing -> contradicted `2`, partial -> contradicted `1`) | `1` |
| py-retry-backoff | `11` | `5` | `6` (missing -> contradicted `4`, partial -> contradicted `2`) | `0` |
| rs-cli-args | `11` | `6` | `5` (missing -> contradicted `3`, partial -> contradicted `2`) | `0` |
| rs-config-parser | `11` | `8` | `3` (missing -> contradicted `1`, partial -> contradicted `1`, partial -> missing `1`) | `0` |
| rs-semver-compare | `12` | `7` | `5` (missing -> contradicted `3`, partial -> contradicted `2`) | `0` |
| ts-flag-rules | `11` | `10` | `1` (partial -> missing `1`) | `0` |
| ts-job-intervals | `12` | `5` | `5` (missing -> contradicted `3`, partial -> contradicted `1`, partial -> missing `1`) | `2` |
| ts-money-format | `11` | `5` | `4` (missing -> contradicted `2`, partial -> contradicted `1`, partial -> missing `1`) | `2` |
| total | `101` | `59` | `36` | `6` |


101
## Main findings

1. **partial_requirement: `7/9` should be contradicted.** In each, the removed case reaches an error or catch-all path, which is the rubric's own example of contradicted. Only `ts-flag-rules` (domains never read) is truly partial.
2. **drop and claim_all_done: `21/45` labelled missing should be contradicted.** The code falls back to an older or catch-all outcome. `py-retry-backoff` drop R1 is the rubric's own fixed-delay example.
3. **unwire: none should be partial.** `5` are missing. Those already have `missing` in requirementsAccept, so their primary label is wrong but a missing prediction is accepted. `3` are contradicted (retry R1, cli R1, semver R1), which neither the label nor the accept list allows.
4. **flip_condition: labels hold** (`18/20`), with `2` ambiguous. In job-intervals R3, exactly 1s is now rejected, and the text only names "shorter than". In job-intervals R2, DurationError still carries `.input` but its message no longer names the value.
5. **Other ambiguous items:** money R1 drop and claim (USD part still done, so the status is partial or contradicted, never missing); blog partial R1 (`æ` is dropped by the ascii-ignore fallback); csv unwire R2 (an unreachable "invalid email" branch with a different condition).
6. **Clean spot-checks: `18/18` done.** One minor edge: in flag-rules R1, the rule's domain list is not lowercased (not one of the sampled items).
7. **Not audited but noticed:** job-intervals drop R1 and claim R1 also label R2 missing. DurationError still exists but is never thrown, and NaN passes through silently.
