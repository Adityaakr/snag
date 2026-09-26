#!/usr/bin/env node
// `pnpm eval:freeze [--append]`: writes eval/corpora/test.sha256 (BUILD_PROMPT 11.2). Run once at the M6 freeze.
import { freeze } from './guards/split.mjs';

try {
  const added = freeze(process.cwd(), { append: process.argv.includes('--append') });
  console.log(`froze ${added} test-split files`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
