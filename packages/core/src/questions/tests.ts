/** `tests.v0` (BUILD_PROMPT Appendix C.3): do the tests check the requirement as the issue states it? No implementation code in state. */
import type { Requirement } from '../contracts/index.js';
import { requirementState } from './forward.js';
import { choice, type NoulQuestion, noul } from './types.js';

export const TESTS_CALL = 'tests.v0';
export const MAX_EXAMPLES = 5;

export interface TestCandidate {
  id: string;
  file: string;
  titles: string[];
  change: string;
}

export function testsState(req: Requirement, tests: TestCandidate[]) {
  const r = requirementState(req);
  return {
    requirement: { ...r, examples: r.examples.slice(0, MAX_EXAMPLES) },
    tests: tests.map((t) => ({ id: t.id, file: t.file, titles: t.titles, change: t.change })),
  };
}

export function testsQuestions(tests: Pick<TestCandidate, 'id' | 'file'>[], exampleCount: number) {
  const options: Record<string, string> = {};
  for (const t of tests) options[t.id] = `\`tests\` entry ${t.id} (${t.file})`;
  options.none = 'No entry in `tests` checks it.';
  const qs: Record<string, ReturnType<typeof noul> | ReturnType<typeof choice>> = {
    asserts_as_stated: noul(
      'Does any test in `tests` check the behavior stated in `requirement.text`, expecting exactly what `requirement.text` states?',
      {
        true: 'A test checks that behavior and expects what `requirement.text` states.',
        false: 'No test checks that behavior, or the tests expect something else.',
      },
    ),
    asserts_differently: noul(
      'Does any test in `tests` expect a different result than `requirement.text` states for the same situation?',
      {
        true: 'A test expects a value, status, message or outcome that differs from what `requirement.text` states.',
        false: 'No test expects anything that differs from `requirement.text`.',
      },
    ),
    test_evidence: choice(
      'Which entry in `tests` most directly checks the behavior stated in `requirement.text`?',
      options,
    ),
  };
  for (let i = 0; i < Math.min(exampleCount, MAX_EXAMPLES); i++) {
    qs[`example_${i}_checked`] = noul(
      `Does any test in \`tests\` check that the input in \`requirement.examples[${i}].input\` produces \`requirement.examples[${i}].expected\`?`,
    ) as NoulQuestion;
    qs[`example_${i}_contradicted`] = noul(
      `Does any test in \`tests\` expect a result other than \`requirement.examples[${i}].expected\` for the input in \`requirement.examples[${i}].input\`?`,
    ) as NoulQuestion;
  }
  return qs;
}
