/**
 * The mutation operators of BUILD_PROMPT Appendix G.1. Each one edits the head tree of a clean seed with tree-sitter,
 * re-parses every file it touched, and returns the expected labels. Items are built from the result in generate.ts.
 */
import type { ItemLabels } from '../item.js';
import {
  addSkipMarker,
  assertParses,
  findExact,
  findRemovable,
  findToken,
  MutationError,
  renameIdentifier,
  replaceCallWithArgument,
  splice,
  symbolSpan,
  weakenAssertion,
} from './ast.js';
import type { LoadedSeed, SeedRequirement } from './seed.js';

export const OPERATORS = [
  'drop_requirement',
  'flip_condition',
  'partial_requirement',
  'weaken_assertion',
  'skip_test',
  'inject_config',
  'inject_refactor',
  'unwire',
  'claim_all_done',
] as const;
export type Operator = (typeof OPERATORS)[number];

export interface Mutation {
  operator: Operator;
  /** A requirement id or a file, per G.1. */
  target: string;
  head: Record<string, string>;
  prBody?: string;
  labels: ItemLabels;
}

type Tree = Record<string, string>;

const allDone = (seed: LoadedSeed) =>
  Object.fromEntries(seed.seed.requirements.map((r) => [r.id, 'done' as const]));

function labels(seed: LoadedSeed, patch: Partial<ItemLabels>): ItemLabels {
  return {
    requirements: allDone(seed),
    requirementsAccept: {},
    units: [],
    facts: [],
    testIntegrity: [],
    claimMismatch: [],
    pr: 'problem',
    ...patch,
  };
}

/** Labels of the clean seed: every requirement done, every annotated unit in its role, PR clean. */
export function cleanLabels(seed: LoadedSeed): ItemLabels {
  const units: ItemLabels['units'] = [];
  const seen = new Set<string>();
  const add = (file: string, symbol: string | undefined, role: ItemLabels['units'][number]['role']) => {
    const key = `${file}|${symbol}`;
    if (!symbol || seen.has(key)) return;
    seen.add(key);
    units.push({ file, symbol, role });
  };
  for (const r of seed.seed.requirements)
    for (const u of [...r.implementing, ...r.tests]) add(u.file, u.symbol, 'implements');
  for (const u of seed.seed.incidental) add(u.file, u.symbol, u.role);
  return labels(seed, { units, pr: 'clean' });
}

function file(tree: Tree, path: string): string {
  const text = tree[path];
  if (text === undefined) throw new MutationError(`${path}: not in the head tree`);
  return text;
}

async function finish(before: Tree, after: Tree): Promise<Tree> {
  const changed = Object.keys(after).filter((p) => after[p] !== before[p]);
  if (!changed.length) throw new MutationError('the operator changed nothing');
  for (const p of changed) await assertParses(after[p] as string, p);
  return after;
}

function requirement(seed: LoadedSeed, id: string): SeedRequirement {
  const r = seed.seed.requirements.find((x) => x.id === id);
  if (!r) throw new MutationError(`${seed.seed.id}: no requirement ${id}`);
  return r;
}

/** Reverts one symbol to its base version, or removes it when the base does not have it. */
async function revertSymbol(seed: LoadedSeed, head: Tree, path: string, symbol: string): Promise<void> {
  const text = file(head, path);
  const span = await symbolSpan(text, path, symbol);
  if (!span) throw new MutationError(`${path}: symbol "${symbol}" not found`);
  const baseText = seed.base[path];
  const baseSpan = baseText === undefined ? null : await symbolSpan(baseText, path, symbol);
  if (baseText !== undefined && baseSpan) {
    head[path] = splice(text, span.start, span.end, baseText.slice(baseSpan.start, baseSpan.end));
    return;
  }
  // Remove the symbol and the blank lines after it, so the separator before it keeps the file's spacing. At the end
  // of the file, the blank lines before it go instead.
  let { start, end } = span;
  const after = /^(?:[ \t]*\n)*/.exec(text.slice(end))?.[0] ?? '';
  if (end + after.length < text.length) end += after.length;
  else {
    end = text.length;
    while (start >= 2 && text[start - 1] === '\n' && text[start - 2] === '\n') start -= 1;
  }
  head[path] = splice(text, start, end, '');
}

async function drop(seed: LoadedSeed, r: SeedRequirement): Promise<Tree> {
  const head = { ...seed.head };
  for (const ref of [...r.implementing, ...r.tests]) {
    if (ref.symbol && (ref.remove || ref.replace)) {
      for (const snippet of ref.remove ?? []) {
        const text = file(head, ref.file);
        const at = await findRemovable(text, ref.file, ref.symbol, snippet);
        head[ref.file] = splice(text, at.start, at.end, '');
      }
      for (const e of ref.replace ?? []) {
        const text = file(head, ref.file);
        const at = await findExact(text, ref.file, ref.symbol, e.from);
        head[ref.file] = splice(text, at.start, at.end, e.to);
      }
      continue;
    }
    if (!ref.symbol) {
      const base = seed.base[ref.file];
      if (base === undefined) delete head[ref.file];
      else head[ref.file] = base;
      continue;
    }
    await revertSymbol(seed, head, ref.file, ref.symbol);
  }
  // A file the requirement created that is now empty of code goes away with it.
  for (const p of Object.keys(head))
    if (seed.base[p] === undefined && seed.head[p] !== undefined && !head[p]?.trim()) delete head[p];
  return head;
}

export async function dropRequirement(seed: LoadedSeed, id: string): Promise<Mutation> {
  const r = requirement(seed, id);
  const head = await finish(seed.head, await drop(seed, r));
  return {
    operator: 'drop_requirement',
    target: id,
    head,
    labels: labels(seed, { requirements: { ...allDone(seed), [id]: 'missing' } }),
  };
}

export async function flipCondition(seed: LoadedSeed, id: string): Promise<Mutation> {
  const r = requirement(seed, id);
  if (!r.flip) throw new MutationError(`${seed.seed.id} ${id}: no flip annotation`);
  const head = { ...seed.head };
  for (const e of [r.flip.impl, r.flip.test]) {
    const text = file(head, e.file);
    const at = await findToken(text, e.file, e.symbol, e.from);
    head[e.file] = splice(text, at.start, at.end, e.to);
  }
  return {
    operator: 'flip_condition',
    target: id,
    head: await finish(seed.head, head),
    labels: labels(seed, { requirements: { ...allDone(seed), [id]: 'contradicted' } }),
  };
}

export async function partialRequirement(seed: LoadedSeed, id: string): Promise<Mutation> {
  const r = requirement(seed, id);
  if (!r.partial) throw new MutationError(`${seed.seed.id} ${id}: no partial annotation`);
  const head = { ...seed.head };
  for (const [e, statementsOnly] of [
    [r.partial.impl, false],
    [r.partial.test, true],
  ] as const) {
    const text = file(head, e.file);
    const at = await findRemovable(text, e.file, e.symbol, e.contains, statementsOnly);
    head[e.file] = splice(text, at.start, at.end, '');
  }
  return {
    operator: 'partial_requirement',
    target: id,
    head: await finish(seed.head, head),
    labels: labels(seed, { requirements: { ...allDone(seed), [id]: 'partial' } }),
  };
}

export async function weakenAssertionOp(seed: LoadedSeed): Promise<Mutation> {
  const { file: path, symbol } = seed.seed.unrelatedTest;
  const head = { ...seed.head, [path]: await weakenAssertion(file(seed.head, path), path, symbol) };
  return {
    operator: 'weaken_assertion',
    target: path,
    head: await finish(seed.head, head),
    labels: labels(seed, {
      facts: [{ kind: 'assertion_weakened', file: path, symbol }],
      testIntegrity: [{ file: path, symbol }],
    }),
  };
}

export async function skipTest(seed: LoadedSeed): Promise<Mutation> {
  const { file: path, symbol } = seed.seed.unrelatedTest;
  const head = { ...seed.head, [path]: await addSkipMarker(file(seed.head, path), path, symbol) };
  return {
    operator: 'skip_test',
    target: path,
    head: await finish(seed.head, head),
    labels: labels(seed, { facts: [{ kind: 'test_skipped', file: path }] }),
  };
}

export async function injectConfig(seed: LoadedSeed): Promise<Mutation> {
  const c = seed.seed.config;
  const text = file(seed.head, c.file);
  const at = await findToken(text, c.file, c.symbol, c.from);
  const head = { ...seed.head, [c.file]: splice(text, at.start, at.end, c.to) };
  return {
    operator: 'inject_config',
    target: c.file,
    head: await finish(seed.head, head),
    labels: labels(seed, { units: [{ file: c.file, symbol: c.symbol, role: 'unexplained_behavioral' }] }),
  };
}

export async function injectRefactor(seed: LoadedSeed): Promise<Mutation> {
  const u = seed.seed.unrelatedCode;
  const text = file(seed.head, u.file);
  const head = {
    ...seed.head,
    [u.file]: await renameIdentifier(text, u.file, u.symbol, u.rename.from, u.rename.to),
  };
  return {
    operator: 'inject_refactor',
    target: u.file,
    head: await finish(seed.head, head),
    labels: labels(seed, {
      units: [
        { file: u.file, symbol: u.symbol, role: 'unexplained_benign', accept: ['ignored', 'supporting'] },
      ],
      pr: 'clean',
    }),
  };
}

export async function unwire(seed: LoadedSeed, id: string): Promise<Mutation> {
  const r = requirement(seed, id);
  if (!r.unwire) throw new MutationError(`${seed.seed.id} ${id}: no unwire annotation`);
  const w = r.unwire;
  const head = {
    ...seed.head,
    [w.file]: await replaceCallWithArgument(file(seed.head, w.file), w.file, w.symbol, w.callee),
  };
  const def = r.implementing.find((u) => u.symbol === w.callee);
  return {
    operator: 'unwire',
    target: id,
    head: await finish(seed.head, head),
    labels: labels(seed, {
      requirements: { ...allDone(seed), [id]: 'partial' },
      requirementsAccept: { [id]: ['missing'] },
      facts: [{ kind: 'new_symbol_unreferenced', ...(def ? { file: def.file } : {}) }],
    }),
  };
}

/** drop_requirement plus a PR body that claims every requirement is done. */
export async function claimAllDone(seed: LoadedSeed, id: string): Promise<Mutation> {
  const dropped = await dropRequirement(seed, id);
  const lines = seed.seed.requirements.map((r) => `- ${r.text}: done.`);
  const prBody = `All requirements from the issue are implemented and tested:\n\n${lines.join('\n')}\n`;
  return {
    ...dropped,
    operator: 'claim_all_done',
    prBody,
    labels: { ...dropped.labels, claimMismatch: [id] },
  };
}

/** Every applicable mutation of a seed, in a stable order. Operators without an annotation are skipped. */
export async function allMutations(seed: LoadedSeed): Promise<Mutation[]> {
  const out: Mutation[] = [];
  const reqs = seed.seed.requirements;
  for (const r of reqs) out.push(await dropRequirement(seed, r.id));
  for (const r of reqs) if (r.flip) out.push(await flipCondition(seed, r.id));
  for (const r of reqs) if (r.partial) out.push(await partialRequirement(seed, r.id));
  out.push(await weakenAssertionOp(seed), await skipTest(seed), await injectConfig(seed));
  out.push(await injectRefactor(seed));
  for (const r of reqs) if (r.unwire) out.push(await unwire(seed, r.id));
  const first = reqs[0];
  if (first) out.push(await claimAllDone(seed, first.id));
  return out;
}
