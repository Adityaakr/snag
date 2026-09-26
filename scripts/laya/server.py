"""A local Jev-compatible verdict engine backed by Laya (DECISIONS D34).

Serves POST /v1/systemone with TypeSafe's request and response shapes, so Remit's LiveJev client talks to it
through REMIT_JEV_BASE_URL. It differs from `laya-serve` in three ways that matter for Remit:

- The token window is configurable (LAYA_MAX_LEN, default 4096), up to the encoder's 8192 positions.
- A request whose state and question do not fit the window is rejected with 400 max_tokens_exceeded instead of
  being truncated silently, so Remit shrinks the context itself rather than judging code the model never saw.
- The `model` field picks a checkpoint by name (laya, laya-typed-decisions, laya-multilingual), and the response
  reports that name with the snapshot, so calibration and cassettes are keyed by the real model.

Binds to 127.0.0.1 only. No request content is logged.

Run: .venv-laya/bin/python scripts/laya/server.py   (see docs/laya.md)
"""

from __future__ import annotations

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
import uvicorn

from laya.router import Router

CHECKPOINTS = {
    "laya": "english",
    "laya-english": "english",
    "laya-typed-decisions": "typed-decisions",
    "laya-multilingual": "multilingual",
}
DEFAULT_MODEL = os.environ.get("LAYA_MODEL", "laya-typed-decisions")
MAX_LEN = int(os.environ.get("LAYA_MAX_LEN", "4096"))
MAX_QUESTIONS = 64
MAX_BODY_BYTES = 4 * 1024 * 1024

if not 128 <= MAX_LEN <= 8192:
    raise SystemExit("LAYA_MAX_LEN must be between 128 and 8192")

router = Router(device=os.environ.get("LAYA_DEVICE") or None, preload=True, max_loaded=3)

# Remit's own fine-tuned checkpoint (scripts/laya/train.py, DECISIONS D35), served as `remit-laya`. The router only
# knows its built-in names, so this one is a direct Agent with its own window and option budget from its config.
REMIT_DIR = os.environ.get("LAYA_REMIT_DIR") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", ".laya", "remit-laya-v1"
)
remit_agent = None
if os.path.exists(os.path.join(REMIT_DIR, "model.safetensors")):
    from laya.agent import Agent

    remit_agent = Agent(os.path.abspath(REMIT_DIR), device=os.environ.get("LAYA_DEVICE") or None)
    CHECKPOINTS["remit-laya"] = "remit"
REMIT_HEAD = int(remit_agent.cfg.get("head_max_len", 512)) if remit_agent else 512
pool = ThreadPoolExecutor(max_workers=1)
gate = asyncio.Lock()
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def overflow(detail: str) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": {"type": "max_tokens_exceeded", "message": detail}})


def resolve(model: Any) -> str:
    name = str(model or DEFAULT_MODEL).strip().lower()
    if name not in CHECKPOINTS:
        raise HTTPException(status_code=400, detail=f"unknown model {name!r}; use one of {sorted(CHECKPOINTS)}")
    return name


def snapshot() -> str:
    try:
        from huggingface_hub import scan_cache_dir

        for repo in scan_cache_dir().repos:
            if repo.repo_id == "convaiinnovations/laya":
                return sorted(r.commit_hash for r in repo.revisions)[-1][:8]
    except Exception:  # noqa: BLE001
        pass
    return "unknown"


SNAPSHOT = snapshot()


def fits(key: str, state: Any, questions: Dict[str, Any]) -> str | None:
    """Returns a reason when any question would be truncated at MAX_LEN, else None."""
    from laya.common import serialize_state

    agent = remit_agent if key == "remit" else router.load(key)
    tok = agent.tok
    state_tokens = len(tok(serialize_state(state), add_special_tokens=False)["input_ids"])
    for qid, q in questions.items():
        text = f"{q.get('instructions') or ''} {q.get('criteria') or ''}"
        q_tokens = len(tok(text, add_special_tokens=False)["input_ids"])
        # Special tokens and option markers: a small fixed margin.
        if state_tokens + q_tokens + 16 > MAX_LEN:
            return f"state {state_tokens} + question {qid} {q_tokens} tokens exceed max_len {MAX_LEN}"
    return None


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "max_len": MAX_LEN,
        "default_model": DEFAULT_MODEL,
        "snapshot": SNAPSHOT,
        "remit_laya": os.path.abspath(REMIT_DIR) if remit_agent else None,
    }


@app.get("/v1/models")
def models() -> Dict[str, Any]:
    return {"data": [{"name": f"{m}@{SNAPSHOT}", "max_len": MAX_LEN} for m in sorted(CHECKPOINTS)]}


@app.post("/v1/systemone")
async def systemone(request: Request):
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="request too large")
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="request body must be valid JSON")
    questions = body.get("questions") if isinstance(body, dict) else None
    if not isinstance(questions, dict) or not questions:
        raise HTTPException(status_code=400, detail="'questions' must be a non-empty object")
    if len(questions) > MAX_QUESTIONS:
        raise HTTPException(status_code=400, detail=f"too many questions ({len(questions)} > {MAX_QUESTIONS})")
    name = resolve(body.get("model"))
    key = CHECKPOINTS[name]
    state = body.get("state")
    loop = asyncio.get_running_loop()
    async with gate:
        try:
            reason = await loop.run_in_executor(pool, lambda: fits(key, state, questions))
            if reason:
                return overflow(reason)
            if key == "remit":
                result = await loop.run_in_executor(
                    pool,
                    lambda: remit_agent.system_one(state, questions, max_len=MAX_LEN, head_max_len=REMIT_HEAD),
                )
            else:
                result = await loop.run_in_executor(
                    pool, lambda: router.predict(state, questions, model=key, max_len=MAX_LEN)
                )
        except HTTPException:
            raise
        except ValueError as e:
            text = str(e)
            if "exceed" in text or "max_len" in text:
                return overflow(text)
            raise HTTPException(status_code=422, detail=text)
        except Exception:  # noqa: BLE001 -- never leak paths or weights to clients
            raise HTTPException(status_code=500, detail="inference failed")
    version = remit_agent.cfg.get("model_name", "remit-laya") if key == "remit" else SNAPSHOT
    return {
        "model": f"{name}@{version}",
        "answers": result["answers"],
        "usage": {"input_tokens": int(result.get("usage", {}).get("input_tokens", 0)), "output_tokens": 0},
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("LAYA_PORT", "8765")), log_level="warning")
