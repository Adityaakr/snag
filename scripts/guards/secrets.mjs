// guard:secrets (BUILD_PROMPT 3.6): scan tracked files for credential patterns.
// Test code that needs a fake secret must build it at runtime (for example 'sk-' + 'ant-...').
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9]{32,}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}/ },
  { name: 'Private key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
  {
    name: 'Assigned API key',
    re: /\b(?:TYPESAFE|ANTHROPIC|OPENAI(?:_COMPATIBLE)?)_API_KEY\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/,
  },
  {
    name: 'Assigned GitHub secret',
    re: /\bGITHUB_(?:TOKEN|WEBHOOK_SECRET|OAUTH_CLIENT_SECRET)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/,
  },
];

const MAX_BYTES = 2_000_000;

/** Returns findings for one file's text (line numbers are 1-based). Never includes the secret. */
export function scanText(file, text) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const p of PATTERNS) if (p.re.test(line)) findings.push({ file, line: i + 1, kind: p.name });
  });
  return findings;
}

export function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  return out.split('\0').filter(Boolean);
}

/** Scans every tracked file under root. */
export function checkSecrets(root, files = trackedFiles(root)) {
  const findings = [];
  for (const file of files) {
    const path = join(root, file);
    let size;
    try {
      size = statSync(path).size;
    } catch {
      continue; // deleted in the working tree
    }
    if (size > MAX_BYTES) continue;
    const buf = readFileSync(path);
    if (buf.includes(0)) continue; // binary
    findings.push(...scanText(file, buf.toString('utf8')));
  }
  return findings;
}
