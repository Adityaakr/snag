# Session log

## 2026-09-26 session 1
- Started M0 from an empty folder. Wrote the kit files from the human's paste, scaffolded the workspace, progress script, guards, hooks, subagents and memory files.
- M0 gate: the milestone-verifier subagent directory only loads next session, so a general-purpose agent ran the Appendix F.1 checklist verbatim: VERDICT: PASS (all 18 checks). Cleared its two lint nits (biome migrate, template literal in settings.test.ts). Tagged m0-done.
- Commits: e50fc7b, 4eaae58, bcd62e8, 41d5ab8, plus the gate commit.

## 2026-09-26 session 2 (resumed)
- M1: code-fact detectors (17 kinds, table-driven), perf check (5,000-line diff in `228 ms`), `remit units`, coverage check. All M1 items checked.
- M1 gate: milestone-verifier VERDICT: PASS with 5 non-blocking defects; all 5 fixed (EPIPE, GitGrepReferences tests, string-literal false positives, over-cap warning, PROGRESS text). Tagged m1-done.
- M2: Jev adapter, LLM adapter (native structured output for Opus 5.5), GitHub adapter (msw), record and replay, `remit doctor`, config schema, `pnpm test:live`, `guard:tests`. All items checked; gate next.
- M2 gate: milestone-verifier VERDICT: FAIL (doctor item claimed live model verification that needs keys). Unchecked it, added `pending:` live tests, set M2 BLOCKED-HUMAN on B2, fixed three audit notes. Moving to M3.
- M3 gate: milestone-verifier VERDICT: PASS; fixed its gaps (B3 live cassette test and blocker, architecture test scope, amendment authority, short task items). Tagged m3-done.
- Correction: the first M3 follow-up commit carried the DECISIONS note but a failed edit script had skipped the amendment-authority and short-item code changes. Applied them with tests in the next commit and moved the local `m3-done` tag to it (nothing is pushed).
- M4: question sets C.2 to C.7 (spec parity), retrieval (BM25, boosts, rerank, widen, base code), verdict engine and unit rules (threshold edges), routing and gate refusal, claims, runReview, golden scenarios 1 to 18 via a recording generator. All items checked; gate next.
