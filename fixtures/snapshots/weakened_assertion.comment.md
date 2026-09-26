### Remit: does this PR do what #23 asked?

`1` requirement: `1` done · `1` test integrity flag
Comment only. Nothing here blocks the merge.

| | Requirement (quoted from #23) | Status | Confidence | Evidence |
|---|---|---|---|---|
| R1 | "Orders over 100 must get a 10% discount" | ✅ done | `0.85` | `src/discount.ts` L2 |

<details><summary>Test integrity (1)</summary>

- **F-X1** `test/totals.test.ts` L6: assertion loosened from `.toEqual(` to `.toBeDefined(`
</details>

<details><summary>Notes (1)</summary>

- **F-U3** `test/totals.test.ts` L6: Not linked to a requirement; no behavior change found.
</details>

<details><summary>How this was checked</summary>

Requirements were extracted from #23 without looking at this PR. Each verdict combines typed model decisions (`jev-1.13.0`) using fixed rules. Confidences are raw (not calibrated yet). Remit checks intent, not bugs, style or security. Cost `$0.00`, time `0 s`.
</details>

Help Remit learn: reply `/remit agree F-X1` or `/remit disagree F-U3 <why>`.
<!-- remit:summary v1 review=rv_weakened_assertion head=head -->
