/** `forward.v0` (BUILD_PROMPT Appendix C.2): how much of a requirement the candidate changes implement. */
import type { Requirement } from '../contracts/index.js';
import { cleanText } from '../text/sanitize.js';
import { choice, noul, score } from './types.js';

export const FORWARD_CALL = 'forward.v0';

export interface ForwardCandidate {
  id: string;
  file: string;
  symbol: string;
  change: string;
  after?: string;
}

/** The requirement as Jev sees it in forward and tests calls: text, quote and examples. */
export function requirementState(req: Requirement) {
  return {
    text: cleanText(req.text, 2000),
    quote: cleanText(req.quote, 2000),
    examples: req.examples.map((e) => ({
      input: cleanText(e.input, 500),
      expected: cleanText(e.expected, 500),
    })),
  };
}

/** The requirement without examples (preexisting, rerank). */
export function requirementBrief(req: Requirement) {
  return { text: cleanText(req.text, 2000), quote: cleanText(req.quote, 2000) };
}

export function forwardState(req: Requirement, candidates: ForwardCandidate[]) {
  return {
    requirement: requirementState(req),
    candidates: candidates.map((c) => ({
      id: c.id,
      file: c.file,
      symbol: c.symbol,
      change: c.change,
      ...(c.after !== undefined ? { after: c.after } : {}),
    })),
  };
}

export function forwardQuestions(candidates: Pick<ForwardCandidate, 'id' | 'file' | 'symbol'>[]) {
  const options: Record<string, string> = {};
  for (const c of candidates) options[c.id] = `\`candidates\` entry ${c.id} (${c.file}, ${c.symbol})`;
  options.none = 'No entry in `candidates` implements any part of `requirement.text`.';
  return {
    coverage: score(
      'How much of the behavior stated in `requirement.text` do the code changes in `candidates` implement? Judge only what the code in `candidates` does.',
      [
        'None: no change in `candidates` implements any part of `requirement.text`.',
        'Touched: a change edits related code, but the behavior stated in `requirement.text` is still not implemented.',
        'Most: the main behavior is implemented, but at least one case, value or condition stated in `requirement.text` is not.',
        'Full: every case, value and condition stated in `requirement.text` is implemented.',
      ],
    ),
    conflict: noul(
      'Does any change in `candidates` implement behavior that differs from what `requirement.text` states for the same situation, such as a different value, a different condition or the opposite outcome?',
      {
        true: 'At least one change in `candidates` does something different from what `requirement.text` states for the same situation.',
        false:
          'No change in `candidates` does something different from `requirement.text`. Behavior that is simply missing counts as false.',
      },
    ),
    evidence: choice(
      'Which entry in `candidates` most directly implements the behavior stated in `requirement.text`?',
      options,
    ),
  };
}
