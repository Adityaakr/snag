#!/usr/bin/env node
// Checks one PROGRESS.md item with evidence:
//   node scripts/check-item.mjs M1 "zod contracts" "contracts.test.ts" [sha]
// The sha defaults to HEAD. Matches the first unchecked item in the milestone that starts with the prefix.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [milestone, prefix, evidence, shaArg] = process.argv.slice(2);
if (!milestone || !prefix || !evidence) {
  console.error('usage: check-item.mjs <M#> <item prefix> <evidence> [sha]');
  process.exit(2);
}
const sha = shaArg ?? execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const path = '.agent/PROGRESS.md';
const lines = readFileSync(path, 'utf8').split('\n');
let inMilestone = false;
let done = false;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.startsWith('## ')) inMilestone = new RegExp(`^## ${milestone}\\b`).test(line);
  if (inMilestone && !done && line.startsWith(`- [ ] ${prefix}`)) {
    lines[i] = `${line.replace('- [ ] ', '- [x] ')} (evidence: ${evidence}, ${sha})`;
    done = true;
  }
}
if (!done) {
  console.error(`no unchecked item in ${milestone} starts with "${prefix}"`);
  process.exit(1);
}
writeFileSync(path, lines.join('\n'));
console.log(`checked ${milestone}: ${prefix}`);
