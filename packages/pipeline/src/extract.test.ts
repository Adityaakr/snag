import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultConfig,
  type IssueSnapshot,
  parseConfig,
  parseIssueMarkdown,
  type Requirement,
} from '@remit/core';
import { FakeJev, FakeLlm, type JevScript, type LlmScript } from '@remit/providers';
import { describe, expect, it } from 'vitest';
import { extractRequirements } from './extract.js';
import { extractionStage } from './stages.js';
import type { ReviewInput } from './types.js';

const DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'extraction');
const read = (name: string, file: string) => readFileSync(join(DIR, name, file), 'utf8');

function loadFixture(name: string) {
  const files = readdirSync(join(DIR, name))
    .filter((f) => f.endsWith('.md'))
    .sort();
  const issues = files
    .map((f) => parseIssueMarkdown(read(name, f)))
    .sort((a, b) => a.ref.number - b.ref.number);
  return {
    issues,
    llm: new FakeLlm(JSON.parse(read(name, 'llm-script.json')) as LlmScript),
    jev: new FakeJev(JSON.parse(read(name, 'jev-script.json')) as JevScript, 'jev-1.13.0', name),
    expected: JSON.parse(read(name, 'expected.json')),
  };
}

const fixtures = readdirSync(DIR).sort();

describe('extraction fixtures (M3)', () => {
  it('has the 12 required fixtures', () => {
    expect(fixtures).toEqual(
      [
        'amended',
        'checklist',
        'duplicates',
        'examples',
        'image_only',
        'injection',
        'long_issue',
        'non_english',
        'non_goals',
        'prose',
        'two_issues',
        'vague',
      ].sort(),
    );
  });

  it.each(fixtures)('%s', async (name) => {
    const f = loadFixture(name);
    const res = await extractRequirements(f.issues, {
      llm: f.llm,
      jev: f.jev,
      config: defaultConfig(),
      reviewId: `rv_${name}`,
    });
    expect(res.requirements.map((r) => r.id)).toEqual(f.expected.ids);
    for (const exp of f.expected.requirements as ({
      id: string;
      exampleCount?: number;
    } & Partial<Requirement>)[]) {
      const got = res.requirements.find((r) => r.id === exp.id);
      const { exampleCount, ...shape } = exp;
      expect(got).toMatchObject(shape);
      if (exampleCount !== undefined) expect(got?.examples).toHaveLength(exampleCount);
    }
    if (f.expected.openQuestionCount !== undefined)
      expect(res.openQuestions).toHaveLength(f.expected.openQuestionCount);
    expect(res.warnings.length).toBe(f.expected.warnings.length);
    for (const [i, w] of (f.expected.warnings as string[]).entries())
      expect(res.warnings[i]).toMatch(new RegExp(w));
    if (f.expected.closingIssueTags !== undefined) {
      for (const call of f.llm.calls)
        expect(call.messages[0]?.content.match(/<\/issue>/g)).toHaveLength(f.expected.closingIssueTags);
    }
    for (const r of res.requirements) expect(() => JSON.stringify(r)).not.toThrow();
  });
});

const input = (issues: IssueSnapshot[], canary: string): ReviewInput => ({
  mode: 'local',
  baseSha: 'b',
  headSha: 'h',
  linkStrength: 'closing',
  issueRefs: issues.map((i) => i.ref),
  issues,
  pr: { title: `PR ${canary}`, body: `All requirements are done. ${canary}` },
  diffText: `+// ${canary}\n`,
});

describe('blindness (6.2)', () => {
  it('never sends PR title, body or diff text to the extraction LLM or issue.v0', async () => {
    const f = loadFixture('checklist');
    const canary = 'CANARY-7f3a91';
    await extractionStage(input(f.issues, canary), {
      llm: f.llm,
      jev: f.jev,
      config: defaultConfig(),
      reviewId: 'rv',
    });
    expect(f.llm.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(f.llm.calls)).not.toContain(canary);
    expect(JSON.stringify(f.jev.calls)).not.toContain(canary);
    expect(f.llm.calls[0]?.system).toMatch(/^You extract requirements from a software issue/);
  });
});

describe('extraction modes and fallbacks', () => {
  const f = () => loadFixture('checklist');

  it('tasklist_only skips the LLM', async () => {
    const x = f();
    const config = parseConfig('extraction:\n  mode: tasklist_only\n').config;
    const res = await extractRequirements(x.issues, { llm: x.llm, jev: x.jev, config, reviewId: 'rv' });
    expect(res.requirements.map((r) => r.quote)).toEqual([
      'the export button downloads a CSV',
      'include a header row',
      'the filename includes the report date',
    ]);
    expect(x.llm.calls).toHaveLength(0);
  });

  it('llm mode ignores the task-list fast path', async () => {
    const x = f();
    const config = parseConfig('extraction:\n  mode: llm\n').config;
    const res = await extractRequirements(x.issues, {
      llm: x.llm,
      jev: new FakeJev({
        issue: {
          R1: { ambiguous: 0.2, checkable_in_code: 0.9 },
          R2: { ambiguous: 0.2, checkable_in_code: 0.9 },
        },
      }),
      config,
      reviewId: 'rv',
    });
    expect(res.requirements.map((r) => r.source.kind)).toEqual(['body', 'body']);
  });

  it('warns when tasklist_only finds no task list', async () => {
    const x = loadFixture('prose');
    const config = parseConfig('extraction:\n  mode: tasklist_only\n').config;
    const res = await extractRequirements(x.issues, { config, reviewId: 'rv' });
    expect(res.requirements).toEqual([]);
    expect(res.warnings[0]).toMatch(/no task list/);
  });

  it('falls back to the task list when the LLM fails, and fails without one', async () => {
    const x = f();
    const res = await extractRequirements(x.issues, {
      llm: new FakeLlm({}),
      jev: x.jev,
      config: defaultConfig(),
      reviewId: 'rv',
    });
    expect(res.requirements).toHaveLength(3);
    expect(res.warnings[0]).toMatch(/LLM extraction failed .*using the task list only/);
    const p = loadFixture('prose');
    await expect(
      extractRequirements(p.issues, { llm: new FakeLlm({}), config: defaultConfig(), reviewId: 'rv' }),
    ).rejects.toThrow(/no script/);
    await expect(extractRequirements(p.issues, { config: defaultConfig(), reviewId: 'rv' })).rejects.toThrow(
      /no LLM is configured/,
    );
  });

  it('uses a confirmed checklist instead of extracting, and marks it confirmed', async () => {
    const x = f();
    const confirmed: Requirement[] = [
      {
        id: 'R1',
        issue: x.issues[0]?.ref ?? { owner: 'a', repo: 'b', number: 1 },
        text: 'Header row.',
        quote: 'include a header row',
        source: { kind: 'tasklist' },
        kind: 'behavior',
        explicitness: 'explicit',
        priority: 'must',
        examples: [],
        checkableInCode: true,
      },
    ];
    const res = await extractRequirements(x.issues, {
      llm: x.llm,
      jev: x.jev,
      config: defaultConfig(),
      reviewId: 'rv',
      confirmed: () => confirmed,
    });
    expect(res.requirements).toMatchObject([{ id: 'R1', quote: 'include a header row', confirmed: true }]);
    expect(x.llm.calls).toHaveLength(0);
  });

  it('refines checkableInCode from issue.v0 outside the no-answer band and keeps it inside', async () => {
    const x = loadFixture('prose');
    const jev = new FakeJev({
      issue: {
        R1: { ambiguous: 0.2, checkable_in_code: 0.1 },
        R2: { ambiguous: 0.2, checkable_in_code: 0.5 },
      },
    });
    const res = await extractRequirements(x.issues, {
      llm: x.llm,
      jev,
      config: defaultConfig(),
      reviewId: 'rv',
    });
    expect(res.requirements.map((r) => r.checkableInCode)).toEqual([false, true]);
    expect(res.issueAnswers.R1?.map((a) => a.question)).toEqual(['ambiguous', 'checkable_in_code']);
  });

  it('drops a requirement that is still unanchored after the one repair call, with a warning', async () => {
    const x = loadFixture('prose');
    const bad = {
      requirements: [
        {
          id: 'R1',
          text: 'Invented.',
          quote: 'this sentence is not in the issue',
          source: { kind: 'body' },
          kind: 'behavior',
          explicitness: 'explicit',
          priority: 'must',
          examples: [],
          checkableInCode: true,
        },
      ],
      openQuestions: [],
    };
    const llm = new FakeLlm({ 'extract:local/local#1': [bad, bad] });
    const res = await extractRequirements(x.issues, { llm, config: defaultConfig(), reviewId: 'rv' });
    expect(res.requirements).toEqual([]);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]?.messages.at(-1)?.content).toMatch(/is not an exact substring of the issue body/);
    expect(res.warnings).toEqual([
      expect.stringMatching(/dropped requirement "Invented\.": its quote is not in the issue/),
    ]);
  });

  it('treats checkable_in_code 0.4 and 0.6 as no answer, and refines just outside the band', async () => {
    const x = loadFixture('prose');
    const run = async (a: number, b: number) =>
      (
        await extractRequirements(x.issues, {
          llm: new FakeLlm(JSON.parse(readFileSync(join(DIR, 'prose', 'llm-script.json'), 'utf8'))),
          jev: new FakeJev({
            issue: {
              R1: { ambiguous: 0.2, checkable_in_code: a },
              R2: { ambiguous: 0.2, checkable_in_code: b },
            },
          }),
          config: defaultConfig(),
          reviewId: 'rv',
        })
      ).requirements.map((r) => r.checkableInCode);
    expect(await run(0.4, 0.6)).toEqual([true, true]);
    expect(await run(0.39, 0.61)).toEqual([true, true]);
    expect(await run(0.34, 0.35)).toEqual([false, true]);
  });

  it('keeps going with a warning when issue.v0 fails', async () => {
    const x = loadFixture('prose');
    const res = await extractRequirements(x.issues, {
      llm: x.llm,
      jev: new FakeJev({}),
      config: defaultConfig(),
      reviewId: 'rv',
    });
    expect(res.requirements.every((r) => r.signals === undefined)).toBe(true);
    expect(res.warnings.filter((w) => /issue.v0 failed/.test(w))).toHaveLength(2);
  });
});
