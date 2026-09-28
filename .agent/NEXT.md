# Next

Milestone: M10 Eval-driven improvement (branch feat/laya-engine)
Task: fine-tune Laya as Remit's own verdict engine at a 4k window; OpenRouter spend cap $5 (stop when account usage reaches $14.80; it was $9.80 at the start).

Status (2026-09-27): remit-laya-v1 is training in the background (`.laya/train-v1.log`, about 4 h). The data is from scripts/laya/build-trainset.ts. Restart with: `HF_HOME=$PWD/.laya/hf HF_HUB_OFFLINE=1 .venv-laya/bin/python -u scripts/laya/train.py --epochs 2 --accum 8 --checkpointing`. Then serve with scripts/laya/server.py (model remit-laya) and evaluate with config/remit-laya.remit.yml. OpenRouter spend so far: $0.

Next action:
1. The plan is docs/plan-to-target.md. Waiting on the human for: API budget, GITHUB_TOKEN, reviewer time, pilot repositories, and a scope decision.
2. Local work without waiting: relabel the mutation corpus by the rubric (training/laya/audit/label-audit-all.jsonl) and make the generator derive labels from code, with tests; integrate PAIChecker labels if they download without credentials; build the planted-defect test for the fix-path hypothesis.
3. Laya: E7 failed (no transfer to unseen codebases); fine-tuning is paused.
4. OpenRouter spend: $4.07 of $5. The frozen final test is untouched.
