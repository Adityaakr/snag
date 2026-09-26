/**
 * Golden scenario harness (BUILD_PROMPT Appendix D): loads a scenario directory, wires fakes, runs the review.
 * Shared by the golden tests, the fixture generator and `pnpm eval:golden`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type ContentSource, classifyFile, type ReferenceIndex } from '@remit/analysis';
import { type IssueSnapshot, parseConfig, parseIssueMarkdown, type RemitConfig } from '@remit/core';
import {
  CostTracker,
  FakeJev,
  FakeLlm,
  type JevProvider,
  type JevScript,
  type LlmProvider,
  type LlmScript,
} from '@remit/providers';
import { runReview } from '../review.js';
import type { ReviewInput } from '../types.js';

export const GOLDEN_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'golden');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Reads base/ and head/ trees. */
export function treeContents(dir: string): ContentSource {
  return {
    async get(side, path) {
      const p = join(dir, side, path);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    },
  };
}

/** Counts whole-word references in the head tree, excluding test files and the definition line (6.4.2). */
export function treeReferences(dir: string): ReferenceIndex {
  const root = join(dir, 'head');
  const files = walk(root).map((p) => ({
    path: relative(root, p),
    lines: readFileSync(p, 'utf8').split('\n'),
  }));
  return {
    async count(name, at) {
      const re = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`);
      let n = 0;
      for (const f of files) {
        if (classifyFile(f.path).kind === 'test') continue;
        f.lines.forEach((l, i) => {
          if (re.test(l) && !(f.path === at.file && i + 1 === at.line)) n++;
        });
      }
      return n;
    },
  };
}

export interface Scenario {
  name: string;
  dir: string;
  issues: IssueSnapshot[];
  config: RemitConfig;
  input: ReviewInput;
  llmScript: LlmScript;
  jevScript: JevScript;
  expected: Expected;
}

export interface UnitSelector {
  file: string;
  symbol?: string;
}

export interface Expected {
  requirements: Record<string, string>;
  units?: (UnitSelector & { role: string })[];
  findings?: {
    id?: string;
    unit?: UnitSelector;
    type?: string;
    priority: string;
    route?: string;
    reason?: string;
  }[];
  noFindingsOfPriority?: string[];
  noFindings?: boolean;
  facts?: { kind: string; severity: string; unit?: UnitSelector }[];
  claimMismatch?: string[];
  warnings?: string[];
  reasons?: Record<string, string>;
  requirementIds?: string[];
  mustNotAppearInJudgeViews?: string[];
  tested?: Record<string, string>;
  filtered?: (UnitSelector & { reason: string })[];
  sameVerdictsAs?: string;
}

export function loadScenario(name: string): Scenario {
  const dir = join(GOLDEN_DIR, name);
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');
  const issues = readdirSync(dir)
    .filter((f) => /^issue.*\.md$/.test(f))
    .sort()
    .map((f) => parseIssueMarkdown(read(f)))
    .sort((a, b) => a.ref.number - b.ref.number);
  const config = existsSync(join(dir, 'config.yml'))
    ? parseConfig(read('config.yml')).config
    : parseConfig('').config;
  const prBody = existsSync(join(dir, 'pr-body.md')) ? read('pr-body.md') : '';
  const input: ReviewInput = {
    mode: 'local',
    baseSha: 'base',
    headSha: 'head',
    linkStrength: issues.length ? 'closing' : 'none',
    issueRefs: issues.map((i) => i.ref),
    issues,
    pr: { title: '', body: prBody },
    diffText: read('diff.patch'),
  };
  return {
    name,
    dir,
    issues,
    config,
    input,
    llmScript: existsSync(join(dir, 'llm-script.json')) ? JSON.parse(read('llm-script.json')) : {},
    jevScript: existsSync(join(dir, 'jev-script.json')) ? JSON.parse(read('jev-script.json')) : {},
    expected: existsSync(join(dir, 'expected.json'))
      ? JSON.parse(read('expected.json'))
      : { requirements: {} },
  };
}

/** Runs a scenario with the given providers (FakeJev from the script by default). */
export async function runScenario(s: Scenario, providers: { jev?: JevProvider; llm?: LlmProvider } = {}) {
  const jev = providers.jev ?? new FakeJev(s.jevScript, 'jev-1.13.0', s.name);
  const llm = providers.llm ?? new FakeLlm(s.llmScript);
  const result = await runReview(s.input, {
    jev,
    llm,
    config: s.config,
    reviewId: `rv_${s.name}`,
    costs: new CostTracker(s.config.budgets.max_usd_per_review),
    contents: treeContents(s.dir),
    references: treeReferences(s.dir),
    now: () => 0,
  });
  return { result, jev, llm };
}

export function listScenarios(): string[] {
  return existsSync(GOLDEN_DIR)
    ? readdirSync(GOLDEN_DIR)
        .filter((d) => statSync(join(GOLDEN_DIR, d)).isDirectory())
        .sort()
    : [];
}

function findUnit(result: import('@remit/core').ReviewResult, sel: UnitSelector) {
  return result.units.find((x) => x.file === sel.file && (!sel.symbol || x.symbol?.name === sel.symbol));
}

/**
 * Checks a review result against a scenario's expectations and returns every failure as text (empty means the
 * scenario passes). Used by `pnpm eval:golden`; the golden tests assert the same conditions directly.
 */
export function checkExpected(result: import('@remit/core').ReviewResult, e: Expected): string[] {
  const fail: string[] = [];
  const statuses = Object.fromEntries(result.requirementVerdicts.map((v) => [v.requirementId, v.status]));
  const want = JSON.stringify(Object.entries(e.requirements).sort());
  const got = JSON.stringify(Object.entries(statuses).sort());
  if (want !== got) fail.push(`requirement statuses ${got}, expected ${want}`);
  if (
    e.requirementIds &&
    JSON.stringify(result.requirements.map((r) => r.id)) !== JSON.stringify(e.requirementIds)
  ) {
    fail.push(
      `requirement ids ${result.requirements.map((r) => r.id).join(',')}, expected ${e.requirementIds.join(',')}`,
    );
  }
  for (const u of e.units ?? []) {
    const unit = findUnit(result, u);
    const role = unit ? result.unitVerdicts.find((v) => v.unitId === unit.id)?.role : undefined;
    if (role !== u.role) fail.push(`unit ${u.file}#${u.symbol ?? ''} role ${role}, expected ${u.role}`);
  }
  for (const f of e.facts ?? []) {
    const pool = f.unit ? (findUnit(result, f.unit)?.facts ?? []) : result.units.flatMap((x) => x.facts);
    if (!pool.some((x) => x.kind === f.kind && x.severity === f.severity))
      fail.push(`missing fact ${f.kind} ${f.severity}${f.unit ? ` in ${f.unit.file}` : ''}`);
  }
  for (const f of e.findings ?? []) {
    const unit = f.unit ? findUnit(result, f.unit) : undefined;
    const match = result.findings.find((x) => {
      if (f.id && x.id !== f.id) return false;
      if (f.type && x.type !== f.type) return false;
      if (f.unit) {
        if (!unit) return false;
        const target =
          x.type === 'test_integrity' || x.type === 'fact'
            ? unit.facts.some((ff) => `F-${ff.id}` === x.id) || x.targetId === unit.id
            : x.targetId === unit.id;
        if (!target) return false;
      }
      return true;
    });
    if (!match) fail.push(`missing finding ${JSON.stringify(f)}`);
    else {
      if (match.priority !== f.priority)
        fail.push(`${match.id} priority ${match.priority}, expected ${f.priority}`);
      if (f.route && match.route !== f.route)
        fail.push(`${match.id} route ${match.route}, expected ${f.route}`);
      if (
        f.reason &&
        !match.reasons
          .map((r) => r.text)
          .join(' ')
          .includes(f.reason)
      )
        fail.push(`${match.id} reason lacks "${f.reason}"`);
    }
  }
  for (const p of e.noFindingsOfPriority ?? []) {
    const extra = result.findings.filter((f) => f.priority === p).map((f) => f.id);
    if (extra.length) fail.push(`unexpected ${p} findings ${extra.join(',')}`);
  }
  if (e.noFindings && result.findings.length)
    fail.push(`unexpected findings ${result.findings.map((f) => f.id).join(',')}`);
  for (const id of e.claimMismatch ?? [])
    if (!result.requirementVerdicts.find((v) => v.requirementId === id)?.claimMismatch)
      fail.push(`${id} has no claim mismatch`);
  for (const [id, text] of Object.entries(e.reasons ?? {})) {
    if (!result.requirementVerdicts.find((v) => v.requirementId === id)?.reasons.some((r) => r.text === text))
      fail.push(`${id} lacks reason "${text}"`);
  }
  for (const w of e.warnings ?? [])
    if (!result.warnings.join('\n').includes(w)) fail.push(`missing warning "${w}"`);
  for (const [id, tested] of Object.entries(e.tested ?? {})) {
    const t = result.requirementVerdicts.find((v) => v.requirementId === id)?.tested;
    if (t !== tested) fail.push(`${id} tested ${t}, expected ${tested}`);
  }
  for (const f of e.filtered ?? []) {
    const u = findUnit(result, f);
    if (u?.filtered !== f.reason) fail.push(`${f.file} filtered ${u?.filtered}, expected ${f.reason}`);
  }
  return fail;
}
