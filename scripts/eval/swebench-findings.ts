// Scores system A's surfaced findings on SWE-bench Verified gold patches against finding-level adjudication
// (eval/labels/swebench-gold-findings-*.json, rubric docs/status-rubric.md).
//
// Usage: pnpm exec tsx --conditions=source scripts/eval/swebench-findings.ts <A predictions .jsonl> <labels .json> [--e4]
//   --e4 applies the evidence-consistency rule (reconcileSinglePass) to the outputs before surfacing.
// A finding without an adjudicated verdict is UNADJUDICATED: reported, never counted as right or wrong.
import { readFileSync } from 'node:fs';
import { reconcileSinglePass, type SinglePassOutput, wilson } from '@remit/eval';

const [predFile, labelFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!predFile || !labelFile)
  throw new Error('usage: swebench-findings.ts <predictions.jsonl> <labels.json> [--e4]');
const e4 = process.argv.includes('--e4');
const labels = JSON.parse(readFileSync(labelFile, 'utf8')) as {
  findings: {
    item: string;
    requirement?: string;
    text?: string;
    file?: string;
    line?: number;
    verdict: string;
  }[];
  prs: Record<string, string>;
};
const PROBLEM = new Set(['missing', 'partial', 'contradicted']);
const norm = (r: string | undefined) => (r ?? '').replace(/^R/i, '');
const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);
/** Jaccard overlap of content words: requirement ids are renumbered between prompts, texts are not. */
function overlap(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return x.size + y.size - n ? n / (x.size + y.size - n) : 0;
}

const counts: Record<string, number> = {
  valid: 0,
  'type-mismatched': 0,
  false: 0,
  undecidable: 0,
  unadjudicated: 0,
};
let flagged = 0;
let items = 0;
let cleanPRs = 0;
let cleanFlagged = 0;
const detail: string[] = [];
for (const line of readFileSync(predFile, 'utf8').split('\n').filter(Boolean)) {
  const d = JSON.parse(line) as { id: string; output: SinglePassOutput | null; error?: string | null };
  items++;
  if (!d.output) {
    detail.push(`${d.id}: failed review`);
    continue;
  }
  const out = e4 ? reconcileSinglePass(d.output) : d.output;
  const surfaced = [
    ...out.requirements
      .filter((r) => PROBLEM.has(r.status) && r.confidence >= 0.5)
      .map((r) => ({
        kind: 'requirement' as const,
        requirement: norm(r.id),
        text: r.text,
        label: `R${norm(r.id)} ${r.status}: ${r.text.slice(0, 60)}`,
      })),
    ...out.unexplained
      .filter((u) => u.behavioral)
      .map((u) => ({
        kind: 'unit' as const,
        file: u.file,
        start: u.lines.start,
        end: u.lines.end,
        label: `unexplained ${u.file}:${u.lines.start}`,
      })),
  ];
  if (surfaced.length) flagged++;
  const pr = labels.prs[d.id];
  if (pr === 'clean') {
    cleanPRs++;
    if (surfaced.length) cleanFlagged++;
  }
  for (const f of surfaced) {
    const v = labels.findings.find(
      (x) =>
        x.item === d.id &&
        (f.kind === 'requirement'
          ? x.text !== undefined && overlap(x.text, f.text) >= 0.5
          : x.file === f.file && x.line !== undefined && x.line >= f.start && x.line <= f.end),
    );
    const verdict = v?.verdict ?? 'unadjudicated';
    counts[verdict] = (counts[verdict] ?? 0) + 1;
    detail.push(`${d.id}: ${f.label} -> ${verdict}`);
  }
}
const decided = (counts.valid ?? 0) + (counts['type-mismatched'] ?? 0) + (counts.false ?? 0);
const [lo, hi] = wilson(counts.valid ?? 0, decided);
console.log(
  `Items ${items}${e4 ? ' (E4 applied)' : ''}. Flagged (unadjudicated flag rate): ${flagged}/${items}.`,
);
console.log(
  `Surfaced findings: valid ${counts.valid}, type-mismatched ${counts['type-mismatched']}, false ${counts.false}, undecidable ${counts.undecidable}, unadjudicated ${counts.unadjudicated}.`,
);
console.log(
  `Finding precision among adjudicated, decidable findings: ${counts.valid}/${decided}` +
    (decided
      ? ` = ${((100 * (counts.valid ?? 0)) / decided).toFixed(1)}% [${(100 * lo).toFixed(0)}, ${(100 * hi).toFixed(0)}]`
      : ''),
);
console.log(`Adjudicated clean PRs with any finding: ${cleanFlagged}/${cleanPRs}.`);
if (process.argv.includes('--detail')) for (const x of detail) console.log(`  ${x}`);
