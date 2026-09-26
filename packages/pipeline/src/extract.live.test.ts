// Records live extraction cassettes for the 12 M3 fixtures and notes differences from the scripted outputs
// (BUILD_PROMPT M3, blocker B3). Runs with `pnpm test:live` when ANTHROPIC_API_KEY is set.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultConfig, parseIssueMarkdown } from '@remit/core';
import { AnthropicLlm, CachedLlm, FileStore } from '@remit/providers';
import { describe, expect, it } from 'vitest';
import { extractRequirements } from './extract.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const DIR = join(ROOT, 'fixtures', 'extraction');

describe('live extraction cassettes', () => {
  it.runIf(Boolean(process.env.ANTHROPIC_API_KEY))(
    'pending: record live extraction cassettes for the 12 fixtures and note differences (blocker B3)',
    async () => {
      const config = defaultConfig();
      const llm = new CachedLlm(
        new AnthropicLlm({
          model: config.extraction.model,
          price: { inputPerMillionUsd: 4, outputPerMillionUsd: 20 },
        }),
        new FileStore(join(ROOT, 'fixtures', 'cassettes')),
        'record',
      );
      const notes: Record<string, unknown> = {};
      for (const name of readdirSync(DIR).sort()) {
        const issues = readdirSync(join(DIR, name))
          .filter((f) => f.endsWith('.md'))
          .sort()
          .map((f) => parseIssueMarkdown(readFileSync(join(DIR, name, f), 'utf8')))
          .sort((a, b) => a.ref.number - b.ref.number);
        const expected = JSON.parse(readFileSync(join(DIR, name, 'expected.json'), 'utf8')) as {
          ids: string[];
        };
        const res = await extractRequirements(issues, { llm, config, reviewId: `live_${name}` });
        notes[name] = {
          expectedIds: expected.ids,
          liveIds: res.requirements.map((r) => r.id),
          liveQuotes: res.requirements.map((r) => r.quote),
          warnings: res.warnings,
        };
      }
      mkdirSync(join(ROOT, 'eval', 'reports'), { recursive: true });
      writeFileSync(
        join(ROOT, 'eval', 'reports', 'extraction-live-vs-scripted.json'),
        `${JSON.stringify(notes, null, 2)}\n`,
      );
      expect(Object.keys(notes)).toHaveLength(12);
    },
    600_000,
  );
});
