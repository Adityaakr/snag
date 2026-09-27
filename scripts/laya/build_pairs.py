"""Builds the checked matched-pair set for the controlled Laya experiment (training/laya/pairs/).

Every pair is (implemented state, defective state) for the SAME requirement of the SAME seed, taken from Remit's own
pipeline states (.laya/data/records.jsonl, recorded by OracleJev): the implemented state from the seed's clean PR, the
defective state from the item whose mutation targeted that requirement. Only the relevant code differs.

Labels come from the rubric audit (training/laya/audit/label-audit-all.jsonl), never from the mutation operator:
  done -> coverage Full(3), conflict no; missing -> coverage None(0), conflict no; partial -> coverage Most(2);
  contradicted -> conflict yes (no coverage target); ambiguous -> excluded (reported).
Splits are by seed (codebase): validation = the held-out seeds; the frozen test seeds never appear.

Run: python3 scripts/laya/build_pairs.py
"""

from __future__ import annotations

import json
import os
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VAL_SEEDS = {"py-retry-backoff", "rs-semver-compare"}
TEST_SEEDS = {"py-order-date-ranges", "rs-lru-cache", "ts-list-pagination"}
OUT = os.path.join(ROOT, "training", "laya", "pairs")

records = [json.loads(l) for l in open(os.path.join(ROOT, ".laya", "data", "records.jsonl"))]
audit = {}
for l in open(os.path.join(ROOT, "training", "laya", "audit", "label-audit-all.jsonl")):
    a = json.loads(l)
    audit[(a["item"].split("/")[-1], a["requirement"])] = a

# The pipeline's forward state and question text per (item, requirement, question).
# One forward call answers coverage and conflict from the same state; the oracle records that state under whichever
# questions it labels, so any forward record of (item, requirement) gives the state.
state = {}
question = {}
for r in records:
    if r["call"] != "forward":
        continue
    state.setdefault((r["itemId"].split("/")[-1], r["targetId"]), r["state"])
    if r["qid"] in ("coverage", "conflict"):
        question.setdefault(r["qid"], r["question"])

COVERAGE = {"done": "3", "missing": "0", "partial": "2"}
examples, excluded = [], Counter()
for (item, req), a in sorted(audit.items()):
    seed = item.split(".")[0]
    if seed in TEST_SEEDS:
        raise SystemExit(f"refusing: {item} is a test seed")
    rubric = a["rubric"]
    if rubric == "ambiguous":
        excluded["ambiguous"] += 1
        continue
    clean = f"{seed}.clean"
    for qid in ("coverage", "conflict"):
        bad_state = state.get((item, req))
        good_state = state.get((clean, req))
        if bad_state is None or good_state is None:
            excluded[f"no {qid} state recorded"] += 1
            continue
        if qid == "coverage":
            if rubric not in COVERAGE:
                continue  # contradicted: no coverage target
            bad_target = {"probabilities": {COVERAGE[rubric]: 1.0}}
            good_target = {"probabilities": {"3": 1.0}}
            stage = "A" if rubric == "missing" else "B"
        else:
            bad_target = {"noul": 1.0 if rubric == "contradicted" else 0.0}
            good_target = {"noul": 0.0}
            stage = "B" if rubric == "contradicted" else "A"
        pair = f"{item}|{req}|{qid}"
        split = "val" if seed in VAL_SEEDS else "train"
        for kind, st, tgt in (("implemented", good_state, good_target), ("defective", bad_state, bad_target)):
            examples.append(
                {
                    "pair": pair,
                    "kind": kind,
                    "seed": seed,
                    "split": split,
                    "stage": stage,
                    "qid": qid,
                    "rubric": "done" if kind == "implemented" else rubric,
                    "source_item": clean if kind == "implemented" else item,
                    "requirement": req,
                    "question": question[qid],
                    "state": st,
                    "target": tgt,
                    "audit_evidence": None if kind == "implemented" else a.get("evidence"),
                }
            )

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "pairs.jsonl"), "w") as fh:
    for e in examples:
        fh.write(json.dumps(e) + "\n")
summary = defaultdict(Counter)
for e in examples:
    summary[f"{e['split']} stage {e['stage']} {e['qid']}"][e["rubric"]] += 1
report = {k: dict(v) for k, v in sorted(summary.items())}
report["excluded"] = dict(excluded)
report["pairs"] = len({e["pair"] for e in examples})
report["seeds"] = sorted({e["seed"] for e in examples})
json.dump(report, open(os.path.join(OUT, "summary.json"), "w"), indent=1)
print(json.dumps(report, indent=1))
