// guard:protected (BUILD_PROMPT 3.6): human-owned kit files must match .agent/protected.sha256.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROTECTED = ['BUILD_PROMPT.md', 'GOAL.txt', 'loop.sh', 'START_HERE.md'];
export const OPTIONAL = new Set(['START_HERE.md']);

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Parses "<hash>  <file>" lines into a Map of file to hash. */
export function parseManifest(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

/** Returns a list of problems (empty when every protected file matches). */
export function checkProtected(root) {
  const manifestPath = join(root, '.agent', 'protected.sha256');
  if (!existsSync(manifestPath)) return ['.agent/protected.sha256 is missing'];
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const problems = [];
  for (const file of PROTECTED) {
    const path = join(root, file);
    const expected = manifest.get(file);
    if (!existsSync(path)) {
      if (!OPTIONAL.has(file)) problems.push(`${file} is missing`);
      else if (expected) problems.push(`${file} is listed in the manifest but missing`);
      continue;
    }
    if (!expected) {
      problems.push(`${file} exists but has no hash in .agent/protected.sha256`);
      continue;
    }
    const actual = sha256(readFileSync(path));
    if (actual !== expected)
      problems.push(`${file} was modified (sha256 ${actual.slice(0, 12)} != ${expected.slice(0, 12)})`);
  }
  return problems;
}
