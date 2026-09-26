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
- M4 gate: FAIL (test strength: threshold edges, golden expectations weaker than Appendix D), fixed; re-audit FAIL (two edges), fixed with a full threshold sweep; final re-audit VERDICT: PASS. Tagged m4-done.
- Correction: the dogfood-fix commit said "with a test" but a failed edit script had skipped the test; added it in the next commit (it fails without the detector change, passes with it).
- M5: renderers (E.1 to E.4, check run, SARIF) with sanitization and snapshots, `remit review` (local and GitHub, all flags, exit codes 0 to 4), `remit init`, `remit demo` (1.1 s), README quickstart verified in a clean clone, first dogfood run logged (one false positive found and fixed). All items checked; gate next.
- M5 gate: FAIL (untested flag wiring, missing JSON and check-run snapshots), fixed; re-audit VERDICT: PASS. Tagged m5-done.

## 2026-09-26 M6 closed (BLOCKED-HUMAN on B5)
- Built corpora B (12 seeds, 9 G.1 operators), A (SWE-bench Verified plus PatchDiff, 1,203 items) and the C format; froze the test split (390 files, guard:split); added metrics, stability, isotonic calibration, dev threshold tuning, baselines, reports, and `remit mutate`, `remit calibrate` and `remit report`.
- milestone-verifier: first run FAIL (10 gaps, fixed in D28), second run PASS; its notes are addressed in D29.
- Without keys, every report is simulated and marked "Not a real measurement". B5 (live run), B6 (real seeds) and B4 (optional spot checks) are open.

## 2026-09-27 M7 closed (DONE)
- Built the GitHub writer and App auth in providers; a Hono server with signed webhooks, dedupe, a debounced and cancellable queue, the review flow, slash commands, the issue checklist, rework and gate modes, setup and metrics; a node24 Action bundle; docs/github-app.md and docs/github-action.md; integration tests (recorded payloads against FakeGitHub) and an HTTP end-to-end test.
- security-reviewer: FAIL, then PASS (D30). milestone-verifier: FAIL (the Action never loaded a calibration), then PASS.
- Dogfood run 3 fixed a false-positive `secret_like` on GitHub node ids.

## 2026-09-27 M8 closed (DONE)
- Built the Postgres schema and migrations (Drizzle, PGlite in tests) with data minimization, pg-boss queues with retries and dead letters, feedback from slash commands, the dashboard and implicit weak labels, the React dashboard with GitHub OAuth and accessibility tests, corpus C exports, and the M8 end-to-end test.
- milestone-verifier: FAIL (code stored by default; dead letters across installations), then PASS (D31 addendum). Dogfood run 4 surfaced swallowed queue errors (fixed).
