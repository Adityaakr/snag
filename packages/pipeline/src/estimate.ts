/**
 * `--dry-run` estimate (BUILD_PROMPT 10.1): calls, tokens and cost without calling any model. Units are built
 * locally; the requirement count is a guess from the issue text (task-list items, else requirement-like
 * sentences), since extraction itself would need the LLM.
 */
import { buildUnits, type ContentSource, parseDiff } from '@remit/analysis';
import {
  claimSentences,
  EXTRACTION_SYSTEM_PROMPT,
  estimateTokens,
  type RemitConfig,
  buildExtractionMessage,
  taskListRequirements,
} from '@remit/core';
import type { ReviewInput } from './types.js';

export interface ReviewEstimate {
  requirements: number;
  units: number;
  testUnits: number;
  sentences: number;
  calls: {
    extraction: number;
    issue: number;
    forward: number;
    tests: number;
    reverse: number;
    claims: number;
    total: number;
  };
  jevInputTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  costUsd: number;
  notes: string[];
}

const REQUIREMENT_WORDS = /\b(must|should|needs? to|required|shall|has to|have to)\b/i;

export function guessRequirementCount(text: string): number {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => REQUIREMENT_WORDS.test(s));
  return Math.max(1, sentences.length);
}

export async function estimateReview(
  input: ReviewInput,
  config: RemitConfig,
  contents?: ContentSource,
): Promise<ReviewEstimate> {
  const notes: string[] = [];
  if (!input.issues.length) {
    return {
      requirements: 0,
      units: 0,
      testUnits: 0,
      sentences: 0,
      calls: { extraction: 0, issue: 0, forward: 0, tests: 0, reverse: 0, claims: 0, total: 0 },
      jevInputTokens: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      costUsd: 0,
      notes: ['No linked issue: nothing would be called.'],
    };
  }
  let requirements = 0;
  let llmIn = 0;
  let llmOut = 0;
  let extraction = 0;
  for (const issue of input.issues) {
    const tasks = taskListRequirements(issue).length;
    const guessed = guessRequirementCount(
      [issue.title, issue.body, ...issue.comments.map((c) => c.body)].join('\n'),
    );
    requirements += config.extraction.mode === 'tasklist_only' ? tasks : Math.max(tasks, guessed);
    if (config.extraction.mode !== 'tasklist_only') {
      extraction++;
      llmIn += estimateTokens(EXTRACTION_SYSTEM_PROMPT) + estimateTokens(buildExtractionMessage(issue));
      llmOut += 1500;
    }
  }
  const { units } = await buildUnits(parseDiff(input.diffText), contents ? { contents } : {});
  const reviewable = units.filter((u) => !u.filtered);
  const tests = reviewable.filter((u) => u.kind === 'test');
  const impl = reviewable.filter((u) => u.kind !== 'test');
  const sentences = claimSentences(input.pr.title, input.pr.body).length;
  const budget = config.jev.max_state_tokens;
  const implTokens =
    Math.min(
      budget,
      impl.reduce((n, u) => n + u.tokenEstimate, 0),
    ) + 600;
  const testTokens =
    Math.min(
      budget,
      tests.reduce((n, u) => n + u.tokenEstimate, 0),
    ) + 500;
  const reqListTokens = requirements * 60;
  const calls = {
    extraction,
    issue: requirements,
    forward: requirements,
    tests: tests.length ? requirements : 0,
    reverse: reviewable.length,
    claims: sentences,
    total: 0,
  };
  calls.total = calls.extraction + calls.issue + calls.forward + calls.tests + calls.reverse + calls.claims;
  const jev =
    requirements * 500 + // issue.v0
    requirements * implTokens +
    calls.tests * testTokens +
    reviewable.reduce((n, u) => n + u.tokenEstimate + reqListTokens + reviewable.length * 15 + 400, 0) +
    sentences * (reqListTokens + 200);
  const price = config.llm_prices[config.extraction.model];
  const cost =
    (jev * config.jev.price_per_million_input_usd) / 1e6 +
    (price ? (llmIn * price.input + llmOut * price.output) / 1e6 : 0);
  notes.push(
    'Requirement count is a guess from the issue text; widen and preexisting calls are not included.',
  );
  if (!price && extraction) notes.push(`No price is configured for ${config.extraction.model}.`);
  if (cost > config.budgets.max_usd_per_review)
    notes.push(
      `The estimate is over the per-review budget of $${config.budgets.max_usd_per_review.toFixed(2)}.`,
    );
  return {
    requirements,
    units: reviewable.length,
    testUnits: tests.length,
    sentences,
    calls,
    jevInputTokens: jev,
    llmInputTokens: llmIn,
    llmOutputTokens: llmOut,
    costUsd: cost,
    notes,
  };
}
