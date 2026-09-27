// Slices a mutation eval report by seed, so remit-laya is judged only on seeds it never trained on (DECISIONS D35).
// Usage: node scripts/laya/slice-report.mjs <report dir> [seed,seed,...]
// Prints, per operator: items, fully correct, target requirement detected, and PR-level problem recall and false alarms.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, seedArg] = process.argv.slice(2);
if (!dir) throw new Error('usage: slice-report.mjs <report dir> [seeds]');
const seeds = seedArg ? new Set(seedArg.split(',')) : null;
const items = readdirSync(join(dir, 'items'))
  .map((f) => JSON.parse(readFileSync(join(dir, 'items', f), 'utf8')))
  .filter((d) => !seeds || seeds.has(d.id.split('/').pop().split('.')[0]));

const WANT = {
  drop_requirement: ['missing'],
  claim_all_done: ['missing'],
  flip_condition: ['contradicted'],
  partial_requirement: ['partial', 'missing'],
  unwire: ['partial', 'missing'],
};
const rows = {};
let passed = 0;
let prTp = 0;
let prFn = 0;
let prFp = 0;
let clean = 0;
for (const d of items) {
  const op = d.id.split('/').pop().split('.')[1] ?? 'clean';
  const r = (rows[op] ??= { n: 0, passed: 0, detected: 0, targeted: 0 });
  r.n++;
  if (d.comparison.passed) {
    r.passed++;
    passed++;
  }
  const target = d.id.split('/').pop().split('.')[2];
  if (WANT[op] && target) {
    r.targeted++;
    const actual = d.result.requirementVerdicts.find((v) => v.requirementId === target)?.status;
    if (WANT[op].includes(actual)) r.detected++;
  }
  const problem = d.comparison.pr.predictedProblem;
  if (d.comparison.pr.expected === 'problem') problem ? prTp++ : prFn++;
  else {
    clean++;
    if (problem) prFp++;
  }
}
console.log(
  `items ${items.length}${seeds ? ` (seeds ${[...seeds].join(', ')})` : ''}, fully correct ${passed}`,
);
console.log(
  `PR level: recall ${(prTp / Math.max(1, prTp + prFn)).toFixed(2)} (${prTp}/${prTp + prFn}), false alarms ${prFp}/${clean} clean`,
);
for (const [op, r] of Object.entries(rows).sort())
  console.log(
    `  ${op.padEnd(20)} n=${String(r.n).padStart(3)} correct ${r.passed}${r.targeted ? `  target detected ${r.detected}/${r.targeted}` : ''}`,
  );
