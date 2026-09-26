/**
 * Reasons are template ids plus rendered text, never generated prose (BUILD_PROMPT 6.9). Copy style: plain
 * words, numbers in monospace, no em-dashes.
 */
export interface Reason {
  template: string;
  text: string;
}

const n = (x: number) => `\`${x.toFixed(2)}\``;

export const REASONS = {
  notCheckable: () => ({
    template: 'req.not_checkable',
    text: 'This needs a manual check: it cannot be decided from the code alone.',
  }),
  deferred: (sentence: string) => ({
    template: 'req.deferred',
    text: `The PR description says this is left for later: "${sentence}".`,
  }),
  contradicted: (p: number) => ({
    template: 'req.contradicted',
    text: `The change or its tests do something different from what the issue states (${n(p)}).`,
  }),
  interpretationMismatch: (p: number) => ({
    template: 'req.interpretation_mismatch',
    text: `The change follows a different reading of an ambiguous requirement (${n(p)}). Ask the author which reading is meant.`,
  }),
  done: (p: number) => ({ template: 'req.done', text: `Implemented (${n(p)}).` }),
  nonGoalRespected: () => ({
    template: 'req.non_goal_respected',
    text: 'No change goes against this exclusion.',
  }),
  partial: (p: number) => ({
    template: 'req.partial',
    text: `Mostly implemented, but at least one stated case, value or condition is not (${n(p)}).`,
  }),
  missing: (p: number) => ({ template: 'req.missing', text: `No change implements this (${n(p)}).` }),
  preexisting: (p: number) => ({
    template: 'req.preexisting',
    text: `The code before this PR already does this (${n(p)}).`,
  }),
  uncertain: () => ({
    template: 'req.uncertain',
    text: 'The checks did not agree well enough for a verdict.',
  }),
  noForward: () => ({
    template: 'req.no_answers',
    text: 'The coverage check could not run, so there is no verdict.',
  }),
  untested: () => ({ template: 'req.untested', text: 'Implemented, but no test checks it.' }),
  deadImplementation: () => ({ template: 'req.dead_implementation', text: 'Implemented but never called.' }),
  loosenedEvidence: () => ({
    template: 'req.loosened_evidence',
    text: 'The test that covers this was loosened.',
  }),
  ambiguous: (readings: string[]) => ({
    template: 'req.ambiguous',
    text: readings.length
      ? `The issue can be read more than one way: ${readings.map((r) => `"${r}"`).join(' or ')}.`
      : 'The issue can be read more than one way.',
  }),
  claimMismatch: (sentence: string) => ({
    template: 'req.claim_mismatch',
    text: `The PR description says this is done: "${sentence}".`,
  }),
  forwardReverseDisagree: () => ({
    template: 'check.disagree',
    text: 'Forward and reverse checks disagree.',
  }),
  exampleNotChecked: (indexes: number[]) => ({
    template: 'req.example_not_checked',
    text: `Example ${indexes.map((i) => i + 1).join(', ')} is not checked by any test.`,
  }),
  unitIgnored: (why: string) => ({ template: 'unit.ignored', text: `Ignored: ${why.replace('_', ' ')}.` }),
  unitImplements: (id: string) => ({ template: 'unit.implements', text: `Implements ${id}.` }),
  unitSupporting: () => ({
    template: 'unit.supporting',
    text: 'Supporting work for other changes in this PR.',
  }),
  unitBehavioral: (p: number) => ({
    template: 'unit.unexplained_behavioral',
    text: `Changes observable behavior that no requirement mentions (${n(p)}).`,
  }),
  unitRuntimeSetting: (p: number) => ({
    template: 'unit.runtime_setting',
    text: `Changes a runtime default that no requirement mentions (${n(p)}).`,
  }),
  unitUncertain: () => ({
    template: 'unit.uncertain',
    text: 'Unclear whether this serves a requirement or changes behavior.',
  }),
  unitBenign: () => ({
    template: 'unit.unexplained_benign',
    text: 'Not linked to a requirement; no behavior change found.',
  }),
  unitNoAnswers: () => ({
    template: 'unit.no_answers',
    text: 'The reverse check could not run for this change.',
  }),
  testLoosened: (detail: string) => ({ template: 'test.loosened', text: detail }),
  testLoosenedModel: (p: number) => ({
    template: 'test.loosened_model',
    text: `This change makes an existing test accept results it rejected before (${n(p)}).`,
  }),
  fact: (detail: string) => ({ template: 'fact', text: detail }),
} satisfies Record<string, (...args: never[]) => Reason>;
