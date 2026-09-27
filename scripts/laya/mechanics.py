"""Training-mechanics diagnostic for remit-laya (DECISIONS D35). Proves the trainer can learn; says nothing about quality.

Trains on training/laya/mechanics/examples.jsonl (hand-written, unambiguous, matched pairs) with no augmentation, no
dropout and no weight decay, and instruments every step of the path:
  - which parameters require gradients and are in the optimizer;
  - gradient norms by component, and the actual parameter updates;
  - marker positions against the tokenizer's [MASK] id, and option order against target order;
  - logit sensitivity to matched input changes (same requirement, correct vs defective code);
  - fp32 against the bf16 autocast path (--dtype);
  - identical decisions after save and reload.

Gate: 100% fit on the examples, correct decisions on every matched pair, identical decisions after reload.

Run: .venv-laya/bin/python scripts/laya/mechanics.py [--freeze 22] [--lr-head 1e-4] [--lr-enc 2e-5] [--dtype bf16]
"""

from __future__ import annotations

import argparse
import json
import os
import random
import tempfile
from collections import defaultdict

import torch
import torch.nn.functional as F

from laya.agent import Agent
from laya.common import QTYPES, build_sequence, render_options

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SNAP = os.path.join(
    ROOT, ".laya/hf/hub/models--convaiinnovations--laya/snapshots/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/typed-decisions"
)

p = argparse.ArgumentParser()
p.add_argument("--freeze", type=int, default=22, help="freeze embeddings and the first N encoder layers (0 = train all)")
p.add_argument("--lr-head", type=float, default=1e-4)
p.add_argument("--lr-enc", type=float, default=2e-5)
p.add_argument("--steps", type=int, default=60)
p.add_argument("--dtype", choices=["fp32", "bf16"], default="fp32")
p.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
p.add_argument("--seed", type=int, default=0)
p.add_argument("--checkpointing", action="store_true", help="reproduce train.py: encoder and head gradient checkpointing")
p.add_argument("--pad-buckets", action="store_true", help="reproduce train.py: pad lengths to 256 and options to 8")
p.add_argument("--dropout", action="store_true", help="keep the checkpoint's dropout (train.py default)")
args = p.parse_args()
torch.manual_seed(args.seed)
random.seed(args.seed)
device = torch.device(args.device)

agent = Agent(SNAP, device="cpu")
tok, model = agent.tok, agent.model.float()
if not args.dropout:
    for m in model.modules():  # no dropout: the fit must be deterministic
        if isinstance(m, torch.nn.Dropout):
            m.p = 0.0

rows = [json.loads(l) for l in open(os.path.join(ROOT, "training/laya/mechanics/examples.jsonl"))]
items = []
for r in rows:
    q = Agent._to_internal(r["question"])
    seq, markers = build_sequence(tok, r["state"], q, 1024, 512)
    opts = render_options(q)
    assert len(markers) == len(opts), f"{r['id']}: {len(markers)} markers for {len(opts)} options"
    assert all(seq[m] == tok.mask_token_id for m in markers), f"{r['id']}: a marker is not on a [MASK] token"
    t = r["target"]
    if q["t"] == "noul":
        assert opts[0].lower().startswith("false") or "not" in opts[0].lower() or opts[0].split(":")[0].lower() in ("no", "false"), opts
        target = [1 - t["noul"], t["noul"]]
    else:
        target = [t["probabilities"].get(str(i), 0.0) for i in range(len(q["crit"]))]
    items.append({"id": r["id"], "ids": seq, "markers": markers, "qtype": QTYPES[q["t"]], "target": target})
print(f"{len(items)} examples; markers on [MASK] and option order checked; noul options = {render_options(Agent._to_internal(rows[0]['question']))[:1]}...")


def collate(batch):
    n, L, k = len(batch), max(len(e["ids"]) for e in batch), max(len(e["markers"]) for e in batch)
    if args.pad_buckets:
        L, k = -(-L // 256) * 256, -(-k // 8) * 8
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
        tgt[i, : len(e["target"])] = torch.tensor(e["target"])
    qt = torch.tensor([e["qtype"] for e in batch])
    return ids.to(device), att.to(device), mpos.to(device), mmask.to(device), qt.to(device), tgt.to(device)


def forward(mdl, b):
    ids, att, mpos, mmask, qt, _ = b
    with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=args.dtype == "bf16"):
        logits, _ = mdl(ids, att, mpos, mmask, qt)
    return logits.float().masked_fill(~mmask, -1e4)


def predictions(mdl):
    mdl.eval()
    out = {}
    with torch.no_grad():
        for i in range(0, len(items), 8):
            batch = items[i : i + 8]
            lg = forward(mdl, collate(batch)).cpu()
            for j, e in enumerate(batch):
                pr = F.softmax(lg[j, : len(e["markers"])], -1)
                out[e["id"]] = pr
    mdl.train()
    return out


def score(preds):
    fit = sum(int(preds[e["id"]].argmax() == torch.tensor(e["target"]).argmax()) for e in items)
    return fit


def component(name):
    if name.startswith("encoder.layers."):
        return f"encoder.L{int(name.split('.')[2]):02d}"
    return name.split(".")[0] if not name.startswith("encoder.") else "encoder.other"


model.to(device)
if args.checkpointing:
    model.encoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.head_checkpointing = True
for prm in model.encoder.embeddings.parameters():
    prm.requires_grad = args.freeze == 0 and True
for i, layer in enumerate(model.encoder.layers):
    for prm in layer.parameters():
        prm.requires_grad = i >= args.freeze
trainable = defaultdict(int)
for n, prm in model.named_parameters():
    if prm.requires_grad:
        trainable[component(n)] += prm.numel()
print("trainable parameters by component:", {k: v for k, v in sorted(trainable.items())})

enc = [prm for n, prm in model.named_parameters() if prm.requires_grad and n.startswith("encoder.")]
head = [prm for n, prm in model.named_parameters() if prm.requires_grad and not n.startswith("encoder.")]
opt = torch.optim.AdamW([{"params": enc, "lr": args.lr_enc}, {"params": head, "lr": args.lr_head}], weight_decay=0.0)
in_opt = {id(p_) for g in opt.param_groups for p_ in g["params"]}
missing = [n for n, p_ in model.named_parameters() if p_.requires_grad and id(p_) not in in_opt]
print(f"optimizer holds {len(in_opt)} tensors; trainable tensors missing from it: {len(missing)}")

before = predictions(model)
print(f"before training: fit {score(before)}/{len(items)}")
pairs = [("404-correct", "404-wrong-status"), ("limit-inclusive", "limit-exclusive"), ("retry-3", "retry-5"),
         ("trim-name", "upper-name"), ("sort-desc", "sort-asc")]
for a, b in pairs:
    pa, pb = before[f"{a}/conflict"][1].item(), before[f"{b}/conflict"][1].item()
    print(f"  conflict P(yes): {a} {pa:.3f} vs {b} {pb:.3f} (sensitivity {pb - pa:+.3f})")

snapshot = {n: p_.detach().clone() for n, p_ in model.named_parameters() if p_.requires_grad}
model.train()
for step in range(1, args.steps + 1):
    random.shuffle(items)
    opt.zero_grad(set_to_none=True)
    total = 0.0
    for i in range(0, len(items), 8):
        b = collate(items[i : i + 8])
        lg = forward(model, b)
        loss = (-(b[5] * F.log_softmax(lg, -1)).sum(-1)).sum() / len(items)
        loss.backward()
        total += loss.item()
    if step in (1, 2) or step % 20 == 0:
        g = defaultdict(float)
        for n, p_ in model.named_parameters():
            if p_.grad is not None:
                g[component(n)] += p_.grad.float().norm().item() ** 2
        top = sorted(((k, v ** 0.5) for k, v in g.items()), key=lambda x: -x[1])[:6]
        print(f"step {step} loss {total:.4f} grad norms: " + ", ".join(f"{k} {v:.2e}" for k, v in top))
    opt.step()
    if step % 20 == 0 or step == args.steps:
        upd = defaultdict(float)
        for n, p_ in model.named_parameters():
            if n in snapshot:
                upd[component(n)] += (p_.detach() - snapshot[n]).float().norm().item() ** 2
        topu = sorted(((k, v ** 0.5) for k, v in upd.items()), key=lambda x: -x[1])[:4]
        now = predictions(model)
        print(f"  step {step}: fit {score(now)}/{len(items)}; cumulative update norms: " + ", ".join(f"{k} {v:.2e}" for k, v in topu))
        if score(now) == len(items):
            break

after = predictions(model)
print(f"after training: fit {score(after)}/{len(items)}")
bad = [e["id"] for e in items if after[e["id"]].argmax() != torch.tensor(e["target"]).argmax()]
print("  wrong:", bad or "none")
pair_ok = all(after[f"{a}/conflict"].argmax() == 0 and after[f"{b}/conflict"].argmax() == 1 for a, b in pairs)
for a, b in pairs:
    print(f"  conflict P(yes): {a} {after[f'{a}/conflict'][1]:.3f} vs {b} {after[f'{b}/conflict'][1]:.3f}")

with tempfile.TemporaryDirectory() as d:
    path = os.path.join(d, "m.pt")
    torch.save(model.state_dict(), path)
    fresh = Agent(SNAP, device="cpu").model.float()
    fresh.load_state_dict(torch.load(path, map_location="cpu"))
    fresh.to(device)
    for m in fresh.modules():
        if isinstance(m, torch.nn.Dropout):
            m.p = 0.0
    reloaded = predictions(fresh)
same = all(int(reloaded[k].argmax()) == int(after[k].argmax()) for k in after)
print(f"GATE fit {'PASS' if score(after) == len(items) else 'FAIL'} ({score(after)}/{len(items)}); "
      f"matched pairs {'PASS' if pair_ok else 'FAIL'}; reload {'PASS' if same else 'FAIL'}")
