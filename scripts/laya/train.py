"""Fine-tunes Laya (typed-decisions checkpoint) into Remit's own verdict engine, `remit-laya` (DECISIONS D35).

Data: .laya/data/records.jsonl from scripts/laya/build-trainset.ts (mutation corpus DEV split only). Each record is
(state, question, target) for one of Remit's typed questions, built by Remit's real pipeline.

- Holdout by seed: VAL_SEEDS never train; they select the epoch and fit temperatures.
- Long context: forward and tests states get distractor candidates from other seeds, so answers are learned at
  512 to MAX_LEN tokens with the deciding evidence at varied depths. RoPE is unchanged (the encoder was pretrained to
  8192 positions); nothing is ever truncated: sequences that would not fit are dropped.
- Loss: soft cross-entropy over the option logits (Laya's readout), lower encoder layers frozen, bf16 autocast on MPS.
- Output: .laya/<name>/ with model.safetensors, encoder/, tokenizer/ and rl_agent_config.json, loadable by
  laya.agent.Agent and by scripts/laya/server.py (model name remit-laya).

Run: .venv-laya/bin/python scripts/laya/train.py [--epochs 3] [--max-steps N] [--name remit-laya-v1]
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import random
import shutil
import time
from collections import defaultdict

import torch
import torch.nn.functional as F
from safetensors.torch import save_file

from laya.agent import Agent
from laya.common import QTYPES, build_sequence, serialize_state

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SNAP = os.path.join(
    ROOT, ".laya/hf/hub/models--convaiinnovations--laya/snapshots/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/typed-decisions"
)
VAL_SEEDS = {"rs-semver-compare", "py-retry-backoff"}
CAPS = {("reverse", "serves"): 400}

p = argparse.ArgumentParser()
p.add_argument("--epochs", type=int, default=3)
p.add_argument("--max-steps", type=int, default=0, help="stop after N optimizer steps (smoke runs)")
p.add_argument("--max-len", type=int, default=4096)
p.add_argument("--head-max-len", type=int, default=512)
p.add_argument("--freeze", type=int, default=22, help="freeze embeddings and the first N encoder layers")
p.add_argument("--lr-enc", type=float, default=2e-5)
p.add_argument("--lr-head", type=float, default=1e-4)
p.add_argument("--accum", type=int, default=8)
p.add_argument("--long-variants", type=int, default=1, help="long-context copies per forward/tests record")
p.add_argument("--cap", type=int, default=250, help="max unique examples per question (train side)")
p.add_argument("--val-cap", type=int, default=80, help="max unique examples per question (validation side)")
p.add_argument("--checkpointing", action="store_true", help="gradient checkpointing (slower, less memory)")
p.add_argument("--dry-run", action="store_true", help="print the data balance and exit")
p.add_argument("--keys", default="", help="only these questions, e.g. forward.coverage,forward.conflict")
p.add_argument("--overfit", type=int, default=0, help="mechanics check: train and evaluate on the first N train items")
p.add_argument("--init", default="", help="start from this checkpoint directory instead of the shipped one")
p.add_argument("--eval-only", action="store_true", help="evaluate the (--init) checkpoint on validation and exit")
p.add_argument("--export", default="", help="write the final train/val examples (after twins, balancing and long-context padding) to this directory and exit")
p.add_argument("--ckpt-every", type=int, default=25, help="optimizer steps between resumable checkpoints")
p.add_argument("--resume", action="store_true", help="resume from .laya/runs/<name>/latest.pt")
p.add_argument("--name", default="remit-laya-v1")
p.add_argument("--seed", type=int, default=7)
args = p.parse_args()
random.seed(args.seed)
torch.manual_seed(args.seed)

device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
agent = Agent(os.path.abspath(args.init) if args.init else SNAP, device="cpu")
tok = agent.tok
model = agent.model.float()

# ---------------------------------------------------------------- data
raw = [json.loads(l) for l in open(os.path.join(ROOT, ".laya/data/records.jsonl")) if l.strip()]
# Frozen final test: refuse any record from a test-split seed (they must never reach training or validation).
TEST_SEEDS = {
    json.load(open(os.path.join(dp, "seed.json")))["id"]
    for dp in (os.path.join(ROOT, "eval/corpora/mutations/seeds", x) for x in os.listdir(os.path.join(ROOT, "eval/corpora/mutations/seeds")))
    if os.path.exists(os.path.join(dp, "seed.json")) and json.load(open(os.path.join(dp, "seed.json"))).get("split") == "test"
}
leaked = sorted({r["seedId"] for r in raw} & TEST_SEEDS)
if leaked:
    raise SystemExit(f"refusing to train: records from test seeds {leaked}")
seen, recs = set(), []
for r in raw:
    k = hashlib.sha1(
        (json.dumps(r["state"], sort_keys=True) + r["qid"] + json.dumps(r["question"], sort_keys=True)).encode()
    ).hexdigest()
    if k not in seen:
        seen.add(k)
        recs.append(r)
FIELD = {"forward": "candidates", "tests": "tests"}
# Positive examples whose counterfactual twin (implementing or testing units removed) has a known answer.
TWIN_TARGETS = {
    ("forward", "coverage"): {"probabilities": {"0": 1.0}},
    ("forward", "evidence"): {"probabilities": {"none": 1.0}},
    ("tests", "asserts_as_stated"): {"noul": 0.0},
    ("tests", "test_evidence"): {"probabilities": {"none": 1.0}},
}


def unit_label(field, it):
    """The option text Remit's question builders use for a unit (packages/core/src/questions/{forward,tests}.ts)."""
    if field == "tests":
        return f"`tests` entry {it['id']} ({it.get('file', '')})"
    return f"`candidates` entry {it['id']} ({it.get('file', '')}, {it.get('symbol') or '(file)'})"


def renumber(r):
    """Shuffles the units and renames them U1..Un, rebuilding choice options, targets and support to match.

    Without this, augmented units would carry tell-tale ids (distractors as D*, gaps where twins removed units), and
    the model could learn the id pattern instead of reading the code.
    """
    if r["call"] not in FIELD:
        return r
    field = FIELD[r["call"]]
    items = r["state"][field]
    random.shuffle(items)
    mapping = {}
    for i, it in enumerate(items, 1):
        if it.get("id") is not None:
            mapping[it["id"]] = f"U{i}"
        it["id"] = f"U{i}"
    q = r["question"]
    if q["type"] == "choice" and "none" in q["criteria"]:
        none = q["criteria"]["none"]
        q["criteria"] = {**{it["id"]: unit_label(field, it) for it in items}, "none": none}
        probs = r["target"]["probabilities"]
        r["target"]["probabilities"] = {
            ("none" if k == "none" else mapping[k]): v for k, v in probs.items() if k == "none" or k in mapping
        }
    if r.get("support"):
        r["support"] = [mapping[x] for x in r["support"] if x in mapping]
    return r


RAW_POOLS = defaultdict(lambda: defaultdict(list))  # call -> seed -> units
for _r in recs:
    if _r["call"] in FIELD:
        RAW_POOLS[_r["call"]][_r["seedId"]].extend(_r["state"].get(FIELD[_r["call"]], []))


def backfill_pool(r):
    """Same-seed decoys to keep a twin's candidate count: units of the same repository that are not in the state and
    do not implement (or test) the requirement. Foreign units would make twins recognisable by language and style
    (label audit, 2026-09-27); padding with foreign units is applied to originals and twins alike instead."""
    field = FIELD[r["call"]]
    present = {json.dumps(u, sort_keys=True) for u in r["state"].get(field, [])}
    sup_keys = {
        (u.get("file"), u.get("symbol"), tuple(u.get("titles") or []))
        for u in r["state"].get(field, [])
        if u.get("id") in set(r.get("support") or [])
    }
    seen, out = set(), []
    for u in RAW_POOLS[r["call"]][r["seedId"]]:
        k = json.dumps(u, sort_keys=True)
        key = (u.get("file"), u.get("symbol"), tuple(u.get("titles") or []))
        if k in present or k in seen or key in sup_keys:
            continue
        seen.add(k)
        out.append(u)
    return out


def is_positive(r):
    t = r["target"]
    k = (r["call"], r["qid"])
    if k == ("forward", "coverage"):
        return t["probabilities"].get("3", 0) + t["probabilities"].get("2", 0) >= 0.99
    if k == ("tests", "asserts_as_stated"):
        return t.get("noul") == 1
    if k in (("forward", "evidence"), ("tests", "test_evidence")):
        return t["probabilities"].get("none", 0) == 0
    return False


def twin(r):
    """The same example with the units that implement (or test) the requirement removed: the answer becomes missing."""
    k = (r["call"], r["qid"])
    if k not in TWIN_TARGETS or not r.get("support") or not is_positive(r):
        return None
    field = FIELD[r["call"]]
    sup = set(r["support"])
    kept = [c for c in r["state"].get(field, []) if c.get("id") not in sup]
    if not kept or len(kept) == len(r["state"].get(field, [])):
        return None
    r2 = copy.deepcopy(r)
    pool = backfill_pool(r)
    if len(pool) < len(sup):
        return None  # not enough same-seed decoys to keep the count: no twin rather than a recognisable one
    # Replace each removed unit with a same-seed decoy, so neither the count nor the language reveals the answer.
    fill = [dict(u) for u in random.sample(pool, len(sup))]
    r2["state"][field] = kept + fill
    r2["support"] = []
    r2["twin"] = True
    r2["target"] = copy.deepcopy(TWIN_TARGETS[k])
    q = r2["question"]
    if q["type"] == "choice":
        q["criteria"] = {"none": q["criteria"]["none"]}  # rebuilt by renumber()
    return renumber(r2)


recs += [t for t in (twin(r) for r in recs) if t]


def cls(r):
    t = r["target"]
    if "noul" in t:
        return "yes" if t["noul"] >= 0.5 else "no"
    top = max(t["probabilities"], key=t["probabilities"].get)
    return ("none" if top == "none" else "some") if r["question"]["type"] == "choice" else top


by_q = defaultdict(list)
for r in recs:
    by_q[(r["call"], r["qid"])].append(r)
KEYS = {tuple(k.split(".", 1)) for k in args.keys.split(",") if k}
if KEYS:
    by_q = {k: v for k, v in by_q.items() if k in KEYS}
train, val = [], []
for k, lst in by_q.items():
    random.shuffle(lst)
    va = [r for r in lst if r["seedId"] in VAL_SEEDS]
    val.extend(va[: args.val_cap])
    # Class-balanced training sample: equal share per answer class, oversampling rare classes up to 4x.
    by_c = defaultdict(list)
    for r in lst:
        if r["seedId"] not in VAL_SEEDS:
            by_c[cls(r)].append(r)
    # A question with one answer class in the data would only teach a constant: leave it to the base model.
    if len(by_c) < 2:
        continue
    per = max(1, min(args.cap, CAPS.get(k, args.cap)) // len(by_c))
    for c, rows in by_c.items():
        take = rows[:per]
        while len(take) < min(per, 4 * len(rows)):
            take.append(random.choice(rows))
        train.extend(take)
data = train + val
if args.dry_run:
    for split, rows in (("train", train), ("val", val)):
        bal = defaultdict(lambda: defaultdict(int))
        for r in rows:
            bal[f"{r['call']}.{r['qid']}"][cls(r)] += 1
        print(split, sum(1 for r in rows if r.get("twin")), "twins")
        for k in sorted(bal):
            print(f"  {k:28s} {dict(bal[k])}")
    raise SystemExit(0)


def pool_for(rows, call, field):
    pool = defaultdict(list)
    for r in rows:
        if r["call"] == call:
            for c in r["state"].get(field, []):
                pool[r["seedId"]].append(c)
    return pool


POOLS = {
    "train": {"forward": pool_for(train, "forward", "candidates"), "tests": pool_for(train, "tests", "tests")},
    "val": {"forward": pool_for(val, "forward", "candidates"), "tests": pool_for(val, "tests", "tests")},
}


def state_tokens(state) -> int:
    return len(tok(serialize_state(state), add_special_tokens=False)["input_ids"])


def with_distractors(r, split, target_tokens):
    """A copy of a forward/tests record padded with other seeds' units up to about target_tokens."""
    call = r["call"]
    field = FIELD[call]
    pool = [c for s, cs in POOLS[split][call].items() if s != r["seedId"] for c in cs]
    if not pool:
        return None
    r2 = copy.deepcopy(r)
    items = r2["state"][field]
    q = r2["question"]
    n = 0
    random.shuffle(pool)
    for c in pool:
        if state_tokens(r2["state"]) >= target_tokens:
            break
        d = dict(c)
        n += 1
        d["id"] = f"x{n}"  # temporary; renumber() assigns the final U ids
        items.append(d)
        if q["type"] == "choice" and "none" in q["criteria"]:
            r2["target"]["probabilities"][d["id"]] = 0.0
    if not n:
        return None
    r2["padded"] = True
    if q["type"] == "choice" and "none" in q["criteria"]:
        # Keep existing option text for original units; renumber() rebuilds labels for all of them.
        pass
    return renumber(r2)


def expand(rows, split):
    out = list(rows)
    for r in rows:
        if r["call"] not in FIELD:
            continue
        ranges = (
            [(1024, args.max_len - 300)]
            if args.long_variants == 1
            else [(1024, 2048), (2048, args.max_len - 300)][: args.long_variants]
        )
        for lo, hi in ranges:
            v = with_distractors(r, split, random.randint(lo, hi))
            if v:
                out.append(v)
    return out


REJECTED = defaultdict(int)
ANY_OF = {"forward.evidence", "tests.test_evidence", "reverse.serves"}


def encode(r):
    """One encoded example, or None with the reason counted in REJECTED. Nothing is ever truncated."""
    q = Agent._to_internal(r["question"])
    ids = build_sequence(tok, r["state"], q, args.max_len, args.head_max_len)
    seq, markers = ids
    st = state_tokens(r["state"])
    if st + (markers[-1] if markers else 0) + 8 > args.max_len:
        REJECTED["state would be truncated"] += 1
        return None  # would be truncated: never train on cut states
    t = r["target"]
    if q["t"] == "noul":
        target = [1 - t["noul"], t["noul"]]
    elif q["t"] == "choice":
        target = [t["probabilities"].get(k, 0.0) for k in q["crit"].keys()]
    else:
        target = [t["probabilities"].get(str(i), 0.0) for i in range(len(q["crit"]))]
    if len(markers) != len(target):
        REJECTED["options exceed the head budget"] += 1
        return None
    if sum(target) <= 0:
        REJECTED["empty target"] += 1
        return None
    s = sum(target)
    key = f"{r['call']}.{r['qid']}"
    kind = "twin" if r.get("twin") else ("padded" if r.get("padded") else "original")
    return {
        "src": r["itemId"],
        "seed": r["seedId"],
        "kind": kind,
        # Evidence-style questions: any one unit with positive target weight is a correct pick (the oracle spreads
        # weight over interchangeable implementing units); correctness is scored as membership, loss stays distributional.
        "anyof": key in ANY_OF,
        "ihash": hashlib.sha1(json.dumps(seq).encode()).hexdigest()[:16],
        "thash": hashlib.sha1(json.dumps([round(x / s, 6) for x in target]).encode()).hexdigest()[:16],
        "ids": seq,
        "markers": markers,
        "qtype": QTYPES[q["t"]],
        "target": [x / s for x in target],
        "key": f"{r['call']}.{r['qid']}",
        "cls": cls(r),
        "len": len(seq),
    }


t0 = time.time()
if args.export:
    os.makedirs(args.export, exist_ok=True)
    for split, rows in (("train", expand(train, "train")), ("val", expand(val, "val"))):
        with open(os.path.join(args.export, f"{split}.jsonl"), "w") as fh:
            for r in rows:
                fh.write(json.dumps({
                    "split": split,
                    "seedId": r["seedId"],
                    "itemId": r["itemId"],
                    "operator": r["operator"],
                    "question_key": f"{r['call']}.{r['qid']}",
                    "answer_class": cls(r),
                    "kind": "twin" if r.get("twin") else "original",
                    "state_tokens": state_tokens(r["state"]),
                    "question": r["question"],
                    "state": r["state"],
                    "target": r["target"],
                }) + "\n")
    print(f"exported to {args.export}")
    raise SystemExit(0)
train_items = [e for e in (encode(r) for r in expand(train, "train")) if e]
val_items = [e for e in (encode(r) for r in expand(val, "val")) if e]
if args.overfit:
    random.shuffle(train_items)
    train_items = train_items[: args.overfit]
    val_items = list(train_items)  # mechanics only: this measures memorization, never generalization
print(f"records {len(raw)} unique {len(recs)} capped {len(data)} | train {len(train_items)} val {len(val_items)} "
      f"| encode {time.time() - t0:.0f}s", flush=True)
RUN_DIR = os.path.join(ROOT, ".laya", "runs", args.name)
os.makedirs(RUN_DIR, exist_ok=True)
tok_file = os.path.join(SNAP, "tokenizer", "tokenizer.json")
import laya as _laya

MANIFEST = {
    "name": args.name,
    "tokenizer_sha1": hashlib.sha1(open(tok_file, "rb").read()).hexdigest() if os.path.exists(tok_file) else None,
    "laya_version": getattr(_laya, "__version__", "unknown"),
    "records_sha1": hashlib.sha1(open(os.path.join(ROOT, ".laya/data/records.jsonl"), "rb").read()).hexdigest(),
    "config": {k: v for k, v in vars(args).items()},
    "rejected": dict(REJECTED),
    "counts": {
        split: {
            f"{e['key']}={e['cls']}|{e['kind']}": sum(1 for x in items if (x["key"], x["cls"], x["kind"]) == (e["key"], e["cls"], e["kind"]))
            for e in items
        }
        for split, items in (("train", train_items), ("val", val_items))
    },
}
MANIFEST["dataset_sha1"] = hashlib.sha1(
    json.dumps([(e["ihash"], e["thash"]) for e in train_items + val_items]).encode()
).hexdigest()
with open(os.path.join(RUN_DIR, "manifest.jsonl"), "w") as fh:
    for split, items in (("train", train_items), ("val", val_items)):
        for e in items:
            fh.write(json.dumps({k: e[k] for k in ("src", "seed", "kind", "key", "cls", "len", "ihash", "thash")} | {"split": split}) + "\n")
json.dump(MANIFEST, open(os.path.join(RUN_DIR, "manifest.json"), "w"), indent=1)
print(f"manifest {RUN_DIR}/manifest.json dataset {MANIFEST['dataset_sha1'][:12]} rejected {dict(REJECTED)}", flush=True)
for name, items in [("train", train_items), ("val", val_items)]:
    lens = sorted(e["len"] for e in items)
    q = lambda f: lens[int(f * (len(lens) - 1))]
    print(f"  {name} lengths p10 {q(0.1)} p50 {q(0.5)} p90 {q(0.9)} max {lens[-1]}", flush=True)


def batches(items, budget=4096, max_rows=8, shuffle=True):
    items = sorted(items, key=lambda e: e["len"])
    out, cur = [], []
    for e in items:
        if cur and (len(cur) + 1) * max(e["len"], cur[-1]["len"]) > budget or len(cur) >= max_rows:
            out.append(cur)
            cur = []
        cur.append(e)
    if cur:
        out.append(cur)
    if shuffle:
        random.shuffle(out)
    return out


def collate(batch):
    # Shapes are bucketed (length to a multiple of 256, options to a multiple of 8): the MPS backend compiles and
    # caches a graph per distinct shape, and unbounded shapes grow that cache until memory runs out.
    n, L = len(batch), -(-max(e["len"] for e in batch) // 256) * 256
    k = -(-max(len(e["markers"]) for e in batch) // 8) * 8
    ids = torch.full((n, L), tok.pad_token_id, dtype=torch.long)
    att = torch.zeros((n, L), dtype=torch.long)
    mpos = torch.zeros((n, k), dtype=torch.long)
    mmask = torch.zeros((n, k), dtype=torch.bool)
    tgt = torch.zeros((n, k))
    qt = torch.tensor([e["qtype"] for e in batch])
    for i, e in enumerate(batch):
        ids[i, : e["len"]] = torch.tensor(e["ids"])
        att[i, : e["len"]] = 1
        m = len(e["markers"])
        mpos[i, :m] = torch.tensor(e["markers"])
        mmask[i, :m] = True
        tgt[i, :m] = torch.tensor(e["target"])
    return ids, att, mpos, mmask, qt, tgt


def logits_for(b):
    ids, att, mpos, mmask, qt, _ = b
    with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=device.type == "mps"):
        logits, _act = model(ids.to(device), att.to(device), mpos.to(device), mmask.to(device), qt.to(device))
    return logits.float().masked_fill(~mmask.to(device), -1e4)


LAST_PER_CLASS = {}
LAST_PER_KIND = {}


@torch.no_grad()
def evaluate(items, temps=(1.0, 1.0, 1.0)):
    model.eval()
    stats = defaultdict(lambda: [0, 0, 0.0])  # n, correct, nll
    per_class = defaultdict(lambda: [0, 0])  # (key, true class) -> n, correct
    kind_stats = defaultdict(lambda: [0, 0])  # (key, original|twin|padded) -> n, correct
    rows = []
    for batch in batches(items, shuffle=False):
        b = collate(batch)
        lg = logits_for(b).cpu()
        for i, e in enumerate(batch):
            m = len(e["markers"])
            T = temps[e["qtype"]]
            lp = F.log_softmax(lg[i, :m] / T, -1)
            t = torch.tensor(e["target"])
            s = stats[e["key"]]
            s[0] += 1
            pick = lp.argmax().item()
            ok = int(t[pick].item() > 0) if e["anyof"] else int(pick == t.argmax().item())
            kind_stats[(e["key"], e["kind"])][0] += 1
            kind_stats[(e["key"], e["kind"])][1] += ok
            s[1] += ok
            pc = per_class[(e["key"], e["cls"])]
            pc[0] += 1
            pc[1] += ok
            s[2] += float(-(t * lp).sum())
            rows.append((e["qtype"], lg[i, :m], t))
    model.train()
    total_n = sum(s[0] for s in stats.values())
    acc = sum(s[1] for s in stats.values()) / max(1, total_n)
    nll = sum(s[2] for s in stats.values()) / max(1, total_n)
    # Balanced accuracy: mean recall over answer classes, so a majority-class model cannot look good.
    ba = {}
    for key in stats:
        recalls = [c[1] / c[0] for (k, _), c in per_class.items() if k == key and c[0]]
        ba[key] = (sum(recalls) / len(recalls), len(recalls))
    multi = [b for b, n in ba.values() if n >= 2]
    macro = sum(multi) / max(1, len(multi))
    per = {k: (s[0], s[1] / s[0], s[2] / s[0], ba[k][0], ba[k][1]) for k, s in sorted(stats.items())}
    global LAST_PER_CLASS, LAST_PER_KIND
    LAST_PER_CLASS = {f"{k}={c}": (v[1] / v[0], v[0]) for (k, c), v in sorted(per_class.items()) if v[0]}
    LAST_PER_KIND = {f"{k}|{c}": (v[1] / v[0], v[0]) for (k, c), v in sorted(kind_stats.items()) if v[0]}
    return acc, nll, per, rows, macro


def fit_temperatures(rows):
    temps = []
    for qt in range(3):
        sub = [(lg, t) for q, lg, t in rows if q == qt]
        if len(sub) < 10:
            temps.append(1.0)
            continue
        logT = torch.zeros(1, requires_grad=True)
        opt = torch.optim.LBFGS([logT], lr=0.1, max_iter=100)

        def closure():
            opt.zero_grad()
            loss = sum(-(t * F.log_softmax(lg / logT.exp(), -1)).sum() for lg, t in sub) / len(sub)
            loss.backward()
            return loss

        opt.step(closure)
        temps.append(float(min(5.0, max(0.5, logT.exp().item()))))
    return temps


def report(tag, res):
    acc, nll, per, _, macro = res
    print(f"[{tag}] val acc {acc:.3f} nll {nll:.3f} balanced {macro:.3f}", flush=True)
    for k, (n, a, l, b, nc) in per.items():
        print(f"    {k:28s} n={n:4d} acc {a:.3f} balanced {b:.3f} ({nc} classes) nll {l:.3f}", flush=True)
    print("    recall by class: " + ", ".join(f"{k} {r:.2f} (n={n})" for k, (r, n) in LAST_PER_CLASS.items()), flush=True)
    print("    accuracy by kind: " + ", ".join(f"{k} {r:.2f} (n={n})" for k, (r, n) in LAST_PER_KIND.items()), flush=True)


# ---------------------------------------------------------------- model
model.to(device)
enc = model.encoder
for prm in enc.embeddings.parameters():
    prm.requires_grad = False
for layer in enc.layers[: args.freeze]:
    for prm in layer.parameters():
        prm.requires_grad = False
if args.checkpointing:
    enc.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    if hasattr(model, "head_checkpointing"):
        model.head_checkpointing = True

report("base (as shipped, T=1)" if not args.init else f"start ({args.init}, T=1)", evaluate(val_items))
if args.eval_only:
    raise SystemExit(0)
if device.type == "mps":
    torch.mps.empty_cache()

enc_params = [p_ for n, p_ in model.named_parameters() if p_.requires_grad and n.startswith("encoder.")]
head_params = [p_ for n, p_ in model.named_parameters() if p_.requires_grad and not n.startswith("encoder.")]
opt = torch.optim.AdamW(
    [{"params": enc_params, "lr": args.lr_enc}, {"params": head_params, "lr": args.lr_head}], weight_decay=0.01
)
steps_per_epoch = math.ceil(len(batches(train_items)) / args.accum)
total = steps_per_epoch * args.epochs if not args.max_steps else args.max_steps
sched = torch.optim.lr_scheduler.LambdaLR(
    opt, lambda s: min(1.0, (s + 1) / max(1, total // 20)) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / max(1, total))))
)

TRAINABLE = [n for n, p_ in model.named_parameters() if p_.requires_grad]


def trainable_state():
    sd = dict(model.named_parameters())
    return {n: sd[n].detach().cpu().clone() for n in TRAINABLE}


def atomic_save(obj, path):
    tmp = path + ".tmp"
    torch.save(obj, tmp)
    os.replace(tmp, path)


def save_checkpoint(epoch, bi, order, step, best_score, best_epoch):
    atomic_save(
        {
            "weights": trainable_state(),
            "opt": opt.state_dict(),
            "sched": sched.state_dict(),
            "rng": {"python": random.getstate(), "torch": torch.get_rng_state()},
            "epoch": epoch,
            "next_batch": bi,
            "order": order,
            "step": step,
            "best": (best_score, best_epoch),
            "dataset_sha1": MANIFEST["dataset_sha1"],
            "config": MANIFEST["config"],
        },
        os.path.join(RUN_DIR, "latest.pt"),
    )


def batch_order(items):
    """Batches as lists of item indices, so an epoch's order can be saved and replayed exactly."""
    idx = {id(e): i for i, e in enumerate(items)}
    return [[idx[id(e)] for e in b] for b in batches(items)]


best_score, best_epoch, step, start_epoch, start_batch, order = float("inf"), None, 0, 0, 0, None
if args.resume:
    ck = torch.load(os.path.join(RUN_DIR, "latest.pt"), map_location="cpu", weights_only=False)
    if ck["dataset_sha1"] != MANIFEST["dataset_sha1"]:
        raise SystemExit("refusing to resume: the encoded dataset differs from the checkpoint's")
    params = dict(model.named_parameters())
    with torch.no_grad():
        for n, v in ck["weights"].items():
            params[n].copy_(v.to(params[n].device))
    opt.load_state_dict(ck["opt"])
    sched.load_state_dict(ck["sched"])
    random.setstate(ck["rng"]["python"])
    torch.set_rng_state(ck["rng"]["torch"])
    step, start_epoch, start_batch, order = ck["step"], ck["epoch"], ck["next_batch"], ck["order"]
    best_score, best_epoch = ck["best"]
    print(f"resumed at epoch {start_epoch} batch {start_batch} step {step}", flush=True)

model.train()
t0 = time.time()
steps_done_here = 0
stop = False
for epoch in range(start_epoch, args.epochs):
    if order is None or epoch != start_epoch:
        order = batch_order(train_items)
        start_batch = 0
    running, seen_batches = 0.0, 0
    for bi in range(start_batch, len(order)):
        b = collate([train_items[i] for i in order[bi]])
        lg = logits_for(b)
        tgt = b[5].to(device)
        loss = (-(tgt * F.log_softmax(lg, -1)).sum(-1)).mean() / args.accum
        loss.backward()
        running += loss.item() * args.accum
        seen_batches += 1
        if (bi + 1) % args.accum == 0 or bi == len(order) - 1:
            torch.nn.utils.clip_grad_norm_([*enc_params, *head_params], 1.0)
            opt.step()
            sched.step()
            opt.zero_grad(set_to_none=True)
            step += 1
            steps_done_here += 1
            if device.type == "mps":
                torch.mps.empty_cache()
            if step % 5 == 0:
                el = time.time() - t0
                print(f"epoch {epoch} step {step}/{total} loss {running / seen_batches:.4f} "
                      f"{el / steps_done_here:.1f}s/step eta {(total - step) * el / steps_done_here / 60:.0f} min", flush=True)
            if step % args.ckpt_every == 0:
                save_checkpoint(epoch, bi + 1, order, step, best_score, best_epoch)
            if args.max_steps and step >= args.max_steps:
                stop = True
                break
    res = evaluate(val_items)
    report(f"epoch {epoch}", res)
    # Select on balanced accuracy (higher is better); stored negated so smaller is better.
    if -res[4] < best_score:
        best_score, best_epoch = -res[4], epoch
        atomic_save(trainable_state(), os.path.join(RUN_DIR, "best.pt"))
    save_checkpoint(epoch + 1, 0, None, step, best_score, best_epoch)
    if stop:
        break

best = (best_score, None, best_epoch)
if os.path.exists(os.path.join(RUN_DIR, "best.pt")):
    params = dict(model.named_parameters())
    with torch.no_grad():
        for n, v in torch.load(os.path.join(RUN_DIR, "best.pt"), map_location="cpu").items():
            params[n].copy_(v.to(params[n].device))
res = evaluate(val_items)
temps = fit_temperatures(res[3])
report(f"best epoch {best[2]} with temperatures {[round(t, 3) for t in temps]}", evaluate(val_items, temps))

# ---------------------------------------------------------------- save
out = os.path.join(ROOT, ".laya", args.name)
if os.path.exists(out):
    raise SystemExit(f"{out} exists: earlier experiments are never overwritten; choose another --name")
os.makedirs(out)
save_file({k: v.half().contiguous() for k, v in model.state_dict().items()}, os.path.join(out, "model.safetensors"))
shutil.copytree(os.path.join(SNAP, "encoder"), os.path.join(out, "encoder"))
shutil.copytree(os.path.join(SNAP, "tokenizer"), os.path.join(out, "tokenizer"))
cfg = json.load(open(os.path.join(SNAP, "rl_agent_config.json")))
cfg.pop("temperature_by_options", None)
cfg.update(
    {
        "model_name": args.name,
        "max_len": args.max_len,
        "head_max_len": args.head_max_len,
        "temperature": temps,
        "fine_tuned": True,
        "remit": {
            "base": "convaiinnovations/laya typed-decisions@55cf4c4e",
            "data": "mutation corpus dev split via OracleJev (D35)",
            "val_seeds": sorted(VAL_SEEDS),
            "best_epoch": best[2],
            "dataset_sha1": MANIFEST["dataset_sha1"],
            "train_items": len(train_items),
            "val_items": len(val_items),
        },
    }
)
json.dump(cfg, open(os.path.join(out, "rl_agent_config.json"), "w"), indent=1)
print(f"saved {out}", flush=True)
