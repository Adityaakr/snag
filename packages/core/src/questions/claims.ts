/** `claims.v0` (BUILD_PROMPT Appendix C.6): what one PR sentence claims, asked only after the blind pass. */
import type { Requirement } from '../contracts/index.js';
import { cleanText } from '../text/sanitize.js';
import { requirementOptions } from './reverse.js';
import { choice, noul } from './types.js';

export const CLAIMS_CALL = 'claims.v0';

export function claimsState(sentence: string, reqs: Requirement[]) {
  return {
    sentence: cleanText(sentence, 1000),
    requirements: reqs.map((r) => ({ id: r.id, text: cleanText(r.text, 2000) })),
  };
}

export function claimsQuestions(reqs: Requirement[]) {
  return {
    claims_done: noul('Does `sentence` state that some work was completed in this pull request?'),
    claims_deferred: noul(
      'Does `sentence` state that some work is not done in this pull request or is left for later?',
    ),
    about: choice(
      'Which entry in `requirements` is `sentence` about?',
      requirementOptions(reqs, '`sentence` is not about any entry in `requirements`.'),
    ),
  };
}
