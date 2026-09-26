# Next

Milestone: M10 Eval-driven improvement (with the LLM verdict engine, D34)
Task: live dev baseline once OpenRouter has credits (B9).

Next action:
1. When credits are added (B9), run golden live: `REMIT_CACHE_MODE=live pnpm remit eval golden --mode live --config config/llm-jev.remit.yml`. Fix plumbing issues first; golden must be judged on real answers, not provider errors (check item warnings).
2. Then the dev baseline with this config: `pnpm remit eval mutations --split dev --mode live --config config/llm-jev.remit.yml --baseline single_pass`, and swebench dev (start with `--limit 20` to measure cost). Then `pnpm remit calibrate --config config/llm-jev.remit.yml`.
3. Run the 11.7 loop on dev. Known first candidates (EXPERIMENTS 2026-09-27):
   - extraction over-extracts user-need lines and worked examples, and duplicates quotes;
   - measure the Sonnet 5 against Opus 5.5 Jev engine.
4. Laya (local) did not discriminate (golden 1/18). Revisit only as a distillation target.
