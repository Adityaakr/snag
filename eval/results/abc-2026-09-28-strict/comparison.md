### Shared items (27, identical for every system)

| Metric | A | A+facts | C_laya_v1 |
|---|---|---|---|
| Items (seeds) | 27 (2) | 27 (2) | 27 (2) |
| Target defect surfaced, correct type | 15/23 = 65.2% [45, 81] | 17/23 = 73.9% [54, 87] | 3/23 = 13.0% [5, 32] |
| Target defect surfaced, any type | 19/23 = 82.6% [63, 93] | 21/23 = 91.3% [73, 98] | 3/23 = 13.0% [5, 32] |
| All labelled defects surfaced, correct type | 16/25 = 64.0% [45, 80] | 18/25 = 72.0% [52, 86] | 3/25 = 12.0% [4, 30] |
| Finding precision (surfaced P0/P1) | 16/23 = 69.6% [49, 84] | 18/25 = 72.0% [52, 86] | 3/12 = 25.0% [9, 53] |
| Incorrect findings: type mismatch / duplicate / false | 5 / 0 / 2 | 5 / 0 / 2 | 0 / 0 / 9 |
| Incorrect findings on defective PRs | 7 on 23 PRs | 7 on 23 PRs | 8 on 23 PRs |
| Clean PRs with any finding | 0/4 = 0.0% [0, 49] | 0/4 = 0.0% [0, 49] | 1/4 = 25.0% [5, 70] |
| Requirement-status accuracy | 101/108 = 93.5% [87, 97] | 101/108 = 93.5% [87, 97] | 64/108 = 59.3% [50, 68] |
| Abstentions (uncertain) | 0/108 = 0.0% [0, 3] | 0/108 = 0.0% [0, 3] | 26/108 = 24.1% [17, 33] |
| Entire-review correctness | 17/27 = 63.0% [44, 78] | 20/27 = 74.1% [55, 87] | 0/27 = 0.0% [0, 12] |
| Complete reviews | 27/27 = 100.0% [88, 100] | 27/27 = 100.0% [88, 100] | 25/27 = 92.6% [77, 98] |
| Cost per review (recorded) | $0.0292 | $0.0292 | not recorded per review |
| Live latency p50 / p95 (n) | 17.5 s / 47.5 s (25; 2 cached excluded) | 17.5 s / 47.5 s (25; 2 cached excluded) | n/a (0 cached) |

### All attempted items per system

| Metric | A | A+facts | C_laya_v1 |
|---|---|---|---|
| Items (seeds) | 29 (2) | 29 (2) | 27 (2) |
| Target defect surfaced, correct type | 15/25 = 60.0% [41, 77] | 19/25 = 76.0% [57, 89] | 3/23 = 13.0% [5, 32] |
| Target defect surfaced, any type | 21/25 = 84.0% [65, 94] | 23/25 = 92.0% [75, 98] | 3/23 = 13.0% [5, 32] |
| All labelled defects surfaced, correct type | 16/27 = 59.3% [41, 75] | 20/27 = 74.1% [55, 87] | 3/25 = 12.0% [4, 30] |
| Finding precision (surfaced P0/P1) | 16/25 = 64.0% [45, 80] | 20/29 = 69.0% [51, 83] | 3/12 = 25.0% [9, 53] |
| Incorrect findings: type mismatch / duplicate / false | 7 / 0 / 2 | 5 / 2 / 2 | 0 / 0 / 9 |
| Incorrect findings on defective PRs | 9 on 25 PRs | 9 on 25 PRs | 8 on 23 PRs |
| Clean PRs with any finding | 0/4 = 0.0% [0, 49] | 0/4 = 0.0% [0, 49] | 1/4 = 25.0% [5, 70] |
| Requirement-status accuracy | 109/116 = 94.0% [88, 97] | 109/116 = 94.0% [88, 97] | 64/108 = 59.3% [50, 68] |
| Abstentions (uncertain) | 0/116 = 0.0% [0, 3] | 0/116 = 0.0% [0, 3] | 26/108 = 24.1% [17, 33] |
| Entire-review correctness | 17/29 = 58.6% [41, 74] | 20/29 = 69.0% [51, 83] | 0/27 = 0.0% [0, 12] |
| Complete reviews | 29/29 = 100.0% [88, 100] | 29/29 = 100.0% [88, 100] | 25/27 = 92.6% [77, 98] |
| Cost per review (recorded) | $0.0286 | $0.0286 | not recorded per review |
| Live latency p50 / p95 (n) | 17.2 s / 47.5 s (27; 2 cached excluded) | 17.2 s / 47.5 s (27; 2 cached excluded) | n/a (0 cached) |

Wilson 95% intervals over items. Items from one seed are correlated, so intervals are optimistic; the seed count is shown.
