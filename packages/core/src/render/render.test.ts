import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Finding, type ReviewResult, ReviewResultSchema } from '../contracts/index.js';
import { ANNOTATION_BATCH, checkConclusion, checkRun, checkTitle } from './check.js';
import { issueLabel, renderChecklist, renderComment, renderRework } from './markdown.js';
import { code, MAX_QUOTE, plain, sanitize, sanitizeWithCode } from './sanitize.js';
import { renderSarif } from './sarif.js';
import { renderTerminal } from './terminal.js';

const E1 = ReviewResultSchema.parse(
  JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        '..',
        'fixtures',
        'contracts',
        'ReviewResult',
        'e1-example.json',
      ),
      'utf8',
    ),
  ),
);
const ZWJ = '‍';

describe('sanitize (6.10)', () => {
  it('neutralizes mentions and team mentions', () => {
    expect(sanitize('ping @alice and @acme/security')).toBe(`ping @${ZWJ}alice and @${ZWJ}acme/security`);
    expect(sanitize('mail me at a@b.com')).toContain(`@${ZWJ}b.com`);
  });

  it('renders links as inline code and escapes markdown links', () => {
    expect(sanitize('see https://evil.example/x?y=1 now')).toBe('see `https://evil.example/x?y=1` now');
    expect(sanitize('[click](https://evil.example)')).toBe('\\[click\\](`https://evil.example`)');
    // Not clickable: the scheme lands in inline code.
    expect(sanitize('javascript:alert(1)')).toBe('`javascript:alert(1`)');
  });

  it('strips HTML and images', () => {
    expect(sanitize('a <b>bold</b> <img src=x onerror=y> ![pic](https://x/y.png) <!-- hidden --> z')).toBe(
      'a bold z',
    );
    expect(sanitize('<script>alert(1)</script>ok')).toBe('alert(1)ok');
  });

  it('removes bidi and invisible characters', () => {
    expect(sanitize('ad‮min​⁦x')).toBe('adminx');
  });

  it('truncates very long quotes to 200 characters', () => {
    const s = sanitize('word '.repeat(100));
    expect(s.replace(/\\/g, '').length).toBeLessThanOrEqual(MAX_QUOTE);
    expect(s.endsWith('…')).toBe(true);
  });

  it('escapes markdown and keeps code spans safe', () => {
    expect(sanitize('*bold* _x_ | # h')).toBe('\\*bold\\* \\_x\\_ \\| \\# h');
    expect(code('a`b @c\nd')).toBe(`\`a'b @${ZWJ}c d\``);
    expect(sanitizeWithCode('loosened from `toEqual(` to `toBeDefined()` by @bob')).toBe(
      `loosened from \`toEqual(\` to \`toBeDefined()\` by @${ZWJ}bob`,
    );
    expect(plain('\x1b[31mred\x1b[0m\u0007 text')).toBe('red text');
  });
});

describe('comment, rework and checklist', () => {
  it('renders the E.1 structure with a hidden marker', () => {
    const md = renderComment(E1, { reviewId: 'rv_123' });
    expect(md).toContain('### Remit: does this PR do what #12 asked?');
    expect(md).toContain('Comment only. Nothing here blocks the merge.');
    expect(md).toContain(
      '| R3 | "the filename includes the report date" | ❌ missing | `0.90` | none found |',
    );
    expect(md).toContain('**Needs rework**');
    expect(md).toContain('<details><summary>Unexplained changes (1)</summary>');
    expect(md).toContain('Confidences are raw (not calibrated yet).');
    expect(md.trim().endsWith('<!-- remit:summary v1 review=rv_123 head=abc1234 -->')).toBe(true);
    expect(md).not.toMatch(/—/);
  });

  it('never lets issue text mention people or inject links', () => {
    const evil: ReviewResult = {
      ...E1,
      requirements: E1.requirements.map((q) => ({
        ...q,
        quote: '@everyone see https://evil.example <img src=x>',
      })),
    };
    const md = renderComment(evil, { reviewId: 'rv' });
    expect(md).toContain(`@${ZWJ}everyone`);
    expect(md).toContain('`https://evil.example`');
    expect(md).not.toContain('<img');
  });

  it('renders the rework request with P0 items and a JSON block, only when needed', () => {
    const md = renderRework(E1, { mention: '@claude' }) as string;
    expect(md).toContain('### Remit rework request');
    expect(md).toContain('@claude This PR does not yet do everything #12 asked.');
    expect(md).toContain(
      '1. **R3** "the filename includes the report date" (quoted from #12): no implementation found.',
    );
    const json = JSON.parse(/```json\n(.*)\n```/.exec(md)?.[1] ?? '{}');
    expect(json).toEqual({
      remit: 'rework',
      version: 1,
      issue: 12,
      items: [
        { id: 'F-R3', requirement: 'R3', status: 'missing', quote: 'the filename includes the report date' },
      ],
    });
    expect(renderRework({ ...E1, findings: E1.findings.filter((f) => f.priority !== 'P0') })).toBeNull();
    expect(renderRework(E1)).not.toContain('@claude');
  });

  it('renders the E.3 checklist with an open question', () => {
    const md = renderChecklist(E1.requirements, [
      { requirementId: 'R3', question: 'Which date?', readings: ["the report's date", "today's date"] },
    ]);
    expect(md).toContain('### Remit read this issue as `1` requirement');
    expect(md).toContain('- [ ] **R3** "the filename includes the report date"');
    expect(md).toContain("**Open question:** R3 could mean the report's date or today's date. Which one?");
    expect(md).toContain('reply `/remit confirm`');
  });

  it('labels issues for one repo and several', () => {
    expect(issueLabel([{ owner: 'a', repo: 'b', number: 1 }], 'a/b')).toBe('#1');
    expect(
      issueLabel(
        [
          { owner: 'a', repo: 'b', number: 1 },
          { owner: 'a', repo: 'c', number: 2 },
        ],
        'a/b',
      ),
    ).toBe('#1 and a/c#2');
  });
});

describe('check run, terminal and SARIF', () => {
  it('builds the title, neutral conclusion and batched annotations', () => {
    expect(checkTitle(E1)).toBe('0 of 1 requirement done, 1 missing');
    expect(checkConclusion(E1)).toBe('neutral');
    expect(checkConclusion({ ...E1, summary: { ...E1.summary, mode: 'gate', gateDecision: 'fail' } })).toBe(
      'failure',
    );
    expect(
      checkConclusion({ ...E1, summary: { ...E1.summary, mode: 'gate', gateDecision: 'refused' } }),
    ).toBe('neutral');
    const many: Finding[] = Array.from({ length: 120 }, (_, i) => ({
      ...(E1.findings[2] as Finding),
      id: `F-U${i + 1}`,
    }));
    const run = checkRun({ ...E1, findings: many }, 'rv');
    expect(run.name).toBe('Remit');
    expect(run.annotationBatches.map((b) => b.length)).toEqual([ANNOTATION_BATCH, ANNOTATION_BATCH, 20]);
    expect(run.annotationBatches[0]?.[0]).toMatchObject({
      path: 'config/defaults.ts',
      start_line: 12,
      annotation_level: 'warning',
    });
  });

  it('uses words and icons, not color alone, in the terminal', () => {
    const plainOut = renderTerminal(E1);
    expect(plainOut).toMatch(/R3\s+❌ MISSING\s+0\.90\s+\(none\)\s+P0 send back {2}claim mismatch/);
    expect(plainOut).toMatch(/U7\s+UNEXPLAINED behavioral\s+config\/defaults\.ts:12\s+P1 reviewer/);
    expect(plainOut).not.toContain('\x1b[');
    expect(renderTerminal(E1, { color: true })).toContain('\x1b[31m');
  });

  it('emits SARIF 2.1.0 for unit and fact findings', () => {
    const sarif = renderSarif(E1) as {
      version: string;
      runs: {
        tool: { driver: { name: string; rules: { id: string }[] } };
        results: { ruleId: string; level: string; locations: unknown[] }[];
      }[];
    };
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0]?.tool.driver.name).toBe('Remit');
    expect(sarif.runs[0]?.results).toEqual([
      expect.objectContaining({ ruleId: 'remit/unit/unit.runtime_default', level: 'warning' }),
    ]);
  });
});

describe('explainMarkdown', () => {
  it('fences hostile issue and PR text so nothing renders or mentions anyone', async () => {
    const { explainMarkdown } = await import('./explain.js');
    const { defaultConfig } = await import('../config/schema.js');
    const hostile =
      '@acme/security-team ``` <img src=https://evil.example/p.png> [click](https://evil.example)';
    const r = {
      findings: [
        {
          id: 'F-R1',
          type: 'requirement',
          targetId: 'R1',
          priority: 'P0',
          route: 'send_back',
          confidence: 0.9,
          contentKey: 'k',
          locations: [{ file: 'src/@x.ts', lines: [1, 2] }],
          reasons: [{ template: 't', text: hostile }],
        },
      ],
      requirements: [{ id: 'R1', quote: hostile, kind: 'behavior', priority: 'must' }],
      requirementVerdicts: [
        {
          requirementId: 'R1',
          status: 'missing',
          tested: false,
          calibrated: false,
          evidence: [],
          testEvidence: [],
          answers: [],
          claimMismatch: { sentence: hostile },
        },
      ],
      units: [],
      unitVerdicts: [],
    } as unknown as Parameters<typeof explainMarkdown>[0];
    const md = explainMarkdown(r, 'F-R1', defaultConfig().thresholds) ?? '';
    const fence = /^(`{3,})text\n/.exec(md)?.[1] ?? '';
    expect(fence.length).toBeGreaterThan(3);
    expect(md.trimEnd().endsWith(fence)).toBe(true);
    const inner = md.slice(fence.length + 5, md.trimEnd().length - fence.length);
    expect(inner.includes(fence)).toBe(false);
    expect(/@acme/.test(inner)).toBe(false);
    expect(explainMarkdown(r, 'F-X', defaultConfig().thresholds)).toBeNull();
  });
});
