/** `remit init` (BUILD_PROMPT 10.1): writes a commented `.remit.yml`, checks env vars, prints next steps. */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BRAND } from '@remit/core';
import { CliError } from '../errors.js';
import type { Io } from '../io.js';

/** The 10.5 defaults with comments. Parsing it gives exactly `defaultConfig()` (tested). */
export const CONFIG_TEMPLATE = `# ${BRAND.name} configuration. Read from the default branch only; changes in a PR apply after merge.
version: 1
mode: comment_only              # comment_only | rework | gate (gate needs calibration evidence)
languages: [typescript, javascript, python, rust]
ignore_paths: []                # globs, for example ["docs/**", "**/*.snap"]
draft_prs: review               # review | skip
extraction:
  mode: auto                    # auto | llm | tasklist_only
  provider: anthropic           # anthropic | openai_compatible (use a different model family than your coding agent)
  model: claude-opus-5-5
jev:
  model: jev-1.13.0
  max_state_tokens: 24000
  concurrency: 8
  price_per_million_input_usd: 0.042
thresholds:                     # replaced by tuned values when a calibration is active
  full: 0.6
  partial: 0.5
  missing: 0.7
  missing_send_back: 0.85
  contradicted: 0.7
  ambiguous: 0.6
  checkable: 0.35
  preexisting: 0.7
  serves: 0.55
  plumbing: 0.6
  behavior: 0.6
  loosens: 0.7
  min_confidence: 0.5
gate:
  threshold: 0.9
  min_labeled_findings: 200
  min_precision: 0.85
surfaces:
  sticky_comment: true
  check_run: true
  inline_comments: false
  labels: false
issue_checklist: off            # off | on_label | on_assign
issue_checklist_label: agent-ready
rework:
  mention: ""                   # for example "@claude"; empty means never mention anyone
budgets:
  max_usd_per_review: 0.50
  max_units: 400
  max_repo_mb: 200
retention:
  retain_payloads: false
  retention_days: 14
  delete_on_uninstall: true
`;

export function initCommand(argv: string[], io: Io): number {
  const { values } = parseArgs({
    args: argv,
    options: { force: { type: 'boolean', default: false } },
    strict: true,
  });
  const path = join(io.cwd, `.${BRAND.slug}.yml`);
  if (existsSync(path) && !values.force)
    throw new CliError(
      `.${BRAND.slug}.yml already exists.`,
      'Edit it, or rerun with --force to overwrite it with the defaults.',
    );
  writeFileSync(path, CONFIG_TEMPLATE);
  const lines = [`Wrote .${BRAND.slug}.yml with the defaults (comment only).`, ''];
  for (const [key, why] of [
    ['TYPESAFE_API_KEY', 'Jev questions (required for verdicts)'],
    ['ANTHROPIC_API_KEY', 'requirement extraction (or use extraction.mode: tasklist_only)'],
    ['GITHUB_TOKEN', 'reviewing GitHub PRs (a read-only fine-grained token is enough)'],
  ] as const) {
    lines.push(`${io.env[key] ? '✓ set    ' : '✗ missing'} ${key}: ${why}`);
  }
  lines.push(
    '',
    'Next steps:',
    `  1. Put missing keys in .env (see .env.example). ${BRAND.name} loads it at runtime.`,
    `  2. Run \`${BRAND.slug} doctor\` to check keys and connectivity.`,
    `  3. Run \`${BRAND.slug} review --issue issue.md --diff main...HEAD\`, or \`${BRAND.slug} review <pr-url>\`.`,
    '',
  );
  io.out(lines.join('\n'));
  return 0;
}
