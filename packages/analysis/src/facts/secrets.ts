/**
 * `secret_like` (BUILD_PROMPT 6.4.2): known key prefixes or high-entropy tokens on added lines.
 * Details never include the value.
 */
import type { Detector } from './detectors.js';

export const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9]{32,}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}/ },
  { name: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe live key', re: /\b[rs]k_live_[A-Za-z0-9]{20,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'JSON web token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    name: 'private key',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/,
  },
];

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const CANDIDATE = /["'`]([A-Za-z0-9+/=_-]{32,})["'`]/g;
// GitHub GraphQL node ids ("node_id": "MDEwOl...") are opaque identifiers, not credentials (dogfood M7).
const HASH_CONTEXT =
  /\b(sha\d*|hash|integrity|checksum|digest|nonce|uuid|commit|etag|fixture|example|node_id)\b/i;

/** Returns the kind of secret on a line, or null. */
export function secretKind(content: string): string | null {
  for (const p of SECRET_PATTERNS) if (p.re.test(content)) return p.name;
  if (HASH_CONTEXT.test(content)) return null;
  for (const m of content.matchAll(CANDIDATE)) {
    const token = m[1] as string;
    if (/^[0-9a-f]+$/i.test(token)) continue; // plain hex digests
    if (!/[0-9]/.test(token) || !/[A-Za-z]/.test(token)) continue;
    if (entropy(token) >= 4.2) return 'high-entropy token';
  }
  return null;
}

export const secretLike: Detector = {
  kind: 'secret_like',
  languages: 'all',
  detect({ raw }) {
    const removed = new Set(raw.dels.map((l) => l.content.trim()));
    return raw.adds.flatMap((l) => {
      if (removed.has(l.content.trim())) return [];
      const kind = secretKind(l.content);
      return kind
        ? [
            {
              kind: 'secret_like' as const,
              severity: 'high' as const,
              line: l.line,
              detail: `possible ${kind} added (value redacted)`,
            },
          ]
        : [];
    });
  },
};
