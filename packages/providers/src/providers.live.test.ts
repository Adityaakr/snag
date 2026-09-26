// Live provider smoke tests (BUILD_PROMPT M2). Run with `pnpm test:live`. Each suite runs only when its key is
// set; the live config prints `skipped: <KEY> not set` otherwise. Costs a fraction of a cent.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveGitHub } from './github/live.js';
import { LiveJev } from './jev/live.js';
import { noul } from './jev/types.js';
import { AnthropicLlm } from './llm/anthropic.js';

// vitest.live.config.ts prints `skipped: <KEY> not set` for each missing key.
const gate = (key: string): boolean => Boolean(process.env[key]);

const hasJev = gate('TYPESAFE_API_KEY');
const hasAnthropic = gate('ANTHROPIC_API_KEY');
const hasGitHub = gate('GITHUB_TOKEN');

describe('live TypeSafe', () => {
  it.runIf(hasJev)('pending: TypeSafe answers with the pinned jev-1.13.0 (blocker B2)', async () => {
    const jev = new LiveJev({ model: 'jev-1.13.0', pricePerMillionUsd: 0.042 });
    const r = await jev.ask(
      { kind: 'issue', questionSet: 'live-smoke', targetId: 't', reviewId: 'live' },
      'The export button downloads a CSV file.',
      {
        csv: noul('Does `state` say that a CSV file is downloaded?', {
          true: 'It says so.',
          false: 'It does not.',
        }),
      },
    );
    expect(r.model).toBe('jev-1.13.0');
    expect(r.answers.csv.noul).toBeGreaterThan(0.5);
  });
});

describe('live Anthropic', () => {
  it.runIf(hasAnthropic)(
    'pending: live Models API confirms claude-opus-5-5 and structured output works (blocker B2)',
    async () => {
      const llm = new AnthropicLlm({
        model: 'claude-opus-5-5',
        price: { inputPerMillionUsd: 4, outputPerMillionUsd: 20 },
        effort: 'low',
      });
      expect(await llm.listModels()).toContain('claude-opus-5-5');
      const r = await llm.structured(
        z.object({ color: z.string() }),
        [{ role: 'user', content: 'The sky is blue. What color is the sky?' }],
        {
          schemaName: 'color',
          system: 'Answer with the color only.',
          promptVersion: 'live-smoke',
        },
      );
      expect(r.data.color.toLowerCase()).toContain('blue');
    },
  );
});

describe('live GitHub', () => {
  it.runIf(hasGitHub)('reads a public issue and rate-limit headroom', async () => {
    const gh = new LiveGitHub();
    expect((await gh.rateLimit()).limit).toBeGreaterThan(60);
    const issue = await gh.getIssue({ owner: 'octocat', repo: 'Hello-World', number: 1 });
    expect(issue.title.length).toBeGreaterThan(0);
  });
});
