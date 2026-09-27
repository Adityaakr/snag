Items scored: 7 (same items for every system)

| Metric | A | A+facts | +units | +model_tests | B_full | C_laya_v1 |
|---|---|---|---|---|---|---|
| Target-defect recall, strict type | 5/6 = 83.3% [44, 97] | 5/6 = 83.3% [44, 97] | 5/6 = 83.3% [44, 97] | 5/6 = 83.3% [44, 97] | 4/6 = 66.7% [30, 90] | 0/6 = 0.0% [0, 39] |
| Target flagged, any type | 6/6 = 100.0% [61, 100] | 6/6 = 100.0% [61, 100] | 6/6 = 100.0% [61, 100] | 6/6 = 100.0% [61, 100] | 6/6 = 100.0% [61, 100] | 0/6 = 0.0% [0, 39] |
| Finding precision (P0/P1) | 6/6 = 100.0% [61, 100] | 6/6 = 100.0% [61, 100] | 6/6 = 100.0% [61, 100] | 6/6 = 100.0% [61, 100] | 6/6 = 100.0% [61, 100] | 0/2 = 0.0% [0, 66] |
| False findings on defective PRs | 0 on 6 PRs | 0 on 6 PRs | 0 on 6 PRs | 0 on 6 PRs | 0 on 6 PRs | 2 on 6 PRs |
| Clean-PR false-positive rate | 0/1 = 0.0% [0, 79] | 0/1 = 0.0% [0, 79] | 0/1 = 0.0% [0, 79] | 0/1 = 0.0% [0, 79] | 0/1 = 0.0% [0, 79] | 0/1 = 0.0% [0, 79] |
| Requirement-status correctness | 27/28 = 96.4% [82, 99] | 27/28 = 96.4% [82, 99] | 27/28 = 96.4% [82, 99] | 27/28 = 96.4% [82, 99] | 25/28 = 89.3% [73, 96] | 17/28 = 60.7% [42, 76] |
| Entire-review correctness | 6/7 = 85.7% [49, 97] | 6/7 = 85.7% [49, 97] | 6/7 = 85.7% [49, 97] | 6/7 = 85.7% [49, 97] | 4/7 = 57.1% [25, 84] | 0/7 = 0.0% [0, 35] |
| Abstentions (uncertain) | 0 of 28 requirements | 0 of 28 requirements | 0 of 28 requirements | 0 of 28 requirements | 1 of 28 requirements | 5 of 28 requirements |
| Failed or incomplete reviews | 0 of 7 | 0 of 7 | 0 of 7 | 0 of 7 | 0 of 7 | 0 of 7 |
| Cost per review (measured) | $0.0189 | $0.0189 | $0.0189 | $0.0189 | $0.0000 | $0.0000 |
| Latency p50 / p95 | 14.3 s / 16.0 s | 14.3 s / 16.0 s | 14.3 s / 16.0 s | 14.3 s / 16.0 s | 0.0 s / 0.0 s | 0.0 s / 0.0 s |

Seeds among the items: 2. Items from one seed are correlated; treat intervals as optimistic.

A target detection by operator: drop_requirement strict 3/3, any 3/3; flip_condition strict 2/2, any 2/2; partial_requirement strict 0/1, any 1/1

A+facts target detection by operator: drop_requirement strict 3/3, any 3/3; flip_condition strict 2/2, any 2/2; partial_requirement strict 0/1, any 1/1

+units target detection by operator: drop_requirement strict 3/3, any 3/3; flip_condition strict 2/2, any 2/2; partial_requirement strict 0/1, any 1/1

+model_tests target detection by operator: drop_requirement strict 3/3, any 3/3; flip_condition strict 2/2, any 2/2; partial_requirement strict 0/1, any 1/1

B_full target detection by operator: drop_requirement strict 2/3, any 3/3; flip_condition strict 2/2, any 2/2; partial_requirement strict 0/1, any 1/1

C_laya_v1 target detection by operator: drop_requirement strict 0/3, any 0/3; flip_condition strict 0/2, any 0/2; partial_requirement strict 0/1, any 0/1
