/** `preexisting.v0` (BUILD_PROMPT Appendix C.5): does the base code already do what the requirement states? */
import type { Requirement } from '../contracts/index.js';
import { requirementBrief } from './forward.js';
import { noul } from './types.js';

export const PREEXISTING_CALL = 'preexisting.v0';

export interface BaseCode {
  file: string;
  symbol: string;
  code: string;
}

export function preexistingState(req: Requirement, baseCode: BaseCode[]) {
  return {
    requirement: requirementBrief(req),
    base_code: baseCode.map((b) => ({ file: b.file, symbol: b.symbol, code: b.code })),
  };
}

export function preexistingQuestions() {
  return {
    already_implemented: noul(
      'Does the code in `base_code` already implement the behavior stated in `requirement.text`?',
      {
        true: '`base_code` already does what `requirement.text` states.',
        false: '`base_code` does not do it, or does only part of it.',
      },
    ),
  };
}
