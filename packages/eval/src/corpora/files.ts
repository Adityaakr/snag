/** Stored corpora (BUILD_PROMPT 11.2): eval/corpora/<corpus>/<split>/<item>.json, one EvalItem per file. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigSchema } from '@remit/core';
import type { EvalItem } from '../item.js';

export const EVAL_ROOT = join(import.meta.dirname, '..', '..', '..', '..', 'eval');
export const CORPORA_ROOT = join(EVAL_ROOT, 'corpora');

export const itemFileName = (id: string) => `${id.replace(/[^\w.-]+/g, '__')}.json`;

export function saveItem(item: EvalItem, split: 'dev' | 'test', root = CORPORA_ROOT): string {
  const dir = join(root, item.corpus, split);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, itemFileName(item.id));
  writeFileSync(path, `${JSON.stringify(item, null, 1)}\n`);
  return path;
}

export function loadItemFile(path: string): EvalItem {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as EvalItem;
  return { ...raw, config: ConfigSchema.parse(raw.config ?? {}) };
}

/** Loads every item of one corpus split, sorted by id. */
export function loadCorpus(corpus: string, split: string, root = CORPORA_ROOT): EvalItem[] {
  const dir = join(root, corpus, split);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => loadItemFile(join(dir, f)));
}
