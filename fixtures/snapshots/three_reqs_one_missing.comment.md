### Remit: does this PR do what #12 asked?

`3` requirements: `2` done, `1` missing
Comment only. Nothing here blocks the merge.

| | Requirement (quoted from #12) | Status | Confidence | Evidence |
|---|---|---|---|---|
| R1 | "the export button downloads a CSV" | ✅ done | `0.85` | `src/reports/export.ts` L15-17 |
| R2 | "include a header row" | ✅ done | `0.85` | `src/reports/export.ts` L9-14 |
| R3 | "the filename includes the report date" | ❌ missing | `0.92` | none found |

**Needs rework**
- **F-R3** R3: No change implements this (`0.92`). The PR description says this is done: "All requirements are done".

<details><summary>How this was checked</summary>

Requirements were extracted from #12 without looking at this PR. Each verdict combines typed model decisions (`jev-1.13.0`) using fixed rules. Confidences are raw (not calibrated yet). Remit checks intent, not bugs, style or security. Cost `$0.00`, time `0 s`.
</details>

Help Remit learn: reply `/remit agree F-R3`.
<!-- remit:summary v1 review=rv_three_reqs_one_missing head=head -->
