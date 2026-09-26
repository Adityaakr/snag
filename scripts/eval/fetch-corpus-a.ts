/**
 * `pnpm eval:fetch-a`: downloads corpus A's raw files (public data, no keys) into eval/corpora/swebench/raw/,
 * records hashes in eval/corpora/swebench/SOURCES.json, and rebuilds the dev and test items.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORPORA_ROOT, fetchCorpusA, HF_ROWS, writeCorpusA, ZENODO_ZIP } from '@remit/eval';
import { LiveHttp } from '@remit/providers';

const root = join(CORPORA_ROOT, 'swebench');
const rawDir = join(root, 'raw');
const skipFetch = process.argv.includes('--build-only');
const hashes = skipFetch
  ? null
  : await fetchCorpusA(new LiveHttp(), rawDir, (line) => process.stdout.write(`${line}\n`));
if (hashes) {
  const sources = {
    fetchedAt: new Date().toISOString().slice(0, 10),
    swebench_verified: { url: HF_ROWS, license: 'unspecified (upstream project licenses; harness MIT)' },
    patchdiff: {
      url: ZENODO_ZIP,
      doi: '10.5281/zenodo.18258368',
      license: 'CC-BY-4.0',
      citation:
        "You Wang, Michael Pradel, Zhongxin Liu. Are 'Solved Issues' in SWE-bench Really Solved Correctly? ICSE 2026.",
    },
    sha256: hashes,
  };
  writeFileSync(join(root, 'SOURCES.json'), `${JSON.stringify(sources, null, 2)}\n`);
}
const out = writeCorpusA(rawDir, CORPORA_ROOT);
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
