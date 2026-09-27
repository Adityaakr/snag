"""Controlled Laya experiment on checked matched pairs (training/laya/pairs/pairs.jsonl).

Declared protocol (no tuning on validation):
  - train on the training seeds' pairs for a FIXED number of full-batch steps; no augmentation, no dropout, no
    weight decay; the validation curve is reported, never used to pick a checkpoint;
  - compare the shipped checkpoint and the fine-tuned one on the SAME validation pairs (unseen codebases);
  - metrics: per-class accuracy, pair accuracy (both members right), pair ordering (the defective member scores as
    more defective than the implemented one), per seed; plus training fit (memorisation, mechanics only).

Run: .venv-laya/bin/python scripts/laya/pairs_experiment.py --stages A [--qids coverage] [--steps 60]
"""

from __future__ import annotations

import argparse
import json
import os
import random
from collections import defaultdict

import torch
import torch.nn.functional as F

from laya.agent import Agent
from laya.common import QTYPES, build_sequence

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SNAP = os.path.join(
    ROOT, ".laya/hf/hub/models--convaiinnovations--laya/snapshots/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/typed-decisions"
)
p = argparse.ArgumentParser()
p.add_argument("--stages", default="A")
p.add_argument("--qids", default="coverage,conflict")
p.add_argument("--steps", type=int, default=60)
p.add_argument("--freeze", type=int, default=22)
p.add_argument("--lr-head", type=float, default=1e-4)
p.add_argument("--lr-enc", type=float, default=2e-5)
p.add_argument("--max-len", type=int, default=4096)
p.add_argument("--seed", type=int, default=0)
p.add_argument("--tag", default="")
args = p.parse_args()
torch.manual_seed(args.seed)
random.seed(args.seed)
device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

stages, qids = set(args.stages.split(",")), set(args.qids.split(","))
rows = [json.loads(l) for l in open(os.path.join(ROOT, "training/laya/pairs/pairs.jsonl"))]
rows = [r for r in rows if r["stage"] in stages and r["qid"] in qids]
agent = Agent(SNAP, device="cpu")
tok, model = agent.tok, agent.model.float()
for m in model.modules():
    if isinstance(m, torch.nn.Dropout):
        m.p = 0.0


def encode(r):
    q = Agent._to_internal(r["question"])
    seq, markers = build_sequence(tok, r["state"], q, args.max_len, 512)
    t = r["target"]
    target = [1 - t["noul"], t["noul"]] if q["t"] == "noul" else [t["probabilities"].get(str(i), 0.0) for i in range(len(q["crit"]))]
    if len(markers) != len(target):
        return None
    return {**r, "ids": seq, "markers": markers, "qtype": QTYPES[q["t"]], "tvec": target}


items = [e for e in (encode(r) for r in rows) if e]
train = [e for e in items if e["split"] == "train"]
val = [e for e in items if e["split"] == "val"]
print(f"examples: train {len(train)} val {len(val)} (dropped {len(rows) - len(items)} over the option budget)", flush=True)
if not train or not val:
    raise SystemExit("empty split: nothing to measure")


def collate(batch):
    n, L = len(batch), -(-max(len(e["ids"]) for e in batch) // 256) * 256
    k = -(-max(len(e["markers"]) for e in batch) // 8) * 8
    ids = torch.full((n, L), tok.pad_token_id, dtype=torch.long)
    att = torch.zeros((n, L), dtype=torch.long)
    mpos = torch.zeros((n, k), dtype=torch.long)
    mmask = torch.zeros((n, k), dtype=torch.bool)
    tgt = torch.zeros((n, k))
    for i, e in enumerate(batch):
        ids[i, : len(e["ids"])] = torch.tensor(e["ids"])
        att[i, : len(e["ids"])] = 1
        mpos[i, : len(e["markers"])] = torch.tensor(e["markers"])
        mmask[i, : len(e["markers"])] = True
        tgt[i, : len(e["tvec"])] = torch.tensor(e["tvec"])
    qt = torch.tensor([e["qtype"] for e in batch])
    return ids.to(device), att.to(device), mpos.to(device), mmask.to(device), qt.to(device), tgt.to(device)


def logits(b):
    ids, att, mpos, mmask, qt, _ = b
    with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=device.type == "mps"):
        lg, _ = model(ids, att, mpos, mmask, qt)
    return lg.float().masked_fill(~mmask, -1e4)


@torch.no_grad()
def predict(examples):
    model.eval()
    out = {}
    for i in range(0, len(examples), 4):
        batch = examples[i : i + 4]
        lg = logits(collate(batch)).cpu()
        for j, e in enumerate(batch):
            out[(e["pair"], e["kind"])] = F.softmax(lg[j, : len(e["markers"])], -1)
    model.train()
    return out


def defect_score(e, pr):
    """How defective the model thinks the example is: P(not Full) for coverage, P(yes) for conflict."""
    return 1 - pr[3].item() if e["qid"] == "coverage" else pr[1].item()


def measure(examples, preds):
    per_class = defaultdict(lambda: [0, 0])
    per_seed = defaultdict(lambda: [0, 0])
    pairs = defaultdict(dict)
    for e in examples:
        pr = preds[(e["pair"], e["kind"])]
        ok = int(pr.argmax().item() == int(torch.tensor(e["tvec"]).argmax().item()))
        c = per_class[f"{e['qid']}={e['rubric']}"]
        c[0] += 1
        c[1] += ok
        pairs[e["pair"]][e["kind"]] = (ok, defect_score(e, pr), e["seed"])
    both = order = n = 0
    for pr in pairs.values():
        if "implemented" in pr and "defective" in pr:
            n += 1
            both += pr["implemented"][0] and pr["defective"][0]
            order += pr["defective"][1] > pr["implemented"][1]
            s = per_seed[pr["defective"][2]]
            s[0] += 1
            s[1] += pr["defective"][1] > pr["implemented"][1]
    return {
        "per_class_accuracy": {k: f"{v[1]}/{v[0]}" for k, v in sorted(per_class.items())},
        "pair_accuracy": f"{both}/{n}",
        "pair_ordering": f"{order}/{n}",
        "ordering_by_seed": {k: f"{v[1]}/{v[0]}" for k, v in sorted(per_seed.items())},
    }


model.to(device)
for prm in model.encoder.embeddings.parameters():
    prm.requires_grad = False
for i, layer in enumerate(model.encoder.layers):
    for prm in layer.parameters():
        prm.requires_grad = i >= args.freeze
model.encoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
model.head_checkpointing = True

results = {"config": vars(args), "train_examples": len(train), "val_examples": len(val)}
results["base"] = {"train": measure(train, predict(train)), "val": measure(val, predict(val))}
print("BASE val:", json.dumps(results["base"]["val"]), flush=True)
enc = [q for n, q in model.named_parameters() if q.requires_grad and n.startswith("encoder.")]
head = [q for n, q in model.named_parameters() if q.requires_grad and not n.startswith("encoder.")]
opt = torch.optim.AdamW([{"params": enc, "lr": args.lr_enc}, {"params": head, "lr": args.lr_head}], weight_decay=0.0)
curve = []
for step in range(1, args.steps + 1):
    random.shuffle(train)
    opt.zero_grad(set_to_none=True)
    total = 0.0
    for i in range(0, len(train), 4):
        b = collate(train[i : i + 4])
        loss = (-(b[5] * F.log_softmax(logits(b), -1)).sum(-1)).sum() / len(train)
        loss.backward()
        total += loss.item()
    torch.nn.utils.clip_grad_norm_([*enc, *head], 1.0)
    opt.step()
    if device.type == "mps":
        torch.mps.empty_cache()
    if step % 20 == 0 or step == args.steps:
        v = measure(val, predict(val))
        t = measure(train, predict(train))
        curve.append({"step": step, "loss": round(total, 4), "train": t, "val": v})
        print(f"step {step} loss {total:.4f} train pairs {t['pair_accuracy']} val {json.dumps(v)}", flush=True)
results["curve"] = curve
results["final"] = curve[-1]
name = args.tag or f"stage{args.stages.replace(',', '')}-{args.qids.replace(',', '+')}-s{args.seed}"
json.dump(results, open(os.path.join(ROOT, "training/laya/pairs", f"results-{name}.json"), "w"), indent=1)
print(f"saved training/laya/pairs/results-{name}.json", flush=True)
