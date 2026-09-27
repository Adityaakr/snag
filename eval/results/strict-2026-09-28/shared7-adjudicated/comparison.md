### Shared items (7, identical for every system)

| Metric | A+facts+E4 | B_structured | C_laya_v1 |
|---|---|---|---|
| Items (seeds) | 7 (2) | 7 (2) | 7 (2) |
| Target defect surfaced, correct type | 4/6 = 66.7% [30, 90] | 5/6 = 83.3% [44, 97] | 0/6 = 0.0% [0, 39] |
| Target defect surfaced, any type | 6/6 = 100.0% [61, 100] | 6/6 = 100.0% [61, 100] | 0/6 = 0.0% [0, 39] |
| All labelled defects surfaced, correct type | 4/6 = 66.7% [30, 90] | 5/6 = 83.3% [44, 97] | 0/6 = 0.0% [0, 39] |
| Finding precision (surfaced P0/P1) | 4/6 = 66.7% [30, 90] | 5/6 = 83.3% [44, 97] | 0/2 = 0.0% [0, 66] |
| Incorrect findings: type mismatch / duplicate / false | 2 / 0 / 0 | 1 / 0 / 0 | 0 / 0 / 2 |
| Incorrect findings on defective PRs | 2 on 6 PRs | 1 on 6 PRs | 2 on 6 PRs |
| Clean PRs with any finding | 0/1 = 0.0% [0, 79] | 0/1 = 0.0% [0, 79] | 0/1 = 0.0% [0, 79] |
| Requirement-status accuracy | 26/28 = 92.9% [77, 98] | 26/28 = 92.9% [77, 98] | 17/28 = 60.7% [42, 76] |
| Abstentions (uncertain) | 0/28 = 0.0% [0, 12] | 1/28 = 3.6% [1, 18] | 5/28 = 17.9% [8, 36] |
| Entire-review correctness | 5/7 = 71.4% [36, 92] | 5/7 = 71.4% [36, 92] | 0/7 = 0.0% [0, 35] |
| Complete reviews | 7/7 = 100.0% [65, 100] | 7/7 = 100.0% [65, 100] | 7/7 = 100.0% [65, 100] |
| Cost per review (recorded) | $0.0189 | not recorded per review | not recorded per review |
| Live latency p50 / p95 (n) | 14.3 s / 16.0 s (6; 1 cached excluded) | n/a (0 cached) | n/a (0 cached) |

### All attempted items per system

| Metric | A+facts+E4 | B_structured | C_laya_v1 |
|---|---|---|---|
| Items (seeds) | 7 (2) | 7 (2) | 7 (2) |
| Target defect surfaced, correct type | 4/6 = 66.7% [30, 90] | 5/6 = 83.3% [44, 97] | 0/6 = 0.0% [0, 39] |
| Target defect surfaced, any type | 6/6 = 100.0% [61, 100] | 6/6 = 100.0% [61, 100] | 0/6 = 0.0% [0, 39] |
| All labelled defects surfaced, correct type | 4/6 = 66.7% [30, 90] | 5/6 = 83.3% [44, 97] | 0/6 = 0.0% [0, 39] |
| Finding precision (surfaced P0/P1) | 4/6 = 66.7% [30, 90] | 5/6 = 83.3% [44, 97] | 0/2 = 0.0% [0, 66] |
| Incorrect findings: type mismatch / duplicate / false | 2 / 0 / 0 | 1 / 0 / 0 | 0 / 0 / 2 |
| Incorrect findings on defective PRs | 2 on 6 PRs | 1 on 6 PRs | 2 on 6 PRs |
| Clean PRs with any finding | 0/1 = 0.0% [0, 79] | 0/1 = 0.0% [0, 79] | 0/1 = 0.0% [0, 79] |
| Requirement-status accuracy | 26/28 = 92.9% [77, 98] | 26/28 = 92.9% [77, 98] | 17/28 = 60.7% [42, 76] |
| Abstentions (uncertain) | 0/28 = 0.0% [0, 12] | 1/28 = 3.6% [1, 18] | 5/28 = 17.9% [8, 36] |
| Entire-review correctness | 5/7 = 71.4% [36, 92] | 5/7 = 71.4% [36, 92] | 0/7 = 0.0% [0, 35] |
| Complete reviews | 7/7 = 100.0% [65, 100] | 7/7 = 100.0% [65, 100] | 7/7 = 100.0% [65, 100] |
| Cost per review (recorded) | $0.0189 | not recorded per review | not recorded per review |
| Live latency p50 / p95 (n) | 14.3 s / 16.0 s (6; 1 cached excluded) | n/a (0 cached) | n/a (0 cached) |

Wilson 95% intervals over items. Items from one seed are correlated, so intervals are optimistic; the seed count is shown.
