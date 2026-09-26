import { defaultConfig, parseConfig, parseIssueMarkdown } from '@remit/core';
import {
  type CallMeta,
  CostTracker,
  type JevProvider,
  ProviderError,
  type Questions,
} from '@remit/providers';
import { describe, expect, it } from 'vitest';
import { runReview } from './review.js';
import type { ReviewInput } from './types.js';

/** A test-only Jev that answers any question with valid, neutral-looking values and records call kinds. */
class GenericJev implements JevProvider {
  readonly model = 'jev-1.13.0';
  readonly calls: CallMeta[] = [];
  constructor(private readonly failKinds: string[] = []) {}
  async ask<Q extends Questions>(meta: CallMeta, _state: unknown, questions: Q) {
    this.calls.push(meta);
    if (this.failKinds.includes(meta.kind)) throw new ProviderError('jev', 'server', 'boom');
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(questions)) {
      if (q.type === 'noul') answers[id] = { type: 'noul', noul: 0.2 };
      else if (q.type === 'choice') {
        const keys = Object.keys(q.criteria);
        answers[id] = {
          type: 'choice',
          choice: keys[0],
          confidence: 1,
          probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0])),
        };
      } else
        answers[id] = {
          type: 'score',
          score: 3,
          confidence: 0.9,
          legend: {},
          probabilities: { '0': 0, '1': 0, '2': 0.1, '3': 0.9 },
        };
    }
    return {
      answers: answers as never,
      model: this.model,
      usage: { inputTokens: 10, outputTokens: 0 },
      costUsd: 0,
      cached: false,
    };
  }
}

const issue = parseIssueMarkdown(
  '<!-- issue: acme/app#1 -->\n# Report tests\n\n- [ ] the report export has tests\n',
);
function diffWithTests(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `diff --git a/test/report${i}.test.ts b/test/report${i}.test.ts\nnew file mode 100644\n--- /dev/null\n+++ b/test/report${i}.test.ts\n@@ -0,0 +1,3 @@\n+it('report export case ${i} ${'x'.repeat(900)}', () => {\n+  expect(1).toBe(1);\n+});\n`;
  }
  return `${out}diff --git a/src/report.ts b/src/report.ts\n--- a/src/report.ts\n+++ b/src/report.ts\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;\n`;
}
const input = (diffText: string, over: Partial<ReviewInput> = {}): ReviewInput => ({
  mode: 'local',
  baseSha: 'b',
  headSha: 'h',
  linkStrength: 'closing',
  issueRefs: [issue.ref],
  issues: [issue],
  pr: { title: '', body: '' },
  diffText,
  ...over,
});

describe('runReview', () => {
  it('reranks test candidates too when more than 40 test units score (6.5 step 6)', async () => {
    const jev = new GenericJev();
    const r = await runReview(input(diffWithTests(60)), {
      jev,
      config: parseConfig('extraction:\n  mode: tasklist_only\n').config,
      reviewId: 'rv',
      now: () => 0,
    });
    expect(jev.calls.some((c) => c.kind === 'rerank' && /#t\d+$/.test(c.targetId))).toBe(true);
    expect(r.requirementVerdicts).toHaveLength(1);
  });

  it('returns a neutral result with linking guidance when no issue is linked', async () => {
    const r = await runReview(input('', { issues: [], issueRefs: [], linkStrength: 'none' }), {
      config: defaultConfig(),
      reviewId: 'rv',
      now: () => 0,
    });
    expect(r.findings).toEqual([]);
    expect(r.warnings[0]).toMatch(/No linked issue was found.*Fixes #123/);
    expect(r.input.linkStrength).toBe('none');
  });

  it('warns without a Jev provider and when calls fail, instead of throwing', async () => {
    const cfg = parseConfig('extraction:\n  mode: tasklist_only\n').config;
    const none = await runReview(input(diffWithTests(1)), { config: cfg, reviewId: 'rv', now: () => 0 });
    expect(none.warnings.join('\n')).toMatch(/No Jev provider is configured/);
    expect(none.requirementVerdicts[0]?.status).toBe('uncertain');
    const failing = await runReview(input(diffWithTests(1)), {
      jev: new GenericJev(['forward', 'reverse']),
      config: cfg,
      reviewId: 'rv',
      now: () => 0,
    });
    expect(failing.warnings.join('\n')).toMatch(/forward R1: jev: boom/);
    expect(failing.unitVerdicts.every((u) => u.role === 'uncertain' || u.role === 'ignored')).toBe(true);
  });

  it('stops calling providers once the budget is spent and keeps partial results', async () => {
    const cfg = parseConfig('extraction:\n  mode: tasklist_only\n').config;
    const costs = new CostTracker(0);
    const budgetJev: JevProvider = {
      model: 'jev-1.13.0',
      ask: () => Promise.reject(new ProviderError('jev', 'budget', 'budget of $0.00 reached')),
    };
    const r = await runReview(input(diffWithTests(1)), {
      jev: budgetJev,
      config: cfg,
      reviewId: 'rv',
      costs,
      now: () => 0,
    });
    expect(r.warnings.filter((w) => /Budget reached/.test(w))).toHaveLength(1);
  });

  it('drops files matching ignore_paths and reports extraction failures as a neutral result', async () => {
    const cfg = parseConfig("extraction:\n  mode: tasklist_only\nignore_paths: ['test/**']\n").config;
    const r = await runReview(input(diffWithTests(3)), {
      jev: new GenericJev(),
      config: cfg,
      reviewId: 'rv',
      now: () => 0,
    });
    expect(r.units.map((u) => u.file)).toEqual(['src/report.ts']);
    expect(r.warnings.join('\n')).toMatch(/3 file\(s\) matched ignore_paths/);
    const prose = parseIssueMarkdown('# X\n\nNo task list here.\n');
    const failed = await runReview(input('', { issues: [prose] }), {
      config: defaultConfig(),
      reviewId: 'rv',
      now: () => 0,
    });
    expect(failed.warnings[0]).toMatch(/Requirement extraction failed/);
  });
});
