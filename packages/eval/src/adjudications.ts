/**
 * Adjudicated label corrections for the mutation corpus dev split (training/laya/audit/label-audit.md, DECISIONS D35).
 * Each entry overrides what OracleJev would otherwise derive from the item labels: `exclude` means the label is
 * uncertain and is not used for training, `relabel` replaces the target. Unresolved ambiguity is excluded, never
 * forced into a class. Only dev seeds appear here; test seeds are never inspected.
 */
export type Adjudication =
  | {
      seedId: string;
      /** The mutation operator, or '*' for every item of the seed. */
      operator: string;
      /** The requirement id the question is about. */
      requirement: string;
      /** `call.question`, e.g. `tests.asserts_differently`. */
      question: string;
      action: 'exclude';
      reason: string;
    }
  | {
      seedId: string;
      operator: string;
      requirement: string;
      question: string;
      action: 'relabel';
      noul: number;
      reason: string;
    };

export const ADJUDICATIONS: readonly Adjudication[] = [
  {
    seedId: 'py-csv-import',
    operator: 'flip_condition',
    requirement: 'R4',
    question: 'tests.asserts_differently',
    action: 'relabel',
    noul: 0,
    reason:
      'the flipped test (81 to 101) still asserts 80 accepted and 101 rejected, which agrees with the requirement',
  },
  {
    seedId: 'py-csv-import',
    operator: 'flip_condition',
    requirement: 'R4',
    question: 'tests.asserts_as_stated',
    action: 'exclude',
    reason: 'the test asserts part of the stated behaviour but misses 81 to 100',
  },
  {
    seedId: 'rs-cli-args',
    operator: 'flip_condition',
    requirement: 'R1',
    question: 'tests.asserts_differently',
    action: 'exclude',
    reason: 'the requirement is silent on -J; only the implementation contradicts it',
  },
  {
    seedId: 'rs-config-parser',
    operator: 'flip_condition',
    requirement: 'R2',
    question: 'tests.asserts_differently',
    action: 'exclude',
    reason: 'the requirement is silent on %; the test only stops checking the ; case',
  },
  {
    seedId: 'ts-job-intervals',
    operator: 'flip_condition',
    requirement: 'R2',
    question: 'forward.conflict',
    action: 'exclude',
    reason: 'the message omits the value (a missing part), not contrary behaviour',
  },
  {
    seedId: 'ts-job-intervals',
    operator: 'flip_condition',
    requirement: 'R2',
    question: 'tests.asserts_differently',
    action: 'relabel',
    noul: 0,
    reason: "toThrow('invalid duration') is a substring check and does not assert that the value is absent",
  },
  {
    seedId: 'ts-flag-rules',
    operator: '*',
    requirement: 'R2',
    question: 'tests.asserts_as_stated',
    action: 'exclude',
    reason: 'the tests check determinism and the 0/100 extremes, not the stated percentage or hash',
  },
];

/** Test refs that seed annotations list for a requirement but that do not assert it (audit table). */
export const EXCLUDED_TEST_REFS: readonly {
  seedId: string;
  requirement: string;
  symbol: string;
  reason: string;
}[] = [
  {
    seedId: 'ts-job-intervals',
    requirement: 'R1',
    symbol: 'keeps the job name',
    reason: 'a base test that only asserts the name; not an R1 assertion',
  },
];

/** The adjudication for one question, if any. */
export function adjudicationFor(
  seedId: string,
  operator: string,
  requirement: string,
  question: string,
): Adjudication | undefined {
  return ADJUDICATIONS.find(
    (a) =>
      a.seedId === seedId &&
      (a.operator === '*' || a.operator === operator) &&
      a.requirement === requirement &&
      a.question === question,
  );
}
