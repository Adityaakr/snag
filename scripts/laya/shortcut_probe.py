"""Shortcut detection for remit-laya training data (DECISIONS D35).

Predicts each question's answer class from superficial features only (no code semantics):
candidate count, whether any unit comes from another seed, language mix, total and max unit length, file count,
position of the first unit, and requirement length. A logistic regression is fit on train and scored on val,
per question, against the majority-class baseline. Strong accuracy from these features means the data leaks the
answer; it is a reason to fix the data, never evidence that the task is easy.

Run: .venv-laya/bin/python scripts/laya/shortcut_probe.py <export dir with train.jsonl(.gz) and val.jsonl(.gz)>
"""

from __future__ import annotations

import gzip
import json
import os
import sys
from collections import Counter, defaultdict

import torch

d = sys.argv[1]


def load(name):
    path = os.path.join(d, name + ".jsonl")
    fh = gzip.open(path + ".gz", "rt") if os.path.exists(path + ".gz") else open(path)
    return [json.loads(l) for l in fh]


def lang(f):
    return {"py": 0, "ts": 1, "rs": 2}.get((f or "").rsplit(".", 1)[-1], 3)


def features(r, seed_langs):
    st = r["state"]
    units = st.get("candidates", st.get("tests", [])) if isinstance(st, dict) else []
    langs = [lang(u.get("file")) for u in units]
    home = seed_langs.get(r["seedId"], -1)
    foreign = sum(1 for l in langs if l != home)
    lens = [len(u.get("change", "")) for u in units] or [0]
    req = st.get("requirement", {}) if isinstance(st, dict) else {}
    return [
        len(units),
        float(foreign > 0),
        foreign / max(1, len(units)),
        len(set(langs)),
        sum(lens) / 1000,
        max(lens) / 1000,
        len({u.get("file") for u in units}),
        len(str(req.get("text", ""))) / 100,
    ]


rows = {"train": load("train"), "val": load("val")}
seed_langs = {}
for r in rows["train"] + rows["val"]:
    seed_langs.setdefault(r["seedId"], {"py": 0, "ts": 1, "rs": 2}[r["seedId"].split("-")[0]])

print(f"{'question':28s} {'n_val':>5s} {'majority':>8s} {'shallow':>8s} {'lift':>6s}")
for key in sorted({r["question_key"] for r in rows["train"]}):
    tr = [r for r in rows["train"] if r["question_key"] == key]
    va = [r for r in rows["val"] if r["question_key"] == key]
    classes = sorted({r["answer_class"] for r in tr + va})
    if len(classes) < 2 or not va:
        continue
    idx = {c: i for i, c in enumerate(classes)}
    Xtr = torch.tensor([features(r, seed_langs) for r in tr])
    Xva = torch.tensor([features(r, seed_langs) for r in va])
    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-6
    Xtr, Xva = (Xtr - mu) / sd, (Xva - mu) / sd
    ytr = torch.tensor([idx[r["answer_class"]] for r in tr])
    yva = torch.tensor([idx[r["answer_class"]] for r in va])
    lin = torch.nn.Linear(Xtr.shape[1], len(classes))
    opt = torch.optim.LBFGS(lin.parameters(), max_iter=200)

    def closure():
        opt.zero_grad()
        loss = torch.nn.functional.cross_entropy(lin(Xtr), ytr) + 1e-3 * lin.weight.pow(2).sum()
        loss.backward()
        return loss

    opt.step(closure)
    acc = (lin(Xva).argmax(1) == yva).float().mean().item()
    maj = Counter(yva.tolist()).most_common(1)[0][1] / len(yva)
    print(f"{key:28s} {len(va):5d} {maj:8.3f} {acc:8.3f} {acc - maj:+6.3f}")
