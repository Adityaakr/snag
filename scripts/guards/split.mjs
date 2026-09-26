// guard:split (BUILD_PROMPT 11.2): after the M6 freeze, eval test-split files must match eval/corpora/test.sha256.
// A frozen file that changes or disappears fails; a new test file fails until it is appended with
// `pnpm eval:freeze --append` (M8 shadow items), which never rewrites an existing entry.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseManifest, sha256 } from './protected.mjs';

export const MANIFEST = 'eval/corpora/test.sha256';
export const FREEZE_TAG = 'm6-done';

/** The manifest as committed at the freeze tag, or null before the tag exists. */
export function taggedManifest(root, tag = FREEZE_TAG) {
  try {
    const text = execFileSync('git', ['show', `${tag}:${MANIFEST}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseManifest(text);
  } catch {
    // No tag (or no manifest at the tag) yet: the freeze is still being set up.
    return null;
  }
}

/** Every file under eval/corpora/<corpus>/test/, as repo-relative paths. */
export function testFiles(root) {
  const corpora = join(root, 'eval', 'corpora');
  if (!existsSync(corpora)) return [];
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(root, p).split('\\').join('/'));
    }
  };
  for (const corpus of readdirSync(corpora).sort()) {
    const dir = join(corpora, corpus, 'test');
    if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir);
  }
  return out;
}

export function checkSplit(root, tag = FREEZE_TAG) {
  const files = testFiles(root);
  const manifestPath = join(root, MANIFEST);
  // After the freeze tag the manifest is append-only: deleting it, re-freezing or editing a hash cannot hide a change.
  const frozen = taggedManifest(root, tag);
  const tagged = [];
  if (frozen) {
    const current = existsSync(manifestPath) ? parseManifest(readFileSync(manifestPath, 'utf8')) : new Map();
    for (const [file, hash] of frozen)
      if (current.get(file) !== hash) tagged.push(`${file}: ${MANIFEST} differs from the ${tag} freeze`);
  }
  return [...tagged, ...checkManifest(root, files, manifestPath)];
}

function checkManifest(root, files, manifestPath) {
  if (!existsSync(manifestPath))
    return files.length
      ? [`${MANIFEST} is missing but ${files.length} test-split files exist; run pnpm eval:freeze`]
      : [];
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const problems = [];
  for (const [file, hash] of manifest) {
    const p = join(root, file);
    if (!existsSync(p)) problems.push(`${file} is frozen but missing`);
    else if (sha256(readFileSync(p)) !== hash) problems.push(`${file} changed after the freeze`);
  }
  for (const file of files) if (!manifest.has(file)) problems.push(`${file} is not in ${MANIFEST}`);
  return problems;
}

/** Writes the manifest. Refuses to rewrite an existing one; `append` only adds files that are not listed yet. */
export function freeze(root, { append = false } = {}) {
  const manifestPath = join(root, MANIFEST);
  const exists = existsSync(manifestPath);
  if (exists && !append)
    throw new Error(`${MANIFEST} already exists; the test split is frozen (use --append for new files)`);
  const manifest = exists ? parseManifest(readFileSync(manifestPath, 'utf8')) : new Map();
  let added = 0;
  for (const file of testFiles(root)) {
    if (manifest.has(file)) continue;
    manifest.set(file, sha256(readFileSync(join(root, file))));
    added++;
  }
  const lines = [...manifest.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([f, h]) => `${h}  ${f}`);
  writeFileSync(manifestPath, `${lines.join('\n')}\n`);
  return added;
}
