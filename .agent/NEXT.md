# Next

Milestone: M10 Eval-driven improvement (branch feat/laya-engine)
Task: fine-tune Laya as Remit's own verdict engine at a 4k window; OpenRouter spend cap $5 (stop when account usage reaches $14.80; it was $9.80 at the start).

Status (2026-09-27): remit-laya-v1 is training in the background (`.laya/train-v1.log`, about 4 h). The data is from scripts/laya/build-trainset.ts. Restart with: `HF_HOME=$PWD/.laya/hf HF_HUB_OFFLINE=1 .venv-laya/bin/python -u scripts/laya/train.py --epochs 2 --accum 8 --checkpointing`. Then serve with scripts/laya/server.py (model remit-laya) and evaluate with config/remit-laya.remit.yml. OpenRouter spend so far: $0.

Next action:
1. WAIT for the user's review of training/laya/README.md (strategy and data). Do not run any fine-tuning until they approve.
2. When approved: plan step 1 (fix the training mechanics with the 16-example memorization check), then step 2 (focused diagnostic with its gate), per training/laya/README.md.
3. Open: strategy A (`single_pass`) fails with HTTP 400 on the JSON tuple in its schema; fix it (line ranges as an object) before the final test.
4. OpenRouter spend: $1.81 of $5 (stop when account usage reaches $14.80).
