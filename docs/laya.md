# Verdict engines without TypeSafe

Remit's verdicts come from typed questions (yes/no, choice, score) answered with a probability per option. TypeSafe's Jev is the default engine. Two alternatives exist, chosen with `jev.engine` in `.remit.yml` (DECISIONS D34).

## LLM engine (`jev.engine: llm`)

A generative LLM answers the same questions, all questions of one call in one structured request, through the extraction provider's credentials. It works with Anthropic directly or with any OpenAI-compatible endpoint such as OpenRouter.

```yaml
extraction:
  provider: openai_compatible
  model: anthropic/claude-opus-5.5
jev:
  engine: llm
  llm_model: anthropic/claude-sonnet-5   # defaults to extraction.model
```

`config/llm-jev.remit.yml` has a complete example. Use it with `--config config/llm-jev.remit.yml`.

- The model reports probabilities. Remit clips and renormalizes them, then validates them like Jev answers.
- Self-reported probabilities are less reliable than a trained classifier's, so fit calibration for this engine on dev (`pnpm remit calibrate --config ...`) before trusting confidences. Gate mode stays off without that evidence.
- Cost: about `$0.10` per small review with Sonnet 5 answering and Opus 5.5 extracting (golden `three_reqs_one_missing`: 16 calls, 27k input tokens). Much more than Jev's `$0.042` per million tokens.
- In the App, the Jev model needs an operator price in `REMIT_LLM_PRICES`, like the extraction model.

## Local Laya engine (`REMIT_JEV_BASE_URL`)

[Laya](https://github.com/NandhaKishorM/laya) is an open, Apache-2.0 typed-decision model (ModernBERT, 421M parameters) with Jev's API shape. `scripts/laya/server.py` wraps it:
- it speaks Jev's protocol at `/v1/systemone`;
- the token window is configurable;
- it rejects oversized requests instead of truncating them silently, so Remit shrinks the context itself.

```bash
python3.12 -m venv .venv-laya
.venv-laya/bin/python -m pip install "laya[serve]"
LAYA_DEVICE=mps LAYA_MAX_LEN=4096 HF_HOME=.laya/hf .venv-laya/bin/python scripts/laya/server.py
# then, for Remit:
REMIT_JEV_BASE_URL=http://127.0.0.1:8765 pnpm remit review ... --config config/laya.remit.yml
```

The first start downloads about 1 GB of weights into `.laya/hf`. `pnpm remit doctor` reports the engine and the checkpoint that answered.

**Not usable for Remit as shipped.** On the golden corpus (2026-09-27, `laya-typed-decisions`), answers barely moved with the code:
- coverage was `1.9` to `2.4` of `3` whether a requirement was done or missing;
- conflict was `0.55` to `0.64` whether the code matched the issue or contradicted it;
- golden accuracy was `1/18`.

Laya was trained on general text decisions, not on reading code against a spec. It remains the fast, free option if it is fine-tuned on Remit's labeled data, for example distilled from the LLM engine's answers on the dev split. See `.agent/EXPERIMENTS.md`.

## remit-laya: Remit's own fine-tuned checkpoint

`remit-laya` is Laya fine-tuned on Remit's own questions, at a 4,096-token window (DECISIONS D35).

1. **Data.** `pnpm exec tsx --conditions=source scripts/laya/build-trainset.ts` runs Remit's real pipeline on every mutation item in the **dev** split, with `OracleJev` (`packages/eval/src/oracle.ts`) answering.
   - Answers come from the item's labels and its seed's annotations.
   - A training example is recorded only for questions the labels decide.
   - It refuses test-split seeds, which live in `seeds/` outside guard:split.
   - Output: `.laya/data/records.jsonl` (about 4,300 examples, 3,300 unique).
2. **Train.** `HF_HOME=.laya/hf .venv-laya/bin/python -u scripts/laya/train.py --epochs 2 --accum 8 --checkpointing`:
   - Two dev seeds are held out for model selection and temperature fitting.
   - Forward and tests states are padded with other seeds' units, so answers are learned from about 800 up to 4,096 tokens, with the deciding unit at varied depths. RoPE is unchanged: ModernBERT was pretrained to 8,192 positions, and no sequence is ever truncated.
   - Loss: soft cross-entropy on Laya's option logits. The top 6 encoder layers and the head train; the rest is frozen. bf16 on the Apple GPU.
   - Shapes are bucketed so the MPS graph cache stays bounded.
   - Writes `.laya/remit-laya-v1/`: weights, encoder config, tokenizer, and `rl_agent_config.json` with fitted temperatures and provenance.
3. **Serve.** `scripts/laya/server.py` loads `.laya/remit-laya-v1` (or `LAYA_REMIT_DIR`) and answers for `model: remit-laya`.
4. **Use.** `REMIT_JEV_BASE_URL=http://127.0.0.1:8765 pnpm remit review ... --config config/remit-laya.remit.yml`.

On the Mac used here (Apple Silicon, 24 GB) training takes about 7 hours for 2 epochs. The checkpoint stays local (`.laya/` is gitignored); rebuild it with the two commands above.
