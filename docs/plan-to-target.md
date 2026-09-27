# Plan to reach the 99% target (2026-09-28)

## Where we are (measured, `docs/eval-results-strict.md`)

| Metric | Now (best) | Target |
|---|---|---|
| Finding precision, real PRs | 2/9 decidable (22%) | ≥99% |
| Finding precision, synthetic PRs | 22/29 (76%) | ≥99% |
| Target-defect recall, correct type | 20/25 (80%) | ≥99% |
| Entire-review correctness | 20/29 (69%) | ≥99% |
| Laya (local, free) | near-random on new codebases | usable |

**Why we are short, in order of impact:**
1. **Labels were wrong.** 43% of the targeted training labels contradict the rubric, because they follow the mutation's name instead of the code. Laya was trained on this, and the evaluation was scored on it.
2. **Too little independent data.** 2 held-out codebases and 30 real patches. A 99% claim needs about 380 error-free independent cases per metric; realistically 600 or more.
3. **Real-code false findings:** fix-path code flagged as "unexplained", and requirements invented from things the issue does not ask for.
4. **Scope is too broad.** No system reaches 99% precision and 99% recall on every kind of requirement. It has to be earned in a declared scope.

## The strategy

We reach 99% by **narrowing the scope and abstaining honestly, not by lowering the bar**:
- Remit surfaces a finding only when the evidence is decisive, and says "needs human review" otherwise.
- Abstentions are shown, never counted as correct.
- The supported scope grows only as each slice passes the gate on independent data.

## Phases, each with a gate

### Phase 1: trustworthy data (weeks 1-2)

The single most important step. Without it no number means anything.

1. **Relabel the mutation corpus by the rubric.**
   - Replace operator-name labels with audited ones: 36 corrections are already known, and 6 cases are ambiguous (to resolve or exclude).
   - Change the mutation generator so labels are computed from the code: run the requirement's example inputs against the head code where possible.
   - Tests: a label must never be derived from an operator name.
2. **Add independent real-world labels.**
   - Integrate PAIChecker (manual PR-issue alignment labels on SWE-bench Verified, SWE-bench Multilingual and SWE-Gym; MIT licence). That gives about 800 or more PR-level labels from independent annotators.
   - Mine 20-30 real PR seeds from GitHub (blocker B6) and annotate them with the rubric.
3. **Human adjudication.** A human checks a stratified sample of every label source; Claude-written labels alone cannot prove 99%.
4. **Split by repository, with fresh final-test sets.**
   - Final test for mutations: the 3 frozen seeds.
   - Final test for real PRs: a held-out slice of PAIChecker repositories, never inspected.

**Gate:** label error at most 2% on a human-checked sample, and at least 600 independent labelled cases across at least 15 repositories.

### Phase 2: a high-precision reference engine (weeks 2-3)

Build on A, the single strong-model review, with deterministic checks. Each change is one experiment, on the same development data, with new predictions:
1. **Scope-aware extraction:** only issue asks, never quoted code, PR descriptions or proposed alternatives (E5, retested on both sets).
2. **Fix-path handling for "unexplained" findings**, tested as a hypothesis against planted unwanted behaviour on the fix path (for example a debug print or a side effect), so it cannot hide real defects.
3. **Evidence-gated findings:** a finding needs a quoted requirement and a cited code line. A "missing" claim needs a searched scope, otherwise it abstains.
4. **Agreement gating:** two independent samples must agree before a finding is surfaced; disagreement means abstain. Measure the precision gained against the recall lost.
5. **Per-category thresholds**, chosen on validation only, to plot the precision-recall frontier (90, 95, 98 and 99%).

**Gate:** on development data, 99% precision is reachable at some operating point, with recall and coverage reported. Declare the supported scope where both clear 95%.

### Phase 3: Laya as the free, private engine (weeks 2-5, in parallel)

1. **E7 (running now):** can Laya learn implemented versus missing on unseen codebases from clean, rubric-labelled pairs?
2. **If yes:** add contradictions, then scale with Phase 1's larger clean data. Use distillation from the reference engine on verified cases only, with teacher labels checked against the rubric.
3. **If no after clean data:** stop fine-tuning the typed-question model. Use Laya only as a cheap pre-filter (routing obvious "done" cases away from the paid model), and measure the routing error.

**Gate:** Laya matches the reference engine within 2 points on the supported scope, on unseen repositories.

### Phase 4: freeze and prove (week 5-6)

Freeze the checkpoint, prompts, rules, thresholds and scope. Run the untouched final tests once.
- Report numerator, denominator and intervals per metric, clustered by repository.
- **Pass means the lower bound of the 95% interval is at least 99% on every metric**, within the declared scope.
- If it fails, that test set retires and we go back to Phase 2 with a new independent test set.

### Phase 5: shadow pilot (week 6 onwards)

- Comment-only on 2-3 of your repositories for 2-4 weeks.
- Every comment is labelled agree or disagree by your reviewers (corpus C).
- Recalibrate and widen the scope only where the pilot data supports it.
- Merge blocking stays off until real deployment evidence meets the gate.

## What I need from you

| # | Need | Why | Minimum |
|---|---|---|---|
| 1 | **Raise the API budget** (OpenRouter credits, or an Anthropic key) | Phase 2 needs new predictions on about 600 cases, several variants and repeat runs for agreement gating | about $60-100 (current cap is $5, $0.93 left) |
| 2 | **A read-only `GITHUB_TOKEN`** in `.env` | Mine real PRs and seeds (blocker B6), fetch PAIChecker's source repositories, review PRs by URL | fine-grained, public repositories, read-only |
| 3 | **Human reviewer time** | Independent adjudication of a stratified label sample and the final-test checks; model-made labels cannot prove 99% | about 10-20 hours over 2 weeks (you or a teammate) |
| 4 | **2-3 repositories for the shadow pilot** | Real-world evidence and corpus C | repositories you own; install the GitHub Action or App |
| 5 | **A scope decision** | Which languages and requirement types count for the 99% claim (recommended start: TypeScript and Python, behavioural requirements with concrete values) | yes or no on the recommendation |
| 6 | Optional: **TypeSafe access** or **a cloud GPU** | Jev would be the intended engine; a GPU makes Laya scaling hours instead of days | only if Phase 3 continues |

## What I will do without waiting

- Finish E7 and report it (running locally).
- Relabel the mutation corpus by the rubric, fix the generator's labelling, and add tests (local, $0).
- Integrate the PAIChecker labels, if its data downloads without credentials (local, $0).
- Build the planted-defect test for the fix-path hypothesis (local, $0).

## Honest limits

- 99% precision and 99% recall together are likely achievable only in a narrow scope with visible abstention; a broad claim is not realistic.
- Each phase can fail its gate. The plan says what happens then, and never re-labels a miss as a pass.
- Timelines assume the resources above. Without the budget or reviewers, Phases 2 and 4 stall.
