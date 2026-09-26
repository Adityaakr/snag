/**
 * Downloads corpus A's raw files through the providers HTTP client (rule 7): SWE-bench Verified rows from the
 * Hugging Face datasets server, and the PatchDiff tool results and study labels from single entries of the Zenodo
 * archive (CC-BY-4.0) read with range requests. The RQ2 files (about 100 MB each) are reduced to the differentiating
 * test ids. Raw files are gitignored; SOURCES.json records URLs and sha256 hashes.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type HttpProvider, listZip, readZipEntry } from '@remit/providers';
import { itemFileName, saveItem } from './files.js';
import { splitOf } from '../mutations/generate.js';
import { corpusAItems, readCorpusARaw, TOOL_NAMES, TOOLS } from './swebench.js';

export const ZENODO_ZIP = 'https://zenodo.org/api/records/18258368/files/PatchDiff_0115_1.zip/content';
export const HF_ROWS =
  'https://datasets-server.huggingface.co/rows?dataset=princeton-nlp%2FSWE-bench_Verified&config=default&split=test';
const KEEP = ['instance_id', 'repo', 'base_commit', 'patch', 'problem_statement'] as const;

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

export type FetchLog = (line: string) => void;

function write(path: string, body: Buffer | string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return sha256(body);
}

/** Pages through the datasets-server rows API (100 rows per page). */
export async function fetchSwebenchRows(http: HttpProvider, log: FetchLog = () => {}): Promise<string> {
  const lines: string[] = [];
  let total = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < total; offset += 100) {
    const res = await http.get(`${HF_ROWS}&offset=${offset}&length=100`);
    const page = JSON.parse(res.body.toString('utf8')) as {
      rows: { row: Record<string, unknown> }[];
      num_rows_total: number;
    };
    total = page.num_rows_total;
    for (const { row } of page.rows)
      lines.push(JSON.stringify(Object.fromEntries(KEEP.map((k) => [k, row[k]]))));
    log(`swebench rows ${lines.length}/${total}`);
    if (!page.rows.length) break;
  }
  return `${lines.join('\n')}\n`;
}

/** Keys of an RQ2 difftests file with the union of their differentiating test ids. */
export function deriveRq2(text: string): Record<string, string[]> {
  const raw = JSON.parse(text) as Record<string, { differential_tests?: string[] }[]>;
  return Object.fromEntries(
    Object.entries(raw).map(([id, attempts]) => [
      id,
      [...new Set(attempts.flatMap((a) => a.differential_tests ?? []))].sort(),
    ]),
  );
}

export async function fetchCorpusA(
  http: HttpProvider,
  rawDir: string,
  log: FetchLog = () => {},
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  hashes['swebench_verified.jsonl'] = write(
    join(rawDir, 'swebench_verified.jsonl'),
    await fetchSwebenchRows(http, log),
  );
  const entries = await listZip(http, ZENODO_ZIP);
  const byName = new Map(entries.map((e) => [e.name.replace(/^[^/]+\//, ''), e]));
  const want: [string, string][] = [['results/RQ34.csv', 'patchdiff/results/RQ34.csv']];
  for (const tool of TOOL_NAMES) {
    for (const f of ['all_preds.jsonl', 'results.json'])
      want.push([`data/tool_results/${TOOLS[tool]}/${f}`, `patchdiff/tool_results/${TOOLS[tool]}/${f}`]);
    want.push([`results/RQ1_${tool}_runall.json`, `patchdiff/results/RQ1_${tool}_runall.json`]);
  }
  for (const [name, out] of want) {
    const entry = byName.get(name);
    if (!entry) throw new Error(`PatchDiff archive has no ${name}`);
    hashes[out] = write(join(rawDir, out), await readZipEntry(http, ZENODO_ZIP, entry));
    log(`fetched ${name}`);
  }
  for (const tool of TOOL_NAMES) {
    const name = `results/RQ2_${tool}_difftests.json`;
    const entry = byName.get(name);
    if (!entry) throw new Error(`PatchDiff archive has no ${name}`);
    const body = await readZipEntry(http, ZENODO_ZIP, entry);
    hashes[`zip:${name}`] = sha256(body);
    const out = `patchdiff/derived/RQ2_${tool}_divergent.json`;
    hashes[out] = write(join(rawDir, out), `${JSON.stringify(deriveRq2(body.toString('utf8')), null, 1)}\n`);
    log(`derived ${out}`);
  }
  return hashes;
}

/** Writes corpus A items to dev and test, split by a stable hash of the SWE-bench instance id (D25). */
export function writeCorpusA(rawDir: string, corporaRoot: string) {
  const { items, counts } = corpusAItems(readCorpusARaw(rawDir));
  for (const split of ['dev', 'test'])
    rmSync(join(corporaRoot, 'swebench', split), { recursive: true, force: true });
  const perSplit = { dev: 0, test: 0 };
  for (const item of items) {
    const split = splitOf(item.seedId as string);
    saveItem(item, split, corporaRoot);
    perSplit[split]++;
  }
  return { counts, perSplit, example: items[0] ? itemFileName(items[0].id) : null };
}
