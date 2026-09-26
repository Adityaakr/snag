/**
 * Jev question shapes (structurally identical to the TypeSafe SDK's) so core stays free of provider imports.
 * Question IDs are for code only; the model never sees them (BUILD_PROMPT 7.2).
 */
export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true: string; false: string } | null;
}

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: readonly [string, string, ...string[]];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type QuestionSet = Record<string, Question>;

/** Any change to question wording, criteria or levels bumps this (BUILD_PROMPT 5, 7.5 rule 11). */
export const QUESTION_SET_VERSION = 'qs-0.1.0';

export const noul = (instructions: string, criteria?: { true: string; false: string }): NoulQuestion =>
  criteria ? { type: 'noul', instructions, criteria } : { type: 'noul', instructions };

export const choice = (instructions: string, criteria: Record<string, string | null>): ChoiceQuestion => ({
  type: 'choice',
  instructions,
  criteria,
});

export const score = (
  instructions: string,
  criteria: readonly [string, string, ...string[]],
): ScoreQuestion => ({ type: 'score', instructions, criteria });
