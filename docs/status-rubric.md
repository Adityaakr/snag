# Requirement status rubric

This is the written standard for labelling and adjudicating requirement statuses and findings. Labels are decided from the requirement text and the code, never to match a system's prediction. When the evidence does not decide a case, the label is **ambiguous**: it is recorded with the competing readings and excluded from strict scoring until resolved.

## Scope of evidence

- **The PR:** the diff and the head tree it produces.
- **Existing code:** the base tree. Behaviour already present in unchanged code counts; "absent from the diff" is not "missing".
- **The requirement text:** the requirement as extracted, with its source quote. Implications the text does not state are not requirements.

## Statuses

| Status | Definition | Test |
|---|---|---|
| **done** | The head code implements the stated behaviour for the situations the requirement names. | Every situation the text names produces the stated outcome. |
| **partial** | Some of the situations or parts the requirement names are implemented and at least one named part is not, **and** the missing part is absent rather than handled differently. | Name the implemented part and the absent part. |
| **missing** | No code in the head tree (changed or unchanged) implements the stated behaviour, **and** nothing handles the same situation with a different, defined outcome. | Search the head tree, not only the diff. If a code path handles the situation differently, see contradicted. |
| **contradicted** | Code handles a situation the requirement names and produces an outcome the requirement rules out (different value, condition, order or result). | Cite the situation, the stated outcome and the code's outcome. |
| **preexisting** | The behaviour was already implemented in the base tree, and the PR neither needed to change it nor broke it. | Show it in base. |
| **not checkable** | The requirement cannot be verified from code (process, documentation, performance without a target). | |
| **ambiguous** (adjudication only) | The requirement text supports more than one reading that changes the status, or the evidence cannot decide between two statuses. | Record both readings. |

### Missing versus contradicted (the frequent dispute)

- When a requirement is removed and the code falls back to an **older behaviour for the same situation**, it is **contradicted** if that older behaviour is an outcome the requirement rules out. For example, "delays double" versus a fixed delay.
- It is **missing** if the situation is simply not handled (no code path produces any outcome for it), or if the fallback is outside what the requirement speaks about.
- A mutation's operator name (drop, partial, unwire) is **not** evidence of the status. The code is.

### Partial versus contradicted

- If a named case is removed and that case now reaches a code path with a defined, different outcome (for example it now raises an error), the case is **contradicted** for that input.
- If it is simply not handled (no outcome), it is **partial**.

## Findings

A surfaced finding is **valid** when all of these hold:
1. it names the right requirement (or code location for a unit finding);
2. its asserted problem is true under this rubric;
3. its type matches the problem (missing, partial or contradicted; unexplained behaviour; test integrity).

A finding with a true problem but the wrong type is **type-mismatched**, not valid. A finding about a real problem other than the labelled one is **valid-unlabelled** and is recorded for label review.

## Tests

- **asserts as stated:** a test exercises the stated behaviour and expects the stated outcome.
- **asserts differently:** a test expects an outcome the requirement rules out.
- **insufficient:** tests exist but do not exercise the stated behaviour or its named cases.
- Test correctness is judged from the test code against the requirement, never inferred from the implementation's status.
