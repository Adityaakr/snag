/**
 * Evaluation items (BUILD_PROMPT 11): one review input plus ground-truth labels. Items from every corpus share
 * this shape so the runner, metrics, calibration and reports treat them alike.
 */
import { type ContentSource, classifyFile, type ReferenceIndex } from '@remit/analysis';
import { REQUIREMENT_STATUSES, type RemitConfig, type RequirementStatus, UNIT_ROLES } from '@remit/core';
import type { Expected, ReviewInput } from '@remit/pipeline';
import type { JevScript, LlmScript } from '@remit/providers';
import { z } from 'zod';

export const CORPORA = ['golden', 'mutations', 'swebench', 'shadow'] as const;
export type CorpusName = (typeof CORPORA)[number];

/** Problem classes and non-problem classes for requirement metrics (11.4). Other statuses are abstentions. */
export const PROBLEM_STATUSES: readonly RequirementStatus[] = [
  'missing',
  'partial',
  'contradicted',
  'interpretation_mismatch',
];
export const NON_PROBLEM_STATUSES: readonly RequirementStatus[] = ['done', 'preexisting', 'deferred'];

export const ItemLabelsSchema = z.object({
  /** Expected status per requirement id (ids are stable per section 5). */
  requirements: z.record(z.string(), z.enum(REQUIREMENT_STATUSES)),
  units: z.array(z.object({ file: z.string(), symbol: z.string().optional(), role: z.enum(UNIT_ROLES) })),
  facts: z.array(z.object({ kind: z.string(), file: z.string().optional(), symbol: z.string().optional() })),
  /** Units that should carry a test integrity finding. */
  testIntegrity: z.array(z.object({ file: z.string(), symbol: z.string().optional() })).default([]),
  pr: z.enum(['problem', 'clean']),
});
export type ItemLabels = z.infer<typeof ItemLabelsSchema>;

export interface TreeFiles {
  base: Record<string, string>;
  head: Record<string, string>;
}

export interface EvalItem {
  id: string;
  corpus: CorpusName;
  /** Items derived from one seed share it, so they land in the same split (11.2). */
  seedId?: string;
  operator?: string;
  /** What the operator targeted, for example a requirement id or a file. */
  target?: string;
  input: ReviewInput;
  trees?: TreeFiles;
  config: RemitConfig;
  labels: ItemLabels;
  scripts?: { jev: JevScript; llm: LlmScript };
  /** Golden scenarios keep their full expectations. */
  expected?: Expected;
  annotatedBy?: 'claude-code' | 'human' | 'study';
}

/** ContentSource over in-memory trees. */
export function treeContentSource(trees: TreeFiles): ContentSource {
  return { get: async (side, path) => trees[side][path] ?? null };
}

/** Whole-word references in the head tree, excluding tests and the definition line (6.4.2). */
export function treeReferenceIndex(trees: TreeFiles): ReferenceIndex {
  const files = Object.entries(trees.head).map(([path, text]) => ({ path, lines: text.split('\n') }));
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

/** PR-level label from requirement labels and expected findings: any problem status means "problem". */
export function prLabelFrom(
  requirements: Record<string, RequirementStatus>,
  extraProblem = false,
): 'problem' | 'clean' {
  return extraProblem || Object.values(requirements).some((s) => PROBLEM_STATUSES.includes(s))
    ? 'problem'
    : 'clean';
}
