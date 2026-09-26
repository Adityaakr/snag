import { join } from 'node:path';
import {
  checkRun,
  renderChecklist,
  renderComment,
  renderJson,
  renderRework,
  renderSarif,
  renderTerminal,
  ReviewResultSchema,
} from '@remit/core';
import { describe, expect, it } from 'vitest';
import { loadScenario, runScenario } from './harness.js';

const SNAP = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'snapshots');
const snap = (name: string) => join(SNAP, name);

describe('renderer snapshots from golden results (M5)', () => {
  it('three_reqs_one_missing: every output', async () => {
    const { result } = await runScenario(loadScenario('three_reqs_one_missing'));
    expect(() => ReviewResultSchema.parse(result)).not.toThrow();
    await expect(renderComment(result, { reviewId: 'rv_three_reqs_one_missing' })).toMatchFileSnapshot(
      snap('three_reqs_one_missing.comment.md'),
    );
    await expect(renderRework(result) ?? '').toMatchFileSnapshot(snap('three_reqs_one_missing.rework.md'));
    await expect(renderTerminal(result)).toMatchFileSnapshot(snap('three_reqs_one_missing.terminal.txt'));
    const run = checkRun(result, 'rv_three_reqs_one_missing');
    await expect(
      `${JSON.stringify({ name: run.name, conclusion: run.conclusion, title: run.title, annotationBatches: run.annotationBatches }, null, 2)}\n`,
    ).toMatchFileSnapshot(snap('three_reqs_one_missing.check.json'));
    await expect(`${JSON.stringify(renderSarif(result), null, 2)}\n`).toMatchFileSnapshot(
      snap('three_reqs_one_missing.sarif.json'),
    );
    expect(JSON.parse(renderJson(result))).toEqual(JSON.parse(JSON.stringify(result)));
  });

  it.each([
    'misread_self_consistent',
    'unrelated_config',
    'weakened_assertion',
    'no_linked_issue',
    'ambiguous_recent',
    'partial_examples',
  ])('%s: comment and terminal', async (name) => {
    const { result } = await runScenario(loadScenario(name));
    await expect(renderComment(result, { reviewId: `rv_${name}` })).toMatchFileSnapshot(
      snap(`${name}.comment.md`),
    );
    await expect(renderTerminal(result)).toMatchFileSnapshot(snap(`${name}.terminal.txt`));
  });

  it('ambiguous_recent: issue checklist (E.3)', async () => {
    const { result } = await runScenario(loadScenario('ambiguous_recent'));
    const questions = result.requirements
      .filter((r) => r.openQuestion)
      .map((r) => ({
        requirementId: r.id,
        question: 'How recent?',
        readings: r.openQuestion?.readings ?? [],
      }));
    await expect(renderChecklist(result.requirements, questions)).toMatchFileSnapshot(
      snap('ambiguous_recent.checklist.md'),
    );
  });

  it('unrelated_config: SARIF 2.1.0', async () => {
    const { result } = await runScenario(loadScenario('unrelated_config'));
    await expect(`${JSON.stringify(renderSarif(result), null, 2)}\n`).toMatchFileSnapshot(
      snap('unrelated_config.sarif.json'),
    );
  });
});
