/** `reverse.v0` (BUILD_PROMPT Appendix C.4): which requirement a change serves, and whether it changes behavior. */
import type { Requirement, UnitKind } from '../contracts/index.js';
import { cleanText } from '../text/sanitize.js';
import { choice, noul } from './types.js';

export const REVERSE_CALL = 'reverse.v0';

export interface ReverseChange {
  id: string;
  file: string;
  symbol: string;
  kind: UnitKind;
  change: string;
}

export function reverseState(
  reqs: Requirement[],
  change: ReverseChange,
  others: Pick<ReverseChange, 'id' | 'file' | 'symbol'>[],
) {
  return {
    requirements: reqs.map((r) => ({ id: r.id, text: cleanText(r.text, 2000) })),
    change: {
      id: change.id,
      file: change.file,
      symbol: change.symbol,
      kind: change.kind,
      change: change.change,
    },
    other_changes: others.map((o) => ({ id: o.id, file: o.file, symbol: o.symbol })),
  };
}

/** Requirement options for Choice questions: key `{id}`, description with the first 160 characters of text. */
export function requirementOptions(reqs: Requirement[], none: string): Record<string, string> {
  const options: Record<string, string> = {};
  for (const r of reqs)
    options[r.id] = `\`requirements\` entry ${r.id}: ${cleanText(r.text, 10_000).slice(0, 160)}`;
  options.none = none;
  return options;
}

/**
 * `loosens_test` is asked of test units only and `runtime_setting` of config and CI units only (the applicability
 * notes in C.4 are not sent to the model; DECISIONS D18).
 */
export function reverseQuestions(reqs: Requirement[], kind: UnitKind) {
  const qs: Record<string, ReturnType<typeof noul> | ReturnType<typeof choice>> = {
    serves: choice(
      'Which entry in `requirements` does the code change in `change` directly implement?',
      requirementOptions(reqs, 'The change does not directly implement any entry in `requirements`.'),
    ),
    plumbing: noul(
      'Is `change` limited to supporting work that other entries in `other_changes` depend on, such as types, imports, exports, wiring, helper functions or renames?',
      {
        true: 'It only provides what other changes in this pull request need.',
        false: 'It does more than support other changes, or nothing in `other_changes` needs it.',
      },
    ),
    behavior_change: noul(
      'Does `change` alter behavior that a caller, user or test could observe, such as return values, errors, side effects, defaults, limits, timing or permissions?',
      {
        true: 'Observable behavior after the change differs from before.',
        false:
          'Only formatting, names, comments, types or internal structure change, and observable behavior is identical.',
      },
    ),
  };
  if (kind === 'test') {
    qs.loosens_test = noul(
      'Does `change` make an existing test accept results it would have rejected before, for example by removing or relaxing an assertion, skipping a test or widening a tolerance?',
    );
  }
  if (kind === 'config' || kind === 'ci') {
    qs.runtime_setting = noul(
      'Does `change` alter a default value, limit, timeout, feature flag, permission or environment setting that is used when the software or its CI runs?',
    );
  }
  return qs;
}
