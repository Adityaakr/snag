# Blockers

One per line: `- [ ] B<n> M<k> <what> | tried: ... | unblock: <exact human action or condition> | workaround: ...`

- [ ] B1 M2 No provider keys in the environment (TYPESAFE_API_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN) | tried: checked env at session start | unblock: add the keys to `.env` in the repo root (see `.env.example`), then rerun `pnpm test:live` | workaround: fakes and record-and-replay cassettes
- [ ] B2 M2 Live model-id verification (Anthropic Models API for `claude-opus-5-5`, TypeSafe `jev-1.13.0` probe) has not run | tried: `pnpm remit doctor` without keys (checks skip cleanly) | unblock: add TYPESAFE_API_KEY and ANTHROPIC_API_KEY to .env, run `pnpm remit doctor`, and paste the results into docs/providers.md "Doctor results" | workaround: doctor is implemented and tested with fakes; M10 reruns it before live evals
- [ ] B3 M3 Live extraction cassettes for the 12 extraction fixtures are not recorded | tried: fixtures run on scripted LLM output | unblock: add ANTHROPIC_API_KEY to .env, run `pnpm test:live` (the `pending: record live extraction cassettes` test writes fixtures/cassettes/llm/** and eval/reports/extraction-live-vs-scripted.json), then commit both and log the differences in .agent/EXPERIMENTS.md | workaround: scripted outputs cover validation and plumbing
