/**
 * Validation in code for extracted requirements (BUILD_PROMPT 6.2): quotes must be exact substrings of the
 * source they name after whitespace and quote-character normalization; unanchored items are reported for one
 * repair call and then dropped with a warning; IDs are renumbered R1..Rn by quote position (title, body,
 * comments), prefixed I<k>. when several issues are linked.
 */
import type { IssueSnapshot, Requirement } from '../contracts/index.js';
import { stripInvisible } from '../text/sanitize.js';
import type { ExtractedRequirement, ExtractionOutput, OpenQuestion } from './schema.js';

/** Collapses whitespace, unifies quote characters and dashes, and drops invisible characters. */
export function normalizeForMatch(text: string): string {
  return stripInvisible(text)
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Where a quote was found: source order (title 0, body 1, comments 2..) and offset inside that source. */
export interface Anchor {
  order: number;
  offset: number;
  source: Requirement['source'];
}

function sources(issue: IssueSnapshot): { order: number; text: string; source: Requirement['source'] }[] {
  return [
    { order: 0, text: issue.title, source: { kind: 'title' } },
    { order: 1, text: issue.body, source: { kind: 'body' } },
    ...issue.comments.map((c, i) => ({
      order: 2 + i,
      text: c.body,
      source: { kind: 'comment' as const, commentId: c.id },
    })),
  ];
}

/**
 * Finds the quote in the source it names. A `tasklist` source is looked up in the body. When the named source
 * does not contain it, other sources are tried and the source is corrected (a misattributed but exact quote is
 * still anchored).
 */
export function anchorQuote(
  issue: IssueSnapshot,
  quote: string,
  named: Requirement['source'],
): Anchor | null {
  const q = normalizeForMatch(quote);
  if (!q) return null;
  const all = sources(issue);
  const preferred = all.filter((s) =>
    named.kind === 'comment'
      ? s.source.commentId === named.commentId
      : named.kind === 'tasklist'
        ? s.source.kind === 'body'
        : s.source.kind === named.kind,
  );
  for (const s of [...preferred, ...all.filter((x) => !preferred.includes(x))]) {
    const offset = normalizeForMatch(s.text).indexOf(q);
    if (offset !== -1) {
      const source =
        named.kind === 'tasklist' && s.source.kind === 'body' ? { kind: 'tasklist' as const } : s.source;
      return { order: s.order, offset, source };
    }
  }
  return null;
}

export interface AnchoredDraft {
  issueIndex: number;
  draft: ExtractedRequirement;
  anchor: Anchor;
}

export interface CheckResult {
  anchored: AnchoredDraft[];
  /** One line per problem, for the repair call. */
  errors: string[];
  unanchored: ExtractedRequirement[];
}

/** Anchors every requirement and example quote of one issue's output. */
export function checkOutput(issue: IssueSnapshot, issueIndex: number, out: ExtractionOutput): CheckResult {
  const anchored: AnchoredDraft[] = [];
  const errors: string[] = [];
  const unanchored: ExtractedRequirement[] = [];
  for (const r of out.requirements) {
    const anchor = anchorQuote(issue, r.quote, r.source);
    if (!anchor) {
      errors.push(
        `Requirement ${r.id}: quote "${r.quote.slice(0, 120)}" is not an exact substring of the issue ${r.source.kind}${r.source.commentId ? ` ${r.source.commentId}` : ''}.`,
      );
      unanchored.push(r);
      continue;
    }
    const badExamples = r.examples.filter((e) => !anchorQuote(issue, e.quote, anchor.source));
    for (const e of badExamples)
      errors.push(`Requirement ${r.id}: example quote "${e.quote.slice(0, 80)}" is not in the issue.`);
    anchored.push({
      issueIndex,
      draft: { ...r, examples: r.examples.filter((e) => !badExamples.includes(e)) },
      anchor,
    });
  }
  return { anchored, errors, unanchored };
}

export interface FinalizeResult {
  requirements: Requirement[];
  openQuestions: (OpenQuestion & { issueIndex: number })[];
  warnings: string[];
}

/** Drops duplicates (same normalized quote and text), orders by position, and assigns final IDs. */
export function finalizeRequirements(
  issues: IssueSnapshot[],
  anchored: AnchoredDraft[],
  questions: (OpenQuestion & { issueIndex: number })[],
): FinalizeResult {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const unique = anchored.filter((a) => {
    const key = `${a.issueIndex}|${normalizeForMatch(a.draft.quote).toLowerCase()}|${normalizeForMatch(a.draft.text).toLowerCase()}`;
    if (seen.has(key)) {
      warnings.push(`Dropped a duplicate requirement ("${a.draft.quote.slice(0, 60)}").`);
      return false;
    }
    seen.add(key);
    return true;
  });
  unique.sort(
    (a, b) =>
      a.issueIndex - b.issueIndex || a.anchor.order - b.anchor.order || a.anchor.offset - b.anchor.offset,
  );
  const multi = issues.length > 1;
  const idMap = new Map<string, string>();
  const counters = new Map<number, number>();
  for (const a of unique) {
    const n = (counters.get(a.issueIndex) ?? 0) + 1;
    counters.set(a.issueIndex, n);
    idMap.set(`${a.issueIndex}|${a.draft.id}`, `${multi ? `I${a.issueIndex + 1}.` : ''}R${n}`);
  }
  const requirements: Requirement[] = unique.map((a) => {
    const issue = issues[a.issueIndex] as IssueSnapshot;
    const id = idMap.get(`${a.issueIndex}|${a.draft.id}`) as string;
    if (a.draft.text.length > 400)
      warnings.push(
        `${id}: requirement text is ${a.draft.text.length} characters; it is probably not atomic.`,
      );
    const req: Requirement = {
      id,
      issue: issue.ref,
      text: a.draft.text,
      quote: a.draft.quote,
      source: a.anchor.source,
      kind: a.draft.kind,
      explicitness: a.draft.explicitness,
      priority: a.draft.priority,
      examples: a.draft.examples,
      checkableInCode: a.draft.checkableInCode,
    };
    if (a.draft.supersededBy) {
      req.supersededBy =
        a.draft.supersededBy === 'removed'
          ? 'removed'
          : (idMap.get(`${a.issueIndex}|${a.draft.supersededBy}`) ?? 'removed');
      // Only the issue author or a maintainer can amend (6.2): a replacement quoted from another commenter is ignored.
      const replacement = unique.find(
        (u) => u.issueIndex === a.issueIndex && u.draft.id === a.draft.supersededBy,
      );
      const src = replacement?.anchor.source;
      const role =
        src?.kind === 'comment' ? issue.comments.find((c) => c.id === src.commentId)?.role : undefined;
      if (role === 'other') {
        delete req.supersededBy;
        warnings.push(
          `${id}: ignored an amendment from a comment by someone who is neither the author nor a maintainer.`,
        );
      }
    }
    return req;
  });
  const openQuestions: (OpenQuestion & { issueIndex: number })[] = questions.map((q) => {
    const mapped = q.requirementId ? idMap.get(`${q.issueIndex}|${q.requirementId}`) : undefined;
    const { requirementId: _r, ...rest } = q;
    return mapped ? { ...rest, requirementId: mapped } : rest;
  });
  for (const q of openQuestions) {
    const req = q.requirementId ? requirements.find((r) => r.id === q.requirementId) : undefined;
    if (req && q.readings.length) req.openQuestion = { readings: q.readings.slice(0, 2) };
  }
  return { requirements, openQuestions, warnings };
}
