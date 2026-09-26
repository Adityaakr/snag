/**
 * Extraction stability (BUILD_PROMPT 11.4): run extraction twice on about 10% of issues (by a stable hash of the
 * issue content) and report requirement-set agreement as Jaccard over normalized quotes. Live runs must pass an uncached
 * second provider, or both runs would return the same cassette.
 */
import { normalizeForMatch } from '@remit/core';
import { extractRequirements } from '@remit/pipeline';
import type { LlmProvider } from '@remit/providers';
import type { EvalItem } from './item.js';
import { hashFraction } from './mutations/generate.js';

export interface Stability {
  sampled: number;
  measured: number;
  /** Issues that could not be extracted (no LLM and no task list). */
  skipped: number;
  meanJaccard: number | null;
  /** True when every measured issue used the deterministic task-list path, so agreement is 1 by construction. */
  deterministic: boolean;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export async function measureStability(
  items: readonly EvalItem[],
  first?: LlmProvider,
  second: LlmProvider | undefined = first,
  fraction = 0.1,
): Promise<Stability> {
  // One item per distinct issue text; the round(fraction) issues with the lowest content hash, at least one.
  const byIssue = new Map<string, EvalItem>();
  for (const i of items) {
    const key = i.input.issues.map((x) => x.contentHash).join('|');
    if (!byIssue.has(key)) byIssue.set(key, i);
  }
  const count = fraction > 0 ? Math.max(1, Math.round(byIssue.size * fraction)) : 0;
  const sample = [...byIssue.entries()]
    .sort(([a], [b]) => hashFraction(a) - hashFraction(b))
    .slice(0, count)
    .map(([, i]) => i);
  const scores: number[] = [];
  let skipped = 0;
  let deterministic = true;
  for (const item of sample) {
    const quotes = async (llm?: LlmProvider) => {
      const r = await extractRequirements(item.input.issues, {
        ...(llm ? { llm } : {}),
        config: item.config,
        reviewId: `stability_${item.id}`,
      });
      return new Set(r.requirements.map((q) => normalizeForMatch(q.quote).toLowerCase()));
    };
    try {
      const usesLlm = item.config.extraction.mode !== 'tasklist_only' && Boolean(first);
      if (usesLlm) deterministic = false;
      scores.push(
        jaccard(await quotes(usesLlm ? first : undefined), await quotes(usesLlm ? second : undefined)),
      );
    } catch {
      skipped++;
    }
  }
  return {
    sampled: sample.length,
    measured: scores.length,
    skipped,
    meanJaccard: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    deterministic: deterministic && scores.length > 0,
  };
}
