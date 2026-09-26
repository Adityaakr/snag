/**
 * Builds corpus B items from seeds (BUILD_PROMPT 11.1, G.1): the clean seed plus every mutation, each with its diff
 * recomputed against base. A seed and all of its mutations land in the same split, chosen by a stable hash of the
 * seed id (70% dev, 30% test, 11.2).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { diffTrees } from '@remit/analysis';
import { ConfigSchema, parseIssueMarkdown } from '@remit/core';
import type { ReviewInput } from '@remit/pipeline';
import { CORPORA_ROOT, itemFileName, saveItem } from '../corpora/files.js';
import type { EvalItem } from '../item.js';
import { allMutations, cleanLabels, type Mutation } from './operators.js';
import { type LoadedSeed, loadSeed, seedDirs } from './seed.js';

export const SEEDS_ROOT = join(CORPORA_ROOT, 'mutations', 'seeds');

/** The first 32 bits of sha256(id) as a fraction in [0, 1). */
export function hashFraction(id: string): number {
  return Number.parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16) / 0x1_0000_0000;
}

/** 70/30 by hash. */
export function splitOf(id: string): 'dev' | 'test' {
  return hashFraction(id) < 0.7 ? 'dev' : 'test';
}

/**
 * Stratified assignment for a small seed set (D26): within each language, the round(30%) seeds with the highest hash
 * fraction go to test. Used once to pin `split` in seed.json; pinned seeds never move.
 */
export function stratifiedSplits(
  seeds: readonly { id: string; language: string }[],
): Record<string, 'dev' | 'test'> {
  const out: Record<string, 'dev' | 'test'> = {};
  const groups = new Map<string, string[]>();
  for (const s of seeds) groups.set(s.language, [...(groups.get(s.language) ?? []), s.id]);
  for (const ids of groups.values()) {
    const sorted = [...ids].sort((a, b) => hashFraction(a) - hashFraction(b));
    const test = Math.round(sorted.length * 0.3);
    sorted.forEach((id, i) => {
      out[id] = i >= sorted.length - test ? 'test' : 'dev';
    });
  }
  return out;
}

function item(seed: LoadedSeed, m: Mutation | null): EvalItem {
  const issue = parseIssueMarkdown(seed.issue);
  const head = m?.head ?? seed.head;
  const input: ReviewInput = {
    mode: 'local',
    baseSha: 'base',
    headSha: m ? `head-${m.operator}-${m.target}` : 'head',
    linkStrength: 'closing',
    issueRefs: [issue.ref],
    issues: [issue],
    pr: { title: seed.pr.title, body: m?.prBody ?? seed.pr.body },
    diffText: diffTrees(seed.base, head),
  };
  const id = m
    ? `${seed.seed.id}.${m.operator}.${m.target.replace(/[^\w.-]+/g, '_')}`
    : `${seed.seed.id}.clean`;
  return {
    id,
    corpus: 'mutations',
    seedId: seed.seed.id,
    ...(m ? { operator: m.operator, target: m.target } : {}),
    input,
    trees: { base: seed.base, head },
    config: ConfigSchema.parse({ extraction: { mode: 'tasklist_only' } }),
    labels: m ? m.labels : cleanLabels(seed),
    annotatedBy: seed.seed.annotated_by,
  };
}

/** The clean item and every mutation of one seed. */
export async function seedItems(seed: LoadedSeed): Promise<EvalItem[]> {
  return [item(seed, null), ...(await allMutations(seed)).map((m) => item(seed, m))];
}

/** Replaces one seed's items in its split. Returns the split and the item count. */
export async function writeSeedItems(
  dir: string,
  corporaRoot = CORPORA_ROOT,
): Promise<{ seed: string; split: 'dev' | 'test'; items: number; operators: Record<string, number> }> {
  const seed = loadSeed(dir);
  const split = seed.seed.split ?? splitOf(seed.seed.id);
  const prefix = itemFileName(`${seed.seed.id}.`).replace(/\.json$/, '');
  for (const s of ['dev', 'test'] as const) {
    const d = join(corporaRoot, 'mutations', s);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (f.startsWith(prefix)) rmSync(join(d, f));
  }
  const items = await seedItems(seed);
  const operators: Record<string, number> = {};
  for (const it of items) {
    saveItem(it, split, corporaRoot);
    const op = it.operator ?? 'clean';
    operators[op] = (operators[op] ?? 0) + 1;
  }
  return { seed: seed.seed.id, split, items: items.length, operators };
}

/** Regenerates corpus B from every seed under `seedsRoot`. Returns the counts per split. */
export async function writeMutationCorpus(
  seedsRoot = SEEDS_ROOT,
  corporaRoot = CORPORA_ROOT,
): Promise<{ dev: number; test: number; seeds: number }> {
  const counts = { dev: 0, test: 0, seeds: 0 };
  for (const dir of seedDirs(seedsRoot)) {
    const r = await writeSeedItems(dir, corporaRoot);
    counts[r.split] += r.items;
    counts.seeds++;
  }
  return counts;
}
