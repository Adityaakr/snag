# Next

Milestone: M10 Eval-driven improvement (branch feat/laya-engine)
Task: fine-tune Laya as Remit's own verdict engine at a 4k window; OpenRouter spend cap $5 (stop when account usage reaches $14.80; it was $9.80 at the start).

Status (2026-09-27): remit-laya-v1 is training in the background (`.laya/train-v1.log`, about 4 h). The data is from scripts/laya/build-trainset.ts. Restart with: `HF_HOME=$PWD/.laya/hf HF_HUB_OFFLINE=1 .venv-laya/bin/python -u scripts/laya/train.py --epochs 2 --accum 8 --checkpointing`. Then serve with scripts/laya/server.py (model remit-laya) and evaluate with config/remit-laya.remit.yml. OpenRouter spend so far: $0.

Next action:
1. Candidate: A + deterministic facts + E4 (docs/eval-results-strict.md). 99% acceptance fails on every metric. Laya training is paused.
2. Next experiment (free first): a fix-path definition of "explained" for unit findings (a changed region on the call path of cited evidence code is explained). Evaluate on cached predictions with scripts/eval/swebench-findings.ts and scripts/eval/compare.ts before any new predictions.
3. Open: E5 (sp-0.3.0) is untested on the mutation set (about $0.90); B is measured on 7 items only; the training seeds probably share the operator-name labelling error (audit before any Laya retraining).
4. OpenRouter spend: $4.07 of $5. The frozen final test is untouched.
