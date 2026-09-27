#!/usr/bin/env bash
# Evaluates remit-laya end to end (DECISIONS D35). Starts the local engine, then runs:
#   1. golden, live engine, scripted extraction ($0: isolates the verdict engine)
#   2. mutations dev, live engine (task-list extraction, $0), all seeds and the held-out seeds
#   3. swebench dev, live engine, Sonnet extraction, hard-capped by EVAL_MAX_USD
#   4. optionally (FINAL=1) the frozen mutations test split once, with the single_pass baseline
# OpenRouter spend is printed before and after from the account's credits endpoint.
set -euo pipefail
cd "$(dirname "$0")/../.."
export HF_HOME="$PWD/.laya/hf" HF_HUB_OFFLINE=1 LAYA_DEVICE=mps LAYA_MAX_LEN=4096
export REMIT_JEV_BASE_URL=http://127.0.0.1:8765
CFG=config/remit-laya.remit.yml
LOG=.laya/eval-$(date +%Y%m%d-%H%M%S).log

spend() {
  node -e 'process.loadEnvFile(".env");fetch("https://openrouter.ai/api/v1/credits",{headers:{authorization:"Bearer "+process.env.OPENAI_COMPATIBLE_API_KEY}}).then(r=>r.json()).then(j=>console.log((j.data??j).total_usage))'
}

if ! curl -sf -m 2 http://127.0.0.1:8765/health >/dev/null; then
  .venv-laya/bin/python scripts/laya/server.py > .laya/server.log 2>&1 &
  for _ in $(seq 1 90); do curl -sf -m 2 http://127.0.0.1:8765/health >/dev/null && break; sleep 2; done
fi
curl -sf http://127.0.0.1:8765/health | tee -a "$LOG"; echo | tee -a "$LOG"
echo "openrouter usage before: $(spend)" | tee -a "$LOG"

echo "== golden (scripted extraction)" | tee -a "$LOG"
OPENAI_COMPATIBLE_API_KEY= REMIT_CACHE_MODE=live pnpm -s remit eval golden --mode live --config "$CFG" 2>&1 | grep -v '^\$' | tail -25 | tee -a "$LOG" || true

echo "== mutations dev" | tee -a "$LOG"
REMIT_CACHE_MODE=live pnpm -s remit eval mutations --split dev --mode live --config "$CFG" 2>&1 | grep -v '^\$' | tail -3 | tee -a "$LOG" || true

echo "== swebench dev (limit ${SWE_LIMIT:-60}, cap \$${SWE_MAX_USD:-1.2})" | tee -a "$LOG"
EVAL_MAX_USD=${SWE_MAX_USD:-1.2} pnpm -s remit eval swebench --split dev --mode live --limit "${SWE_LIMIT:-60}" --config "$CFG" 2>&1 | grep -v '^\$' | tail -3 | tee -a "$LOG" || true

if [ "${FINAL:-0}" = "1" ]; then
  echo "== mutations TEST (frozen, once) with single_pass" | tee -a "$LOG"
  EVAL_MAX_USD=${TEST_MAX_USD:-1.5} REMIT_CACHE_MODE=live pnpm -s remit eval mutations --split test --gate --mode live --baseline single_pass --config "$CFG" 2>&1 | grep -v '^\$' | tail -3 | tee -a "$LOG" || true
fi
echo "openrouter usage after: $(spend)" | tee -a "$LOG"
echo "log: $LOG"
