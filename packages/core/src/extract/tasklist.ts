/**
 * Task-list fast path (BUILD_PROMPT 6.2): each GitHub task-list item in the issue body becomes a requirement
 * quoting its line. Items inside fenced code are ignored.
 */
import type { IssueSnapshot } from '../contracts/index.js';
import type { ExtractedRequirement } from './schema.js';
import { normalizeForMatch } from './validate.js';

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s+(.+?)\s*$/;

/** Task-list items of the body as provisional requirements (ids T1..Tn). */
export function taskListRequirements(issue: IssueSnapshot): ExtractedRequirement[] {
  const out: ExtractedRequirement[] = [];
  let fenced = false;
  for (const line of issue.body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = ITEM.exec(line);
    if (!m) continue;
    const text = (m[2] as string).trim();
    out.push({
      id: `T${out.length + 1}`,
      text,
      quote: text,
      source: { kind: 'tasklist' },
      kind: 'behavior',
      explicitness: 'explicit',
      priority: 'must',
      examples: [],
      checkableInCode: true,
    });
  }
  return out;
}

/** True when an LLM requirement quotes text inside one of the task-list items (the fast path already covers it). */
export function coveredByTaskList(quote: string, items: readonly ExtractedRequirement[]): boolean {
  const q = normalizeForMatch(quote).toLowerCase();
  return items.some((t) => {
    const item = normalizeForMatch(t.quote).toLowerCase();
    // The LLM quote sits inside the item, or spans the whole item; very short items only match the first way.
    return item.includes(q) || (item.length >= 12 && q.includes(item));
  });
}
