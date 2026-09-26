/**
 * Mutation seeds (BUILD_PROMPT Appendix G.2): a small repo with a base tree, a clean head tree (a complete, correct
 * PR), a task-list issue, a PR body and a requirement-to-unit annotation. Seeds live in
 * eval/corpora/mutations/seeds/<id>/ as seed.json, issue.md, pr.md, base/** and head/**.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';

const Ref = z.object({ file: z.string(), symbol: z.string().optional() });
/**
 * An implementing or test unit. Without `remove` or `replace`, drop_requirement reverts the whole symbol to base (or
 * removes it, or the whole file when `symbol` is absent). A symbol shared by two requirements must say exactly what
 * belongs to this one: statements to remove (located by a snippet) or expressions to restore (exact node text).
 */
const UnitRef = Ref.extend({
  remove: z.array(z.string()).optional(),
  replace: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
});
/** One literal or operator token inside a symbol, located by its exact text. */
const Edit = z.object({ file: z.string(), symbol: z.string(), from: z.string(), to: z.string() });
const Removal = z.object({ file: z.string(), symbol: z.string(), contains: z.string() });

export const SeedRequirementSchema = z.object({
  id: z.string().regex(/^R\d+$/),
  /** The task-list item text, verbatim. */
  text: z.string(),
  /** Symbols (or whole files, without `symbol`) that implement the requirement; no symbol serves two. */
  implementing: z.array(UnitRef).min(1),
  tests: z.array(UnitRef).min(1),
  /** flip_condition: one change in the implementation and the same change to the expected value in its test. */
  flip: z.object({ impl: Edit, test: Edit }).optional(),
  /** partial_requirement: one case of a multi-case requirement and its test case. */
  partial: z.object({ impl: Removal, test: Removal }).optional(),
  /** unwire: the call site of the requirement's new function; the call is replaced by its first argument. */
  unwire: z.object({ file: z.string(), symbol: z.string(), callee: z.string() }).optional(),
});

export const SeedSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  language: z.enum(['ts', 'py', 'rs']),
  annotated_by: z.enum(['claude-code', 'human']),
  /** Pinned split (D26). Without it, the split is splitOf(id). */
  split: z.enum(['dev', 'test']).optional(),
  summary: z.string(),
  requirements: z.array(SeedRequirementSchema).min(3).max(5),
  /** Changed units that serve no requirement directly (plumbing, docs). */
  incidental: z
    .array(Ref.extend({ role: z.enum(['supporting', 'unexplained_benign', 'ignored']) }))
    .default([]),
  /** inject_config: a runtime default in a config module the PR does not touch. */
  config: Edit,
  /** weaken_assertion and skip_test: an existing test the PR does not touch. */
  unrelatedTest: z.object({ file: z.string(), symbol: z.string() }),
  /** inject_refactor: a local rename inside a function the PR does not touch. */
  unrelatedCode: z.object({
    file: z.string(),
    symbol: z.string(),
    rename: z.object({ from: z.string(), to: z.string() }),
  }),
});
export type Seed = z.infer<typeof SeedSchema>;
export type SeedRequirement = z.infer<typeof SeedRequirementSchema>;

export interface LoadedSeed {
  seed: Seed;
  dir: string;
  issue: string;
  pr: { title: string; body: string };
  base: Record<string, string>;
  head: Record<string, string>;
}

function readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

/** Reads a seed directory. The first `# ` line of pr.md is the PR title. */
export function loadSeed(dir: string): LoadedSeed {
  const seed = SeedSchema.parse(JSON.parse(readFileSync(join(dir, 'seed.json'), 'utf8')));
  const prText = readFileSync(join(dir, 'pr.md'), 'utf8');
  const [first, ...rest] = prText.split('\n');
  const title = first?.startsWith('# ') ? first.slice(2).trim() : seed.summary;
  return {
    seed,
    dir,
    issue: readFileSync(join(dir, 'issue.md'), 'utf8'),
    pr: { title, body: (first?.startsWith('# ') ? rest.join('\n') : prText).trim() },
    base: readTree(join(dir, 'base')),
    head: readTree(join(dir, 'head')),
  };
}

/** Every seed directory under a root. */
export function seedDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .map((n) => join(root, n))
    .filter((p) => existsSync(join(p, 'seed.json')));
}
