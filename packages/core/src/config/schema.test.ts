import { describe, expect, it } from 'vitest';
import { defaultConfig, parseConfig } from './schema.js';

describe('config (10.5)', () => {
  it('has every spec default', () => {
    const c = defaultConfig();
    expect(c).toMatchObject({
      version: 1,
      mode: 'comment_only',
      draft_prs: 'review',
      extraction: { mode: 'auto', provider: 'anthropic', model: 'claude-opus-5-5' },
      jev: {
        model: 'jev-1.13.0',
        max_state_tokens: 24000,
        concurrency: 8,
        price_per_million_input_usd: 0.042,
      },
      thresholds: {
        full: 0.6,
        partial: 0.5,
        missing: 0.7,
        missing_send_back: 0.85,
        contradicted: 0.7,
        ambiguous: 0.6,
        checkable: 0.35,
        preexisting: 0.7,
        serves: 0.55,
        plumbing: 0.6,
        behavior: 0.6,
        loosens: 0.7,
        min_confidence: 0.5,
      },
      gate: { threshold: 0.9, min_labeled_findings: 200, min_precision: 0.85 },
      surfaces: { sticky_comment: true, check_run: true, inline_comments: false, labels: false },
      issue_checklist: 'off',
      issue_checklist_label: 'agent-ready',
      rework: { mention: '' },
      budgets: { max_usd_per_review: 0.5, max_units: 400, max_repo_mb: 200 },
      retention: { retain_payloads: false, retention_days: 14, delete_on_uninstall: true },
    });
    expect(parseConfig('').config).toEqual(c);
  });

  it('merges partial sections with defaults', () => {
    const { config, errors } = parseConfig(
      'mode: rework\nthresholds:\n  full: 0.7\nrework:\n  mention: "@claude"\n',
    );
    expect(errors).toEqual([]);
    expect(config.mode).toBe('rework');
    expect(config.thresholds.full).toBe(0.7);
    expect(config.thresholds.partial).toBe(0.5);
    expect(config.rework.mention).toBe('@claude');
  });

  it.each([
    ['mode: block', /mode/],
    ['thresholds:\n  full: 1.5', /thresholds\.full/],
    ['unknown_key: 1', /Unrecognized key/],
    ['jev:\n  max_state_tokens: 99999', /max_state_tokens/],
    ['mode: [', /not valid YAML/],
  ])('reports errors and falls back to defaults for %j', (text, message) => {
    const { config, errors } = parseConfig(text);
    expect(errors.join('\n')).toMatch(message);
    expect(config).toEqual(defaultConfig());
  });
});
