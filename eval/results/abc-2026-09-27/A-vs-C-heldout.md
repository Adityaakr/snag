Items scored: 27 (same items for every system)

| Metric | A_single_pass | C_laya_v1 |
|---|---|---|
| Target-defect recall, strict type | 16/23 = 69.6% [49, 84] | 3/23 = 13.0% [5, 32] |
| Target flagged, any type | 21/23 = 91.3% [73, 98] | 3/23 = 13.0% [5, 32] |
| Finding precision (P0/P1) | 21/23 = 91.3% [73, 98] | 3/11 = 27.3% [10, 57] |
| False findings on defective PRs | 2 on 23 PRs | 7 on 23 PRs |
| Clean-PR false-positive rate | 0/4 = 0.0% [0, 49] | 1/4 = 25.0% [5, 70] |
| Requirement-status correctness | 101/108 = 93.5% [87, 97] | 64/108 = 59.3% [50, 68] |
| Entire-review correctness | 19/27 = 70.4% [52, 84] | 1/27 = 3.7% [1, 18] |
| Abstentions (uncertain) | 0 of 108 requirements | 26 of 108 requirements |
| Failed or incomplete reviews | 0 of 27 | 2 of 27 |
| Cost per review (measured) | $0.0292 | $0.0000 |
| Latency p50 / p95 | 17.2 s / 47.5 s | 0.0 s / 0.0 s |

Seeds among the items: 2. Items from one seed are correlated; treat intervals as optimistic.

A_single_pass target detection by operator: claim_all_done strict 1/2, any 2/2; drop_requirement strict 6/8, any 8/8; flip_condition strict 5/5, any 5/5; inject_config strict 2/2, any 2/2; partial_requirement strict 1/2, any 2/2; unwire strict 1/2, any 2/2; skip_test strict 0/1, any 0/1; weaken_assertion strict 0/1, any 0/1

C_laya_v1 target detection by operator: claim_all_done strict 0/2, any 0/2; drop_requirement strict 0/8, any 0/8; flip_condition strict 0/5, any 0/5; inject_config strict 0/2, any 0/2; partial_requirement strict 0/2, any 0/2; unwire strict 1/2, any 1/2; skip_test strict 1/1, any 1/1; weaken_assertion strict 1/1, any 1/1
