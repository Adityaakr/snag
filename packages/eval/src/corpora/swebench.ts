/**
 * Corpus A (BUILD_PROMPT 11.1): SWE-bench Verified issues with gold patches and plausible agent patches, labeled
 * from the PatchDiff study ("Are 'Solved Issues' in SWE-bench Really Solved Correctly?", ICSE 2026). The loader reads
 * only files under eval/corpora/swebench/raw/ (written by fetchCorpusA); it never touches the network. The label
 * mapping is documented in docs/eval.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigSchema, type IssueSnapshot, issueContentHash } from '@remit/core';
import type { ReviewInput } from '@remit/pipeline';
import type { EvalItem } from '../item.js';

export const TOOLS = {
  OpenHands: '20241029_OpenHands-CodeAct-2.1-sonnet-20241022_verified',
  CodeStory: '20241221_codestory_midwit_claude-3-5-sonnet_swe-search',
  LearnByInteract: '20250110_learn_by_interact_claude3.5',
} as const;
export type Tool = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as Tool[];

/** Agent patches above this size are excluded (a few are megabytes of generated files). */
export const MAX_PATCH_BYTES = 200_000;

export interface SwebenchRow {
  instance_id: string;
  repo: string;
  base_commit: string;
  patch: string;
  problem_statement: string;
}

export interface ToolRaw {
  /** instance_id to agent patch (empty or missing patches are dropped on read). */
  preds: Map<string, string>;
  resolved: Set<string>;
  rq1: Record<string, { difference: string; oracle_pass_model_fail?: string[] }>;
  /** instance_id to the union of differentiating test ids (empty: tested, no divergence found). */
  rq2: Record<string, string[]>;
}

export interface Rq34Row {
  tool: Tool;
  instance_id: string;
  diff_pattern: string;
  correctness: string;
}

export interface CorpusARaw {
  swebench: SwebenchRow[];
  tools: Partial<Record<Tool, ToolRaw>>;
  rq34: Rq34Row[];
}

export type LabelSource = 'gold' | 'rq34_manual' | 'rq1_devtests' | 'rq2_divergent' | 'rq2_no_divergence';
export type Strength = 'strong' | 'medium' | 'weak';

export interface CorpusAEntry {
  id: string;
  instanceId: string;
  tool: Tool | 'gold';
  label: 'problem' | 'clean';
  source: LabelSource;
  strength: Strength;
  diffPattern?: string;
  correctness?: string;
  patch: string;
}

export interface CorpusACounts {
  gold: number;
  problem: number;
  clean: number;
  excluded: Record<string, number>;
  bySource: Record<string, number>;
}

/** The mapping table in docs/eval.md, applied to one resolved agent patch. Null means "exclude". */
export function labelAgentPatch(
  tool: Tool,
  instanceId: string,
  raw: CorpusARaw,
): Omit<CorpusAEntry, 'id' | 'instanceId' | 'tool' | 'patch'> | { exclude: string } {
  const t = raw.tools[tool];
  if (!t?.resolved.has(instanceId)) return { exclude: 'not_plausible' };
  const manual = raw.rq34.find((r) => r.tool === tool && r.instance_id === instanceId);
  if (manual) {
    const extra = { diffPattern: manual.diff_pattern, correctness: manual.correctness };
    if (manual.correctness.startsWith('incorrect_'))
      return { label: 'problem', source: 'rq34_manual', strength: 'strong', ...extra };
    if (manual.correctness.startsWith('correct_'))
      return { label: 'clean', source: 'rq34_manual', strength: 'strong', ...extra };
    return { label: 'problem', source: 'rq34_manual', strength: 'weak', ...extra };
  }
  const rq1 = t.rq1[instanceId];
  if (rq1?.difference === 'functionality')
    return { label: 'problem', source: 'rq1_devtests', strength: 'medium' };
  const rq2 = t.rq2[instanceId];
  if (rq2?.length) return { label: 'problem', source: 'rq2_divergent', strength: 'weak' };
  if (rq1) return { exclude: 'coding_conventions_only' };
  if (rq2) return { label: 'clean', source: 'rq2_no_divergence', strength: 'weak' };
  return { exclude: 'not_tested_by_patchdiff' };
}

/** Labels every gold patch and every plausible agent patch. */
export function labelCorpusA(raw: CorpusARaw): { entries: CorpusAEntry[]; counts: CorpusACounts } {
  const entries: CorpusAEntry[] = [];
  const counts: CorpusACounts = { gold: 0, problem: 0, clean: 0, excluded: {}, bySource: {} };
  const exclude = (why: string) => {
    counts.excluded[why] = (counts.excluded[why] ?? 0) + 1;
  };
  const push = (e: CorpusAEntry) => {
    entries.push(e);
    counts[e.label]++;
    counts.bySource[`${e.source}:${e.strength}`] = (counts.bySource[`${e.source}:${e.strength}`] ?? 0) + 1;
  };
  for (const row of raw.swebench) {
    counts.gold++;
    push({
      id: `gold:${row.instance_id}`,
      instanceId: row.instance_id,
      tool: 'gold',
      label: 'clean',
      source: 'gold',
      strength: 'strong',
      patch: row.patch,
    });
  }
  const known = new Set(raw.swebench.map((r) => r.instance_id));
  for (const tool of TOOL_NAMES) {
    const t = raw.tools[tool];
    if (!t) continue;
    for (const instanceId of [...t.resolved].sort()) {
      if (!known.has(instanceId)) {
        exclude('not_in_swebench_verified');
        continue;
      }
      const verdict = labelAgentPatch(tool, instanceId, raw);
      if ('exclude' in verdict) {
        exclude(verdict.exclude);
        continue;
      }
      const patch = t.preds.get(instanceId);
      if (!patch) {
        exclude('empty_patch');
        continue;
      }
      if (Buffer.byteLength(patch) > MAX_PATCH_BYTES) {
        exclude('oversized_patch');
        continue;
      }
      push({ id: `${tool}:${instanceId}`, instanceId, tool, ...verdict, patch });
    }
  }
  return { entries, counts };
}

/** `django__django-17087` to owner django, repo django, number 17087. */
export function instanceRef(instanceId: string, repo: string): IssueSnapshot['ref'] {
  const [owner = 'unknown', name = 'unknown'] = repo.split('/');
  const n = Number(/-(\d+)$/.exec(instanceId)?.[1] ?? 0);
  return { owner, repo: name, number: n };
}

export function corpusAItem(entry: CorpusAEntry, row: SwebenchRow): EvalItem {
  const [title = row.instance_id, ...rest] = row.problem_statement.trim().split('\n');
  const snapshot: Omit<IssueSnapshot, 'contentHash'> = {
    ref: instanceRef(row.instance_id, row.repo),
    title: title.trim().slice(0, 200),
    body: rest.join('\n').trim() || title,
    author: 'swebench',
    state: 'closed',
    comments: [],
  };
  const issue: IssueSnapshot = { ...snapshot, contentHash: issueContentHash(snapshot) };
  const input: ReviewInput = {
    mode: 'local',
    repo: row.repo,
    baseSha: row.base_commit,
    headSha: `${entry.tool}-${row.instance_id}`,
    linkStrength: 'closing',
    issueRefs: [issue.ref],
    issues: [issue],
    pr: { title: `Fix ${row.instance_id}`, body: '' },
    diffText: entry.patch.endsWith('\n') ? entry.patch : `${entry.patch}\n`,
  };
  return {
    id: entry.id,
    corpus: 'swebench',
    seedId: row.instance_id,
    input,
    config: ConfigSchema.parse({}),
    labels: {
      requirements: {},
      requirementsAccept: {},
      units: [],
      facts: [],
      testIntegrity: [],
      claimMismatch: [],
      pr: entry.label,
    },
    meta: {
      tool: entry.tool,
      source: entry.source,
      strength: entry.strength,
      ...(entry.diffPattern ? { diffPattern: entry.diffPattern } : {}),
      ...(entry.correctness ? { correctness: entry.correctness } : {}),
    },
    annotatedBy: 'study',
  };
}

// ------------------------------------------------------------------------------------------------ raw files

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

function readJsonl<T>(p: string): T[] {
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

/** Parses RQ34.csv (four plain columns, no quoting in the source). */
export function parseRq34(text: string): Rq34Row[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (header?.trim() !== 'tool,instance_id,diff_pattern,correctness')
    throw new Error(`RQ34.csv: unexpected header "${header}"`);
  return lines
    .filter((l) => l.trim())
    .map((l) => {
      const [tool, instance_id, diff_pattern, correctness] = l.split(',').map((x) => x.trim());
      if (!tool || !(tool in TOOLS) || !instance_id || !diff_pattern || !correctness)
        throw new Error(`RQ34.csv: bad row "${l}"`);
      return { tool: tool as Tool, instance_id, diff_pattern, correctness };
    });
}

/** Reads eval/corpora/swebench/raw/. Tools whose files are missing are skipped. */
export function readCorpusARaw(rawDir: string): CorpusARaw {
  const swebench = readJsonl<SwebenchRow>(join(rawDir, 'swebench_verified.jsonl'));
  const pd = join(rawDir, 'patchdiff');
  const tools: CorpusARaw['tools'] = {};
  for (const tool of TOOL_NAMES) {
    const dir = join(pd, 'tool_results', TOOLS[tool]);
    if (!existsSync(join(dir, 'results.json'))) continue;
    const preds = new Map<string, string>();
    for (const row of readJsonl<{ instance_id: string; model_patch?: string | null }>(
      join(dir, 'all_preds.jsonl'),
    ))
      if (row.model_patch) preds.set(row.instance_id, row.model_patch);
    const rq1Path = join(pd, 'results', `RQ1_${tool}_runall.json`);
    const rq2Path = join(pd, 'derived', `RQ2_${tool}_divergent.json`);
    tools[tool] = {
      preds,
      resolved: new Set(readJson<{ resolved: string[] }>(join(dir, 'results.json')).resolved),
      rq1: existsSync(rq1Path) ? readJson(rq1Path) : {},
      rq2: existsSync(rq2Path) ? readJson(rq2Path) : {},
    };
  }
  const rq34Path = join(pd, 'results', 'RQ34.csv');
  return { swebench, tools, rq34: existsSync(rq34Path) ? parseRq34(readFileSync(rq34Path, 'utf8')) : [] };
}

/** Builds corpus A items from raw files. */
export function corpusAItems(raw: CorpusARaw): { items: EvalItem[]; counts: CorpusACounts } {
  const rows = new Map(raw.swebench.map((r) => [r.instance_id, r]));
  const { entries, counts } = labelCorpusA(raw);
  return {
    items: entries.map((e) => corpusAItem(e, rows.get(e.instanceId) as SwebenchRow)),
    counts,
  };
}
