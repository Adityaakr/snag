// Builds Laya fine-tuning data from the mutation corpus DEV split (DECISIONS D35). Runs Remit's real pipeline on
// every dev item with OracleJev, which answers from labels and records (state, question, target) examples.
// Refuses any seed whose split is not dev. Output: .laya/data/records.jsonl plus a summary on stdout.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCorpus, loadSeed, OracleJev, runItem } from '@remit/eval';

const ROOT = process.cwd();
const items = await loadCorpus('mutations', 'dev');
const seeds = new Map<string, ReturnType<typeof loadSeed>>();
const out: string[] = [];
let passed = 0;
const byCall: Record<string, number> = {};
for (const item of items) {
  if (!item.seedId) continue;
  let loaded = seeds.get(item.seedId);
  if (!loaded) {
    loaded = loadSeed(join(ROOT, 'eval', 'corpora', 'mutations', 'seeds', item.seedId));
    seeds.set(item.seedId, loaded);
  }
  if (loaded.seed.split !== 'dev')
    throw new Error(`dev item ${item.id} comes from non-dev seed ${item.seedId}`);
  const oracle = new OracleJev(item, loaded.seed);
  const outcome = await runItem(item, { mode: 'live', jev: oracle });
  if (outcome.comparison.passed) passed++;
  for (const r of oracle.records) {
    out.push(JSON.stringify(r));
    const k = `${r.call}.${r.qid}`;
    byCall[k] = (byCall[k] ?? 0) + 1;
  }
}
mkdirSync(join(ROOT, '.laya', 'data'), { recursive: true });
writeFileSync(join(ROOT, '.laya', 'data', 'records.jsonl'), `${out.join('\n')}\n`);
console.log(`items ${items.length}, oracle-driven reviews matching labels ${passed}/${items.length}`);
console.log(`records ${out.length}`);
for (const [k, n] of Object.entries(byCall).sort()) console.log(`  ${k.padEnd(28)} ${n}`);
