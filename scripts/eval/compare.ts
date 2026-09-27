// Scores Remit systems with one set of definitions (packages/eval/src/compare/score.ts, docs/acceptance.md C).
//
// Usage:
//   pnpm exec tsx --conditions=source scripts/eval/compare.ts --units <report dir> [--ids file] [--out dir]
//        <name>=report:<pipeline report dir>
//        <name>=single:<single_pass predictions .jsonl>[+facts:<pipeline report dir>]
//
// --units: any pipeline report over the same items (the deterministic unit analysis gives symbol line ranges).
// Prints two views: SHARED (items every system has) and ALL (each system on every item it attempted).
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  aggregate,
  type Prediction,
  reconcileSinglePass,
  type SurfacedFinding,
  scoreItem,
  type UnitIndex,
} from '@remit/eval';

const FAILURE = /\b(?:jev|openai_compatible|anthropic):|Budget reached|could not shrink/;
const PROBLEM = new Set(['missing', 'partial', 'contradicted', 'interpretation_mismatch']);

// biome-ignore lint/suspicious/noExplicitAny: parsed report JSON of several shapes
type Json = Record<string, any>;
const items = (dir: string): Json[] =>
  readdirSync(join(dir, 'items')).map((f) => JSON.parse(readFileSync(join(dir, 'items', f), 'utf8')));

function unitIndex(dir: string): UnitIndex {
  const map = new Map<string, Json[]>();
  for (const d of items(dir)) map.set(d.id, d.result.units);
  return (id, file, symbol) => {
    const u = (map.get(id) ?? []).find((x) => x.file === file && (!symbol || x.symbol?.name === symbol));
    if (!u) return undefined;
    if (u.symbol?.startLine) return [u.symbol.startLine, u.symbol.endLine];
    const r = (u.lines?.new ?? []).flat();
    return r.length ? [Math.min(...r), Math.max(...r)] : undefined;
  };
}

function unitLines(u: Json | undefined): [number, number] | undefined {
  if (!u) return undefined;
  if (u.symbol?.startLine) return [u.symbol.startLine, u.symbol.endLine];
  const r = (u.lines?.new ?? []).flat();
  return r.length ? [Math.min(...r), Math.max(...r)] : undefined;
}

function fromReport(dir: string): Map<string, Prediction> {
  const out = new Map<string, Prediction>();
  for (const d of items(dir)) {
    const r = d.result;
    const units = new Map<string, Json>(r.units.map((u: Json) => [u.id, u]));
    const statuses = Object.fromEntries(r.requirementVerdicts.map((v: Json) => [v.requirementId, v.status]));
    const surfaced: SurfacedFinding[] = [];
    for (const f of r.findings.filter((x: Json) => x.priority === 'P0' || x.priority === 'P1')) {
      const loc = f.locations?.[0];
      const lines: [number, number] | undefined = loc?.lines
        ? [loc.lines[0], loc.lines[1] ?? loc.lines[0]]
        : undefined;
      if (f.type === 'requirement') {
        // A claim-mismatch reason is a facet of this one finding, not a second finding.
        const claim = (f.reasons ?? []).some((x: Json) => /claim/.test(x.template ?? ''));
        surfaced.push({
          id: f.id,
          type: 'requirement',
          requirement: f.targetId,
          status: statuses[f.targetId],
          ...(claim ? { claim: true } : {}),
        });
      } else if (f.type === 'unit') {
        const u = units.get(f.targetId);
        const ul = unitLines(u) ?? lines;
        surfaced.push({ id: f.id, type: 'unit', file: u?.file ?? loc?.file, ...(ul ? { lines: ul } : {}) });
      } else if (f.type === 'test_integrity' || f.type === 'fact') {
        surfaced.push({ id: f.id, type: f.type, file: loc?.file, ...(lines ? { lines } : {}) });
      }
    }
    const facts = r.units.flatMap((u: Json) =>
      (u.facts ?? []).map((x: Json) => ({ kind: x.kind, file: u.file, line: x.line })),
    );
    const unitRoles = r.unitVerdicts.map((v: Json) => ({
      file: units.get(v.unitId)?.file,
      symbol: units.get(v.unitId)?.symbol?.name,
      role: v.role,
    }));
    out.set(d.id, {
      id: d.id,
      labels: d.labels,
      statuses,
      surfaced,
      facts,
      unitRoles,
      failed: (r.warnings ?? []).some((w: string) => FAILURE.test(w)),
      costUsd: null, // live engine calls are charged to a run-wide tracker, not per review
      latencyMs: r.usage?.latencyMs ?? null,
      cached: null,
    });
  }
  return out;
}

function fromSinglePass(file: string, factsDir?: string, e4 = false): Map<string, Prediction> {
  const facts = factsDir ? fromReport(factsDir) : undefined;
  const out = new Map<string, Prediction>();
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const d = JSON.parse(line);
    const surfaced: SurfacedFinding[] = [];
    if (d.output && e4) d.output = reconcileSinglePass(d.output);
    if (d.output) {
      for (const r of d.output.requirements)
        if (r.id && PROBLEM.has(r.status) && r.confidence >= 0.5)
          surfaced.push({ id: `A-${r.id}`, type: 'requirement', requirement: r.id, status: r.status });
      d.output.unexplained.forEach((u: Json, i: number) => {
        if (u.behavioral)
          surfaced.push({
            id: `A-U${i}`,
            type: 'unit',
            file: u.file,
            lines: [u.lines?.start ?? 0, u.lines?.end ?? 0],
          });
      });
    }
    const det = facts?.get(d.id);
    // Deterministic checks: fact-derived findings that reach the user, and every reported fact.
    if (det)
      for (const f of det.surfaced)
        if (f.type === 'fact' || f.type === 'test_integrity') surfaced.push({ ...f, id: `D-${f.id}` });
    // Cached-ness was not recorded before 2026-09-27; for older files a sub-1.5 s call is treated as a cache hit.
    const cached = typeof d.cached === 'boolean' ? d.cached : d.latencyMs !== null && d.latencyMs < 1500;
    out.set(d.id, {
      id: d.id,
      labels: d.labels,
      statuses: d.statuses ?? {},
      surfaced,
      ...(det ? { facts: det.facts } : {}),
      failed: Boolean(d.error),
      costUsd: d.costUsd ?? null,
      latencyMs: d.latencyMs ?? null,
      cached,
    });
  }
  return out;
}

function load(spec: string): Map<string, Prediction> {
  if (spec.startsWith('report:')) return fromReport(spec.slice(7));
  if (spec.startsWith('single:')) {
    // single:<file>[+facts:<dir>][+e4]
    const e4 = spec.endsWith('+e4');
    const body = e4 ? spec.slice(7, -3) : spec.slice(7);
    const [file, facts] = body.split('+facts:');
    return fromSinglePass(file as string, facts, e4);
  }
  throw new Error(`unknown source ${spec}`);
}

const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const unitsDir = opt('--units');
if (!unitsDir) throw new Error('--units <report dir> is required');
const units = unitIndex(unitsDir);
// Adjudicated label overlay (eval/labels/*.json): corrected statuses per item. Ambiguous items are excluded from
// scoring with --strict-ambiguous, otherwise scored with the adjudicated reading.
const overlayFile = opt('--labels');
const overlay: Record<
  string,
  { requirements?: Record<string, string>; accept?: Record<string, string[]>; ambiguous?: boolean }
> = overlayFile ? JSON.parse(readFileSync(overlayFile, 'utf8')).items : {};
const dropAmbiguous = args.includes('--strict-ambiguous');
function applyOverlay(p: Prediction): Prediction | null {
  // Overlay keys may carry a corpus prefix (mutations/...); prediction ids may not.
  const tail = p.id.split('/').pop() ?? p.id;
  const o = overlay[p.id] ?? Object.entries(overlay).find(([k]) => (k.split('/').pop() ?? k) === tail)?.[1];
  if (!o) return p;
  if (o.ambiguous && dropAmbiguous) return null;
  const requirements = {
    ...p.labels.requirements,
    ...(o.requirements ?? {}),
  } as Prediction['labels']['requirements'];
  const requirementsAccept = { ...p.labels.requirementsAccept };
  for (const r of Object.keys(o.requirements ?? {})) delete requirementsAccept[r];
  Object.assign(requirementsAccept, o.accept ?? {});
  return { ...p, labels: { ...p.labels, requirements, requirementsAccept } };
}
const idsFile = opt('--ids');
const seedFilter = opt('--seeds')?.split(',').filter(Boolean) ?? null;
const want = idsFile
  ? readFileSync(idsFile, 'utf8')
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean)
  : null;
const systems = args
  .filter((a, i) => a.includes('=') && !args[i - 1]?.startsWith('--'))
  .map((a) => {
    const name = a.slice(0, a.indexOf('='));
    const loaded = load(a.slice(a.indexOf('=') + 1));
    const preds = new Map<string, Prediction>();
    for (const [id, p] of loaded) {
      const q = applyOverlay(p);
      if (q) preds.set(id, q);
    }
    if (want) for (const id of [...preds.keys()]) if (!want.some((w) => id.endsWith(w))) preds.delete(id);
    if (seedFilter)
      for (const id of [...preds.keys()])
        if (!seedFilter.some((sd) => (id.split('/').pop() ?? '').startsWith(`${sd}.`))) preds.delete(id);
    if (!preds.size) throw new Error(`${name}: no items after selection`);
    return { name, preds };
  });
if (!systems.length) throw new Error('no systems given');

const fmt = (r: { k: number; n: number; interval: [number, number] }) =>
  r.n
    ? `${r.k}/${r.n} = ${((100 * r.k) / r.n).toFixed(1)}% [${(100 * r.interval[0]).toFixed(0)}, ${(100 * r.interval[1]).toFixed(0)}]`
    : 'n/a';
function table(title: string, rows: { name: string; agg: ReturnType<typeof aggregate> }[]): string {
  const lines = [
    `### ${title}`,
    '',
    `| Metric | ${rows.map((r) => r.name).join(' | ')} |`,
    `|---|${rows.map(() => '---').join('|')}|`,
  ];
  const add = (label: string, f: (a: ReturnType<typeof aggregate>) => string) =>
    lines.push(`| ${label} | ${rows.map((r) => f(r.agg)).join(' | ')} |`);
  add('Items (seeds)', (a) => `${a.items} (${a.seeds})`);
  add(
    'Target defect surfaced, correct type',
    (a) => fmt(a.targetRecallStrict) + (a.targetUnmeasured ? `; ${a.targetUnmeasured} unmeasured` : ''),
  );
  add('Target defect surfaced, any type', (a) => fmt(a.targetFlaggedAnyType));
  add(
    'All labelled defects surfaced, correct type',
    (a) => fmt(a.allDefectRecallStrict) + (a.defectsUnmeasured ? `; ${a.defectsUnmeasured} unmeasured` : ''),
  );
  add('Finding precision (surfaced P0/P1)', (a) => fmt(a.findingPrecision));
  add(
    'Incorrect findings: type mismatch / duplicate / false',
    (a) => `${a.typeMismatches} / ${a.duplicates} / ${a.falseFindings}`,
  );
  add(
    'Incorrect findings on defective PRs',
    (a) => `${a.incorrectFindingsOnDefectivePRs} on ${a.defectivePRs} PRs`,
  );
  add('Clean PRs with any finding', (a) => fmt(a.cleanPRFalsePositive));
  add('Requirement-status accuracy', (a) => fmt(a.requirementStatusAccuracy));
  add('Abstentions (uncertain)', (a) => fmt(a.abstentions));
  add('Entire-review correctness', (a) => fmt(a.entireReview));
  add('Complete reviews', (a) => fmt(a.completion));
  add('Cost per review (recorded)', (a) =>
    a.costPerReview === null ? 'not recorded per review' : `$${a.costPerReview.toFixed(4)}`,
  );
  add('Live latency p50 / p95 (n)', (a) =>
    a.latencyLive.n
      ? `${((a.latencyLive.p50 ?? 0) / 1000).toFixed(1)} s / ${((a.latencyLive.p95 ?? 0) / 1000).toFixed(1)} s (${a.latencyLive.n}; ${a.cachedItems} cached excluded)`
      : `n/a (${a.cachedItems} cached)`,
  );
  return lines.join('\n');
}

const first = systems[0];
if (!first) throw new Error('no systems given');
const shared = [...first.preds.keys()].filter((id) => systems.every((s) => s.preds.has(id))).sort();
if (!shared.length) throw new Error('no items common to every system');
const perItem: Record<string, unknown> = {};
const sharedRows = systems.map((s) => {
  const scores = shared.map((id) => scoreItem(s.preds.get(id) as Prediction, units));
  perItem[s.name] = scores;
  return { name: s.name, agg: aggregate(scores) };
});
const allRows = systems.map((s) => ({
  name: s.name,
  agg: aggregate([...s.preds.keys()].sort().map((id) => scoreItem(s.preds.get(id) as Prediction, units))),
}));
const note =
  'Wilson 95% intervals over items. Items from one seed are correlated, so intervals are optimistic; the seed count is shown.';
const md = [
  table(`Shared items (${shared.length}, identical for every system)`, sharedRows),
  '',
  table('All attempted items per system', allRows),
  '',
  note,
].join('\n');
console.log(md);
const outDir = opt('--out');
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'comparison.md'), `${md}\n`);
  writeFileSync(
    join(outDir, 'comparison.json'),
    JSON.stringify({ shared, sharedRows, allRows, perItem }, null, 1),
  );
}
void statSync;
