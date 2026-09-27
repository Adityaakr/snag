# Next

Milestone: M10 Eval-driven improvement (branch feat/laya-engine)
Task: fine-tune Laya as Remit's own verdict engine at a 4k window; OpenRouter spend cap $5 (stop when account usage reaches $14.80; it was $9.80 at the start).

Status (2026-09-27): remit-laya-v1 is training in the background (`.laya/train-v1.log`, about 4 h). The data is from scripts/laya/build-trainset.ts. Restart with: `HF_HOME=$PWD/.laya/hf HF_HUB_OFFLINE=1 .venv-laya/bin/python -u scripts/laya/train.py --epochs 2 --accum 8 --checkpointing`. Then serve with scripts/laya/server.py (model remit-laya) and evaluate with config/remit-laya.remit.yml. OpenRouter spend so far: $0.

Next action:
1. Reference system: A (single pass, Sonnet 5) plus deterministic facts (docs/eval-results-abc.md). Laya training is paused: Stage A failed its gate (E2). B's extra components are not demonstrated.
2. Next experiment: fix A's defect-type errors (missing reported as contradicted) with an explicit "implemented anywhere in the diff?" step, and A's false findings on done requirements. Evaluate on the held-out dev seeds (cached predictions exist in eval/results/abc-2026-09-27).
3. Build an adjudicated clean-PR set (PAIChecker's SWE-bench Verified labels) to measure specificity on real code. The 9/30 gold flags are unadjudicated.
4. OpenRouter spend: $3.54 of $5 (stop when account usage reaches $14.80). The final test (3 mutation test seeds) is untouched.
