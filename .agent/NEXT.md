# Next

Milestone: M4 Retrieval, Jev question sets, verdicts, routing
Task: question sets C.2 to C.7.

Next action:
1. packages/core/src/questions/: forward.v0, tests.v0, reverse.v0, preexisting.v0, claims.v0, rerank.v0 exactly as Appendix C (qs-0.1.0), with state builders and spec-parity tests (extend the C.1 table parser to Score levels and options).
2. Retrieval in packages/analysis/src/retrieval (6.5): tokenizer, BM25 k1 1.2 b 0.75 with boosts, all-in shortcut, rank fill 1..40, rerank request over 40, widen tranche, test retrieval, base-code retrieval.
3. Verdict engine (pure) in packages/core/src/verdicts with table-driven tests at every threshold edge; unit rules; test integrity; calibration map.
4. Claims split + routing/modes/finding ids/contentKey/reason templates; gate refusal.
5. packages/pipeline runReview + golden scenarios 1 to 18 in fixtures/golden.
