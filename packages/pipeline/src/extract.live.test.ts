// Records live extraction cassettes for the 12 M3 fixtures and notes differences from the scripted outputs
// (BUILD_PROMPT M3, blocker B3). Runs with `pnpm test:live` when ANTHROPIC_API_KEY is set, and through an
// OpenAI-compatible endpoint (such as OpenRouter) when OPENAI_COMPATIBLE_API_KEY and OPENAI_COMPATIBLE_BASE_URL are set.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultConfig, parseIssueMarkdown, type RemitConfig } from '@remit/core';
import {
  AnthropicLlm,
  CachedLlm,
  CostTracker,
  FileStore,
  type LlmProvider,
  OpenAiCompatibleLlm,
} from '@remit/providers';
import { describe, expect, it } from 'vitest';
import { extractRequirements } from './extract.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const DIR = join(ROOT, 'fixtures', 'extraction');

async function recordAll(llm: LlmProvider, config: RemitConfig, report: string, costs: CostTracker) {
  const cached = new CachedLlm(llm, new FileStore(join(ROOT, 'fixtures', 'cassettes')), 'record');
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
    const res = await extractRequirements(issues, { llm: cached, config, reviewId: `live_${name}` });
    notes[name] = {
      expectedIds: expected.ids,
      liveIds: res.requirements.map((r) => r.id),
      liveQuotes: res.requirements.map((r) => r.quote),
      warnings: res.warnings,
    };
  }
  mkdirSync(join(ROOT, 'eval', 'reports'), { recursive: true });
  writeFileSync(
    join(ROOT, 'eval', 'reports', report),
    `${JSON.stringify({ model: llm.model, costUsd: costs.usage.costUsd, fixtures: notes }, null, 2)}\n`,
  );
  return notes;
}

describe('live extraction cassettes', () => {
  it.runIf(Boolean(process.env.ANTHROPIC_API_KEY))(
    'pending: record live extraction cassettes for the 12 fixtures and note differences (blocker B3)',
    async () => {
      const config = defaultConfig();
      const costs = new CostTracker(5);
      const llm = new AnthropicLlm({
        model: config.extraction.model,
        price: { inputPerMillionUsd: 4, outputPerMillionUsd: 20 },
        costs,
      });
      const notes = await recordAll(llm, config, 'extraction-live-vs-scripted.json', costs);
      expect(Object.keys(notes)).toHaveLength(12);
    },
    600_000,
  );

  it.runIf(Boolean(process.env.OPENAI_COMPATIBLE_API_KEY && process.env.OPENAI_COMPATIBLE_BASE_URL))(
    'records the 12 fixtures through an OpenAI-compatible endpoint (OpenRouter)',
    async () => {
      const model = process.env.REMIT_LIVE_OPENAI_MODEL ?? 'anthropic/claude-opus-5.5';
      const config: RemitConfig = {
        ...defaultConfig(),
        extraction: { ...defaultConfig().extraction, provider: 'openai_compatible', model },
      };
      const costs = new CostTracker(5);
      const llm = new OpenAiCompatibleLlm({
        model,
        price: { inputPerMillionUsd: 4, outputPerMillionUsd: 20 },
        costs,
      });
      const notes = await recordAll(llm, config, 'extraction-live-openrouter.json', costs);
      expect(Object.keys(notes)).toHaveLength(12);
    },
    600_000,
  );
});
