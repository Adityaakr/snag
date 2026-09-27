// Scores Remit systems on the same mutation items with one set of definitions (docs/acceptance.md section C).
//
// Usage: node scripts/eval/compare.mjs <name>=<source> [<name>=<source> ...] [--ids file] [--json out.json]
//   source is either a pipeline report dir (eval/reports/<run>) or a single_pass predictions file
//   (eval/reports/<run>/baselines/single_pass.remit_requirements.jsonl).
// Only items present in every source are scored, so every system is measured on exactly the same items.
//
// Definitions (all proportions, Wilson 95% intervals; items that share a seed are NOT independent, so the
// intervals are optimistic and the seed count is printed next to them):
//   target-defect recall (strict)  target requirement status equals the label or an accepted alternative
//   target flagged (any type)      target requirement has any problem status (or the target finding exists)
//   finding precision              correct surfaced P0/P1 findings / all surfaced P0/P1 findings, on all PRs
//   false findings on defective PRs, clean-PR false-positive rate, entire-review correctness (every labeled
//   requirement right, no false finding, target found, review complete), abstentions (uncertain), failures.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROBLEM = new Set(['missing', 'partial', 'contradicted', 'interpretation_mismatch']);
const FAILURE = /\b(?:jev|openai_compatible|anthropic):|Budget reached|could not shrink/;
const REQ_OPS = new Set([
  'drop_requirement',
  'flip_condition',
  'partial_requirement',
  'unwire',
  'claim_all_done',
]);

function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

function parseId(id) {
  const tail = id.split('/').pop();
  const [seed, op, ...rest] = tail.split('.');
  return { seed, op: op ?? 'clean', target: rest.join('.') || undefined };
}

/** Normalised predictions: statuses per requirement, surfaced findings, failure, cost, latency. */
function loadSource(src) {
  const out = new Map();
  if (statSync(src).isDirectory()) {
    for (const f of readdirSync(join(src, 'items'))) {
      const d = JSON.parse(readFileSync(join(src, 'items', f), 'utf8'));
      const statuses = Object.fromEntries(
        d.result.requirementVerdicts.map((v) => [v.requirementId, v.status]),
      );
      const units = new Map(d.result.units.map((u) => [u.id, u]));
      const findings = d.result.findings
        .filter((x) => x.priority === 'P0' || x.priority === 'P1')
        .map((x) => ({
          type: x.type,
          id: x.id,
          requirement: x.type === 'requirement' || x.type === 'claim' ? x.targetId : undefined,
          file: x.locations?.[0]?.file ?? units.get(x.targetId)?.file,
          kind: x.kind ?? x.factKind,
        }));
      out.set(d.id, {
        labels: d.labels,
        statuses,
        findings,
        failed: (d.result.warnings ?? []).some((w) => FAILURE.test(w)),
        costUsd: d.result.usage?.costUsd ?? 0,
        latencyMs: d.result.usage?.latencyMs ?? null,
      });
    }
  } else {
    for (const line of readFileSync(src, 'utf8').split('\n').filter(Boolean)) {
      const d = JSON.parse(line);
      if (Array.isArray(d.findings)) {
        // Prepared predictions (ablation variants): already normalised.
        out.set(d.id, {
          labels: d.labels,
          statuses: d.statuses ?? {},
          findings: d.findings,
          failed: Boolean(d.failed),
          costUsd: d.costUsd ?? 0,
          latencyMs: d.latencyMs ?? null,
        });
        continue;
      }
      const findings = [];
      if (d.output) {
        for (const r of d.output.requirements)
          if (r.id && PROBLEM.has(r.status) && r.confidence >= 0.5)
            findings.push({ type: 'requirement', requirement: r.id, id: `A-${r.id}` });
        for (const u of d.output.unexplained)
          if (u.behavioral)
            findings.push({ type: 'unit', file: u.file, id: `A-U-${u.file}:${u.lines?.start}` });
      }
      out.set(d.id, {
        labels: d.labels,
        statuses: d.statuses ?? {},
        findings,
        failed: Boolean(d.error),
        costUsd: d.costUsd ?? 0,
        latencyMs: d.latencyMs ?? null,
      });
    }
  }
  return out;
}

function findingCorrect(f, labels) {
  if (f.type === 'requirement') return PROBLEM.has(labels.requirements[f.requirement] ?? '');
  if (f.type === 'claim') return (labels.claimMismatch ?? []).includes(f.requirement);
  if (f.type === 'unit')
    return (labels.units ?? []).some((u) => u.role === 'unexplained_behavioral' && u.file === f.file);
  if (f.type === 'test_integrity')
    return (
      (labels.testIntegrity ?? []).some((t) => t.file === f.file) ||
      (labels.facts ?? []).some((x) => x.file === f.file)
    );
  if (f.type === 'fact') return (labels.facts ?? []).some((x) => x.file === f.file);
  return false;
}

function targetFound(p, id) {
  const { op, target } = parseId(id);
  const L = p.labels;
  if (REQ_OPS.has(op) && target) {
    const expected = L.requirements[target];
    const accepted = new Set([expected, ...((L.requirementsAccept ?? {})[target] ?? [])]);
    const actual = p.statuses[target];
    return { applicable: true, strict: accepted.has(actual), any: PROBLEM.has(actual ?? '') };
  }
  if (op === 'weaken_assertion' || op === 'skip_test') {
    // Strict: a test-integrity (or fact) finding on a file the item labels as weakened or skipped.
    const files = new Set([...(L.testIntegrity ?? []), ...(L.facts ?? [])].map((x) => x.file));
    const hit = p.findings.some(
      (f) => (f.type === 'test_integrity' || f.type === 'fact') && files.has(f.file),
    );
    const hitAny = p.findings.some((f) => f.type === 'test_integrity' || f.type === 'fact');
    return { applicable: true, strict: hit, any: hitAny };
  }
  if (op === 'inject_config') {
    const hit = p.findings.some((f) => f.type === 'unit' && (L.units ?? []).some((u) => u.file === f.file));
    return { applicable: true, strict: hit, any: hit };
  }
  return { applicable: false };
}

function score(preds, ids) {
  const m = {
    items: ids.length,
    seeds: new Set(ids.map((i) => parseId(i).seed)).size,
    tStrict: 0,
    tAny: 0,
    tN: 0,
    fCorrect: 0,
    fAll: 0,
    falseOnDefective: 0,
    defective: 0,
    cleanFp: 0,
    clean: 0,
    entire: 0,
    abst: 0,
    reqs: 0,
    failed: 0,
    reqRight: 0,
    cost: 0,
    lat: [],
    byOp: {},
  };
  for (const id of ids) {
    const p = preds.get(id);
    const L = p.labels;
    const { op } = parseId(id);
    const t = targetFound(p, id);
    const ok = { t: !t.applicable || t.strict };
    if (t.applicable) {
      m.tN++;
      if (t.strict) m.tStrict++;
      if (t.any) m.tAny++;
      if (!m.byOp[op]) m.byOp[op] = { n: 0, strict: 0, any: 0 };
      const o = m.byOp[op];
      o.n++;
      if (t.strict) o.strict++;
      if (t.any) o.any++;
    }
    const correct = p.findings.filter((f) => findingCorrect(f, L)).length;
    m.fCorrect += correct;
    m.fAll += p.findings.length;
    const falseF = p.findings.length - correct;
    if (L.pr === 'problem') {
      m.defective++;
      m.falseOnDefective += falseF;
    } else {
      m.clean++;
      if (p.findings.length) m.cleanFp++;
    }
    let allReq = true;
    for (const [r, expected] of Object.entries(L.requirements)) {
      m.reqs++;
      const actual = p.statuses[r];
      const accepted = new Set([expected, ...((L.requirementsAccept ?? {})[r] ?? [])]);
      if (actual === 'uncertain') m.abst++;
      if (accepted.has(actual)) m.reqRight++;
      else allReq = false;
    }
    if (p.failed) m.failed++;
    if (allReq && falseF === 0 && ok.t && !p.failed) m.entire++;
    m.cost += p.costUsd;
    if (p.latencyMs !== null) m.lat.push(p.latencyMs);
  }
  return m;
}

const args = process.argv.slice(2);
const systems = args.filter((a) => a.includes('=') && !a.startsWith('--')).map((a) => a.split('='));
const idsFile = args.includes('--ids') ? args[args.indexOf('--ids') + 1] : null;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const loaded = systems.map(([name, src]) => [name, loadSource(src)]);
let ids = [...loaded[0][1].keys()].filter((id) => loaded.every(([, p]) => p.has(id)));
if (idsFile) {
  const want = readFileSync(idsFile, 'utf8')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  ids = ids.filter((id) => want.some((w) => id.endsWith(w)));
}
if (!ids.length) throw new Error('no items common to every source (or none match --ids)');
ids.sort();

const pct = (k, n) => {
  const [lo, hi] = wilson(k, n);
  return n
    ? `${k}/${n} = ${((100 * k) / n).toFixed(1)}% [${(100 * lo).toFixed(0)}, ${(100 * hi).toFixed(0)}]`
    : 'n/a';
};
const results = {};
console.log(`Items scored: ${ids.length} (same items for every system)\n`);
const rows = [
  ['Target-defect recall, strict type', (m) => pct(m.tStrict, m.tN)],
  ['Target flagged, any type', (m) => pct(m.tAny, m.tN)],
  ['Finding precision (P0/P1)', (m) => pct(m.fCorrect, m.fAll)],
  ['False findings on defective PRs', (m) => `${m.falseOnDefective} on ${m.defective} PRs`],
  ['Clean-PR false-positive rate', (m) => pct(m.cleanFp, m.clean)],
  ['Requirement-status correctness', (m) => pct(m.reqRight, m.reqs)],
  ['Entire-review correctness', (m) => pct(m.entire, m.items)],
  ['Abstentions (uncertain)', (m) => `${m.abst} of ${m.reqs} requirements`],
  ['Failed or incomplete reviews', (m) => `${m.failed} of ${m.items}`],
  ['Cost per review (measured)', (m) => `$${(m.cost / m.items).toFixed(4)}`],
  [
    'Latency p50 / p95',
    (m) => {
      const l = [...m.lat].sort((a, b) => a - b);
      return l.length
        ? `${(l[Math.floor(0.5 * (l.length - 1))] / 1000).toFixed(1)} s / ${(l[Math.floor(0.95 * (l.length - 1))] / 1000).toFixed(1)} s`
        : 'n/a';
    },
  ],
];
const scored = loaded.map(([name, p]) => [name, score(p, ids)]);
console.log(`| Metric | ${scored.map(([n]) => n).join(' | ')} |`);
console.log(`|---|${scored.map(() => '---').join('|')}|`);
for (const [label, f] of rows) console.log(`| ${label} | ${scored.map(([, m]) => f(m)).join(' | ')} |`);
console.log(
  `\nSeeds among the items: ${scored[0][1].seeds}. Items from one seed are correlated; treat intervals as optimistic.`,
);
for (const [name, m] of scored) {
  results[name] = m;
  console.log(
    `\n${name} target detection by operator: ` +
      Object.entries(m.byOp)
        .map(([op, o]) => `${op} strict ${o.strict}/${o.n}, any ${o.any}/${o.n}`)
        .join('; '),
  );
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ ids, results }, null, 1));
