#!/usr/bin/env node
// pnpm verify: format check, lint, typecheck, unit and golden tests with coverage, all guards.
import { spawnSync } from 'node:child_process';

const steps = [
  ['format', 'pnpm', ['-s', 'format:check']],
  ['lint', 'pnpm', ['-s', 'lint']],
  ['typecheck', 'pnpm', ['-s', 'typecheck']],
  ['test', 'pnpm', ['-s', 'test:cov']],
  ['guard', 'pnpm', ['-s', 'guard']],
];

const started = Date.now();
for (const [name, cmd, args] of steps) {
  const t = Date.now();
  process.stdout.write(`\n== verify: ${name}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  if (r.status !== 0) {
    console.log(`\nverify FAILED at ${name} (${secs} s)`);
    process.exit(r.status ?? 1);
  }
  console.log(`== ${name} ok (${secs} s)`);
}
const total = (Date.now() - started) / 1000;
console.log(`\nverify passed in ${total.toFixed(1)} s`);
if (total > 180) {
  console.log('verify took longer than 3 minutes; move slow suites to test:slow (BUILD_PROMPT 3.4 rule 8)');
  process.exit(1);
}
