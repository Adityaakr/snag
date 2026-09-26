#!/usr/bin/env node
// Runs every guard (BUILD_PROMPT 3.6). Guards added in later milestones register here.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkProtected } from './guards/protected.mjs';
import { checkSecrets } from './guards/secrets.mjs';

const root = process.cwd();
const guards = [
  ['guard:protected', () => checkProtected(root)],
  [
    'guard:secrets',
    () => checkSecrets(root).map((f) => `${f.file}:${f.line} looks like a ${f.kind} (value not shown)`),
  ],
];

const extra = join(root, 'scripts', 'guards', 'extra.mjs');
if (existsSync(extra)) {
  const mod = await import(extra);
  guards.push(...mod.guards(root));
}

let failed = false;
for (const [name, run] of guards) {
  const problems = await run();
  if (problems.length === 0) {
    console.log(`${name}: ok`);
  } else {
    failed = true;
    console.log(`${name}: FAIL`);
    for (const p of problems) console.log(`  - ${p}`);
  }
}
process.exitCode = failed ? 1 : 0;
