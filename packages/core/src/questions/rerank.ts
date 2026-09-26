/**
 * `rerank.v0` (BUILD_PROMPT Appendix C.7, TypeSafe re-ranking cookbook): one Noul per requirement and candidate
 * pair, packed into requests by tokens within the Jev limits; candidates are kept by highest `noul`.
 */
import type { Requirement } from '../contracts/index.js';
import { estimateTokens } from '../tokens.js';
import { cleanText } from '../text/sanitize.js';
import { type NoulQuestion, noul } from './types.js';

export const RERANK_CALL = 'rerank.v0';

export interface RerankCandidate {
  id: string;
  file: string;
  judgeView: string;
}

export function rerankState(req: Requirement) {
  return { requirement: { text: cleanText(req.text, 2000), quote: cleanText(req.quote, 2000) } };
}

export function rerankQuestion(c: RerankCandidate, maxViewChars: number): NoulQuestion {
  const view = c.judgeView.length > maxViewChars ? `${c.judgeView.slice(0, maxViewChars - 1)}…` : c.judgeView;
  return noul(
    `Is the code change below relevant to implementing or testing \`requirement.text\`? Change ${c.id} in ${c.file}: ${view}`,
  );
}

export interface RerankLimits {
  /** State plus the longest question (jev-1.13: 32k). */
  perQuestion: number;
  /** State plus all questions (jev-1.13: 64k; Remit keeps 56k). */
  perRequest: number;
}

/** Packs candidates into requests by tokens. Question ids are `c_<unit id>`. */
export function rerankBatches(
  req: Requirement,
  candidates: RerankCandidate[],
  limits: RerankLimits = { perQuestion: 32_000, perRequest: 56_000 },
) {
  const state = rerankState(req);
  const stateTokens = estimateTokens(state);
  const maxViewChars = Math.max(200, (limits.perQuestion - stateTokens - 200) * 3);
  const batches: { state: typeof state; questions: Record<string, NoulQuestion> }[] = [];
  let current: Record<string, NoulQuestion> = {};
  let used = stateTokens;
  for (const c of candidates) {
    const q = rerankQuestion(c, maxViewChars);
    const t = estimateTokens(q);
    if (Object.keys(current).length && used + t > limits.perRequest) {
      batches.push({ state, questions: current });
      current = {};
      used = stateTokens;
    }
    current[`c_${c.id}`] = q;
    used += t;
  }
  if (Object.keys(current).length) batches.push({ state, questions: current });
  return batches;
}
