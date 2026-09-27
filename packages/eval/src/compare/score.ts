/**
 * One scorer for every system (A single pass, B structured pipeline, C Laya), per docs/acceptance.md section C.
 *
 * Surfaced findings (what reaches the user: P0/P1) are matched one-to-one to the item's LABELLED DEFECTS:
 *  - requirement defect: a requirement finding on the same requirement; strict when its status is the labelled
 *    status or an accepted alternative, otherwise a type mismatch;
 *  - unit defect (unexplained behavioural change): a unit finding whose lines overlap the labelled unit's symbol;
 *  - test-integrity defect: a test-integrity or fact finding overlapping the labelled test (a unit finding there is a
 *    type mismatch);
 *  - claim mismatch: a claim finding on the same requirement.
 * Sharing a file is not enough. A finding matching an already-matched defect is a duplicate. Duplicates, type
 * mismatches and unmatched findings all count against finding precision. Defects whose location cannot be resolved
 * from the labels are UNMEASURED (queued for adjudication), never counted as found or missed.
 */
import type { ItemLabels } from '../item.js';

export type FindingType = 'requirement' | 'unit' | 'test_integrity' | 'fact' | 'claim';

export interface SurfacedFinding {
  id: string;
  type: FindingType;
  requirement?: string;
  /** For requirement findings: the status the finding asserts (missing, partial, contradicted, ...). */
  status?: string;
  /** The finding also reports that the PR description claims this requirement is done (one finding, two facets). */
  claim?: boolean;
  file?: string;
  lines?: [number, number];
}

export interface FactOutput {
  kind: string;
  file: string;
  line?: number;
}

export interface Prediction {
  id: string;
  labels: ItemLabels;
  statuses: Record<string, string>;
  surfaced: SurfacedFinding[];
  /** All deterministic facts the system reports, any priority (for entire-review fact expectations). */
  facts?: FactOutput[];
  /** Unit roles, when the system assigns them (the structured pipeline does; single pass does not). */
  unitRoles?: { file: string; symbol?: string; role: string }[];
  failed: boolean;
  costUsd: number | null;
  latencyMs: number | null;
  cached: boolean | null;
}

/** Symbol line ranges per item, from the deterministic unit analysis (same for every system). */
export type UnitIndex = (
  itemId: string,
  file: string,
  symbol: string | undefined,
) => [number, number] | undefined;

export interface Defect {
  key: string;
  type: 'requirement' | 'unit' | 'test_integrity' | 'claim';
  requirement?: string;
  accepted?: Set<string>;
  file?: string;
  lines?: [number, number];
  /** Location could not be resolved: the defect cannot be scored strictly. */
  unmeasurable?: boolean;
  target: boolean;
}

export const SCORED_PROBLEM_STATUSES = new Set([
  'missing',
  'partial',
  'contradicted',
  'interpretation_mismatch',
]);
const REQ_OPS = new Set([
  'drop_requirement',
  'flip_condition',
  'partial_requirement',
  'unwire',
  'claim_all_done',
]);

export function parseItemId(id: string): { seed: string; op: string; target?: string } {
  const tail = id.split('/').pop() ?? id;
  const [seed = '', op, ...rest] = tail.split('.');
  return { seed, op: op ?? 'clean', ...(rest.length ? { target: rest.join('.') } : {}) };
}

const overlaps = (a?: [number, number], b?: [number, number]) =>
  Boolean(a && b && a[0] <= b[1] && b[0] <= a[1]);

/** Every labelled defect of an item, with the operator's target marked. */
export function labelledDefects(id: string, labels: ItemLabels, units: UnitIndex): Defect[] {
  const { op, target } = parseItemId(id);
  const out: Defect[] = [];
  for (const [r, status] of Object.entries(labels.requirements)) {
    if (!SCORED_PROBLEM_STATUSES.has(status)) continue;
    out.push({
      key: `req:${r}`,
      type: 'requirement',
      requirement: r,
      accepted: new Set<string>([status, ...(labels.requirementsAccept[r] ?? [])]),
      target: REQ_OPS.has(op) && target === r,
    });
  }
  for (const u of labels.units) {
    if (u.role !== 'unexplained_behavioral') continue;
    // Without a symbol the label cannot locate the unit, so the defect cannot be matched strictly.
    const lines = u.symbol ? units(id, u.file, u.symbol) : undefined;
    out.push({
      key: `unit:${u.file}#${u.symbol ?? ''}`,
      type: 'unit',
      file: u.file,
      ...(lines ? { lines } : { unmeasurable: true }),
      target: op === 'inject_config',
    });
  }
  for (const t of labels.testIntegrity) {
    const lines = t.symbol ? units(id, t.file, t.symbol) : undefined;
    out.push({
      key: `test:${t.file}#${t.symbol ?? ''}`,
      type: 'test_integrity',
      file: t.file,
      ...(lines ? { lines } : { unmeasurable: true }),
      target: op === 'weaken_assertion' || op === 'skip_test',
    });
  }
  // skip_test items label a fact, not a testIntegrity entry: the skipped test is the target defect. Without a symbol,
  // the defect is file-level (a test-integrity finding on that file matches it).
  if (op === 'skip_test' && !labels.testIntegrity.length)
    for (const f of labels.facts.filter((x) => x.kind === 'test_skipped' && x.file)) {
      const lines = f.symbol ? units(id, f.file as string, f.symbol) : undefined;
      out.push({
        key: `test:${f.file}#${f.symbol ?? ''}`,
        type: 'test_integrity',
        file: f.file as string,
        ...(lines ? { lines } : f.symbol ? { unmeasurable: true } : {}),
        target: true,
      });
    }
  for (const r of labels.claimMismatch)
    out.push({ key: `claim:${r}`, type: 'claim', requirement: r, target: op === 'claim_all_done' });
  return out;
}

export interface MatchResult {
  strict: Map<string, string>; // defect key -> finding id
  typeMismatch: Map<string, string>; // defect key -> finding id (right place, wrong kind)
  duplicates: string[];
  unmatched: string[];
}

function relation(f: SurfacedFinding, d: Defect): 'strict' | 'type' | null {
  if (d.type === 'requirement') {
    if (f.type !== 'requirement' || f.requirement !== d.requirement) return null;
    return f.status && d.accepted?.has(f.status) ? 'strict' : 'type';
  }
  if (d.type === 'claim') return f.type === 'claim' && f.requirement === d.requirement ? 'strict' : null; // claim facets are matched separately
  if (d.unmeasurable || f.file !== d.file) return null;
  // A skipped test with no resolvable symbol range: the file-level test-integrity finding is the defect.
  const place = d.lines ? overlaps(f.lines, d.lines) : d.type === 'test_integrity';
  if (!place) return null;
  if (d.type === 'unit') return f.type === 'unit' ? 'strict' : null;
  return f.type === 'test_integrity' || f.type === 'fact' ? 'strict' : f.type === 'unit' ? 'type' : null;
}

/** One-to-one matching: strict matches first, then type mismatches; the rest are duplicates or unmatched. */
export function matchFindings(surfaced: readonly SurfacedFinding[], defects: readonly Defect[]): MatchResult {
  const res: MatchResult = { strict: new Map(), typeMismatch: new Map(), duplicates: [], unmatched: [] };
  const used = new Set<string>();
  for (const f of surfaced)
    for (const d of defects)
      if (!res.strict.has(d.key) && relation(f, d) === 'strict') {
        res.strict.set(d.key, f.id);
        used.add(f.id);
        break;
      }
  for (const f of surfaced) {
    if (used.has(f.id)) continue;
    const d = defects.find(
      (x) => !res.strict.has(x.key) && !res.typeMismatch.has(x.key) && relation(f, x) === 'type',
    );
    if (d) {
      res.typeMismatch.set(d.key, f.id);
      used.add(f.id);
    }
  }
  for (const f of surfaced) {
    if (used.has(f.id)) continue;
    if (defects.some((d) => relation(f, d) !== null)) res.duplicates.push(f.id);
    else res.unmatched.push(f.id);
  }
  // A claim-mismatch facet on a requirement finding satisfies the claim defect without being a second finding.
  for (const d of defects)
    if (d.type === 'claim' && !res.strict.has(d.key)) {
      const f = surfaced.find((x) => x.type === 'requirement' && x.claim && x.requirement === d.requirement);
      if (f) res.strict.set(d.key, `${f.id}#claim`);
    }
  return res;
}

export interface ItemScore {
  id: string;
  seed: string;
  failed: boolean;
  target?: { measurable: boolean; strict: boolean; any: boolean };
  defects: { measurable: number; strict: number; any: number; unmeasurable: number };
  surfaced: number;
  correctFindings: number;
  typeMismatches: number;
  duplicates: number;
  falseFindings: number;
  defective: boolean;
  requirements: { labelled: number; correct: number; abstained: number };
  entireReview: boolean;
  entireReviewBlockers: string[];
  costUsd: number | null;
  latencyMs: number | null;
  cached: boolean | null;
}

export function scoreItem(p: Prediction, units: UnitIndex): ItemScore {
  const { seed } = parseItemId(p.id);
  const defects = labelledDefects(p.id, p.labels, units);
  const m = matchFindings(p.surfaced, defects);
  const blockers: string[] = [];
  const target = defects.filter((d) => d.target);
  let reqCorrect = 0;
  let abstained = 0;
  const labelled = Object.entries(p.labels.requirements);
  for (const [r, status] of labelled) {
    const actual = p.statuses[r];
    if (actual === 'uncertain') abstained++;
    if (
      actual !== undefined &&
      new Set<string>([status, ...(p.labels.requirementsAccept[r] ?? [])]).has(actual)
    )
      reqCorrect++;
    else blockers.push(`requirement ${r}: labelled ${status}, got ${actual ?? 'none'}`);
  }
  // Unit expectations: roles when the system assigns them; otherwise surfaced unit findings stand in for roles.
  for (const u of p.labels.units) {
    const accepted = new Set<string>([u.role, ...(u.accept ?? [])]);
    if (p.unitRoles) {
      const got = p.unitRoles.find((x) => x.file === u.file && (!u.symbol || x.symbol === u.symbol))?.role;
      if (!got || !accepted.has(got))
        blockers.push(`unit ${u.file}#${u.symbol ?? ''}: labelled ${u.role}, got ${got ?? 'none'}`);
    } else {
      const lines = u.symbol ? units(p.id, u.file, u.symbol) : undefined;
      const flagged = p.surfaced.some(
        (f) => f.type === 'unit' && f.file === u.file && (!lines || overlaps(f.lines, lines)),
      );
      if (u.role === 'unexplained_behavioral' ? !flagged : flagged && !accepted.has('unexplained_behavioral'))
        blockers.push(
          `unit ${u.file}#${u.symbol ?? ''}: labelled ${u.role}, ${flagged ? 'flagged' : 'not flagged'}`,
        );
    }
  }
  for (const f of p.labels.facts) {
    // Only a symbol-level label constrains the line; a file-level label is checked at file level.
    const lines = f.symbol ? units(p.id, f.file ?? '', f.symbol) : undefined;
    const found = (p.facts ?? []).some(
      (x) =>
        x.kind === f.kind &&
        (!f.file || x.file === f.file) &&
        (!lines || x.line === undefined || (x.line >= lines[0] && x.line <= lines[1])),
    );
    if (!found) blockers.push(`fact ${f.kind} ${f.file ?? ''} not reported`);
  }
  for (const d of defects.filter((x) => x.type === 'test_integrity' || x.type === 'claim'))
    if (!m.strict.has(d.key)) blockers.push(`${d.type} ${d.key} not surfaced`);
  for (const d of target)
    if (d.type === 'requirement' && !m.strict.has(d.key))
      blockers.push(`target ${d.key} not surfaced with the right type`);
  const incorrect = m.duplicates.length + m.unmatched.length + m.typeMismatch.size;
  if (incorrect) blockers.push(`${incorrect} incorrect surfaced finding(s)`);
  if (p.failed) blockers.push('review incomplete');
  const measurable = defects.filter((d) => !d.unmeasurable);
  const tMeasurable = target.filter((d) => !d.unmeasurable);
  return {
    id: p.id,
    seed,
    failed: p.failed,
    ...(target.length
      ? {
          target: {
            measurable: tMeasurable.length === target.length,
            strict: tMeasurable.length > 0 && tMeasurable.every((d) => m.strict.has(d.key)),
            any:
              tMeasurable.length > 0 &&
              tMeasurable.every((d) => m.strict.has(d.key) || m.typeMismatch.has(d.key)),
          },
        }
      : {}),
    defects: {
      measurable: measurable.length,
      strict: measurable.filter((d) => m.strict.has(d.key)).length,
      any: measurable.filter((d) => m.strict.has(d.key) || m.typeMismatch.has(d.key)).length,
      unmeasurable: defects.length - measurable.length,
    },
    surfaced: p.surfaced.length,
    correctFindings: [...m.strict.values()].filter((v) => !v.endsWith('#claim')).length,
    typeMismatches: m.typeMismatch.size,
    duplicates: m.duplicates.length,
    falseFindings: m.unmatched.length,
    defective: p.labels.pr === 'problem',
    requirements: { labelled: labelled.length, correct: reqCorrect, abstained },
    entireReview: blockers.length === 0,
    entireReviewBlockers: blockers,
    costUsd: p.costUsd,
    latencyMs: p.latencyMs,
    cached: p.cached,
  };
}

export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - w) / d, (c + w) / d];
}

export interface Ratio {
  k: number;
  n: number;
  interval: [number, number];
}
const ratio = (k: number, n: number): Ratio => ({ k, n, interval: wilson(k, n) });

export function aggregate(scores: readonly ItemScore[]) {
  const withTarget = scores.filter((s) => s.target);
  const measurableT = withTarget.filter((s) => s.target?.measurable);
  const live = scores
    .filter((s) => s.cached === false && s.latencyMs !== null)
    .map((s) => s.latencyMs as number);
  const sorted = [...live].sort((a, b) => a - b);
  const q = (f: number) => (sorted.length ? (sorted[Math.floor(f * (sorted.length - 1))] as number) : null);
  const clean = scores.filter((s) => !s.defective);
  const defective = scores.filter((s) => s.defective);
  const costs = scores.map((s) => s.costUsd).filter((c): c is number => c !== null);
  return {
    items: scores.length,
    seeds: new Set(scores.map((s) => s.seed)).size,
    targetRecallStrict: ratio(measurableT.filter((s) => s.target?.strict).length, measurableT.length),
    targetFlaggedAnyType: ratio(measurableT.filter((s) => s.target?.any).length, measurableT.length),
    targetUnmeasured: withTarget.length - measurableT.length,
    allDefectRecallStrict: ratio(
      scores.reduce((n, s) => n + s.defects.strict, 0),
      scores.reduce((n, s) => n + s.defects.measurable, 0),
    ),
    defectsUnmeasured: scores.reduce((n, s) => n + s.defects.unmeasurable, 0),
    findingPrecision: ratio(
      scores.reduce((n, s) => n + s.correctFindings, 0),
      scores.reduce((n, s) => n + s.surfaced, 0),
    ),
    typeMismatches: scores.reduce((n, s) => n + s.typeMismatches, 0),
    duplicates: scores.reduce((n, s) => n + s.duplicates, 0),
    falseFindings: scores.reduce((n, s) => n + s.falseFindings, 0),
    incorrectFindingsOnDefectivePRs: defective.reduce((n, s) => n + s.surfaced - s.correctFindings, 0),
    defectivePRs: defective.length,
    cleanPRFalsePositive: ratio(clean.filter((s) => s.surfaced > 0).length, clean.length),
    requirementStatusAccuracy: ratio(
      scores.reduce((n, s) => n + s.requirements.correct, 0),
      scores.reduce((n, s) => n + s.requirements.labelled, 0),
    ),
    abstentions: ratio(
      scores.reduce((n, s) => n + s.requirements.abstained, 0),
      scores.reduce((n, s) => n + s.requirements.labelled, 0),
    ),
    entireReview: ratio(scores.filter((s) => s.entireReview).length, scores.length),
    completion: ratio(scores.filter((s) => !s.failed).length, scores.length),
    costPerReview: costs.length === scores.length ? costs.reduce((a, b) => a + b, 0) / scores.length : null,
    latencyLive: { n: live.length, p50: q(0.5), p95: q(0.95) },
    cachedItems: scores.filter((s) => s.cached === true).length,
  };
}
