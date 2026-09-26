/** `issue.v0` (BUILD_PROMPT Appendix C.1): ambiguity and checkability of one requirement. */
import type { IssueSnapshot, Requirement } from '../contracts/index.js';
import { normalizeForMatch } from '../extract/validate.js';
import { cleanText } from '../text/sanitize.js';
import { noul } from './types.js';

export const ISSUE_CALL = 'issue.v0';

export function issueQuestions() {
  return {
    ambiguous: noul(
      'Could two competent engineers read `requirement.text` in the context of `issue_excerpt` and build versions that behave differently for the same input?',
      {
        true: 'The wording leaves open a choice that changes behavior, such as an unstated value, condition, order, limit or scope.',
        false: 'The wording pins down the behavior well enough that correct implementations behave the same.',
      },
    ),
    checkable_in_code: noul(
      'Can someone decide whether `requirement.text` is implemented by reading code changes alone, without running the software, viewing a user interface or measuring performance?',
      {
        true: 'Reading the code is enough to decide.',
        false: 'Deciding needs running, viewing or measuring.',
      },
    ),
  };
}

function sourceText(issue: IssueSnapshot, req: Requirement): string {
  if (req.source.kind === 'title') return issue.title;
  if (req.source.kind === 'comment')
    return issue.comments.find((c) => c.id === req.source.commentId)?.body ?? issue.body;
  return issue.body;
}

/** Up to `max` characters of the requirement's source, centered on the quote. */
export function issueExcerpt(issue: IssueSnapshot, req: Requirement, max = 1500): string {
  const text = cleanText(sourceText(issue, req), 200_000).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const at = normalizeForMatch(text).indexOf(normalizeForMatch(req.quote));
  const center = at === -1 ? 0 : at + Math.floor(req.quote.length / 2);
  const start = Math.max(0, Math.min(text.length - max, center - Math.floor(max / 2)));
  return text.slice(start, start + max);
}

export function issueState(issue: IssueSnapshot, req: Requirement) {
  return {
    requirement: { text: cleanText(req.text, 2000), quote: cleanText(req.quote, 2000) },
    issue_excerpt: issueExcerpt(issue, req),
  };
}
