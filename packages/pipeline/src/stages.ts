import { type ExtractionDeps, type ExtractionResult, extractRequirements } from './extract.js';
import type { ReviewInput } from './types.js';

/** Pipeline stage 1: blind extraction. Reads `input.issues` only; the PR title, body and diff are never passed on. */
export function extractionStage(input: ReviewInput, deps: ExtractionDeps): Promise<ExtractionResult> {
  return extractRequirements(input.issues, deps);
}
