/**
 * Claims check input (BUILD_PROMPT 6.8): split the PR title and body into sentences and bullet items, dropping
 * code blocks, template boilerplate and fragments under 20 characters, capped at 40. Runs only after the blind
 * pass; the PR description never changes evidence or coverage.
 */
import { cleanText } from './text/sanitize.js';

export const MAX_CLAIM_SENTENCES = 40;
export const MIN_CLAIM_CHARS = 20;

const BOILERPLATE = [
  /^#+\s/, // headings
  /^\s*[-*]\s*\[[ xX]\]\s*(i have|i've|tests? (pass|added)|docs? updated|self-review|checklist)/i,
  /^(description|summary|changes|motivation|testing|screenshots?|checklist|related issues?|type of change)\s*:?\s*$/i,
  /^(fixes|closes|resolves|refs?)\s+#\d+\.?$/i,
  /^_?(please|delete|describe|provide|remove)\b.*(template|this section|below|above)/i,
];

/** Sentences and bullet items worth asking `claims.v0` about. */
export function claimSentences(title: string, body: string): string[] {
  const text = cleanText(body, 50_000)
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/~~~[\s\S]*?~~~/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/`[^`\n]*`/g, (m) => m.slice(1, -1));
  const pieces: string[] = [];
  const t = cleanText(title, 500).trim();
  if (t) pieces.push(t);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || BOILERPLATE.some((re) => re.test(line))) continue;
    const bullet = /^([-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    const content = bullet ? (bullet[2] as string) : line;
    for (const s of content.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)) pieces.push(s.trim());
  }
  const seen = new Set<string>();
  return pieces
    .filter((p) => p.length >= MIN_CLAIM_CHARS && !seen.has(p) && seen.add(p))
    .slice(0, MAX_CLAIM_SENTENCES);
}
