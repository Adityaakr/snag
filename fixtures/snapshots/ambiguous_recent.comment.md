### Remit: does this PR do what #3 asked?

`1` requirement: `1` done
Comment only. Nothing here blocks the merge.

| | Requirement (quoted from #3) | Status | Confidence | Evidence |
|---|---|---|---|---|
| R1 | "only return recent orders" | ✅ done | `0.85` | `src/orders.py` L1-7 |

<details><summary>Notes (2)</summary>

- **F-R1-ambiguity** The issue can be read more than one way: "orders from the last 7 days" or "orders from the last 30 days".
- **F-X1** `src/orders.py` L4: signature of exported function `list_orders` changed
</details>

<details><summary>How this was checked</summary>

Requirements were extracted from #3 without looking at this PR. Each verdict combines typed model decisions (`jev-1.13.0`) using fixed rules. Confidences are raw (not calibrated yet). Remit checks intent, not bugs, style or security. Cost `$0.00`, time `0 s`.
</details>

Help Remit learn: reply `/remit agree F-R1-ambiguity` or `/remit disagree F-X1 <why>`.
<!-- remit:summary v1 review=rv_ambiguous_recent head=head -->
