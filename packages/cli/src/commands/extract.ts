/** `remit extract <issue-url|file>` (BUILD_PROMPT 10.1): requirements and open questions only. */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { type IssueRef, type IssueSnapshot, parseIssueMarkdown } from '@remit/core';
import { type ExtractionResult, extractRequirements } from '@remit/pipeline';
import type { GitHubProvider } from '@remit/providers';
import { ProviderError } from '@remit/providers';
import { loadConfig } from '../config.js';
import { CliError, EXIT } from '../errors.js';
import type { Io } from '../io.js';
import { buildProviders, type CliProviders } from '../providers.js';

/** Parses `https://github.com/o/r/issues/12` or `o/r#12`. */
export function parseIssueTarget(text: string): IssueRef | null {
  const url = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?(?:[#?].*)?$/.exec(text);
  const short = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(text);
  const m = url ?? short;
  return m ? { owner: m[1] as string, repo: m[2] as string, number: Number(m[3]) } : null;
}

/** Loads an issue from a markdown file or GitHub. */
export async function loadIssue(target: string, cwd: string, github: GitHubProvider): Promise<IssueSnapshot> {
  const path = isAbsolute(target) ? target : join(cwd, target);
  if (existsSync(path)) return parseIssueMarkdown(readFileSync(path, 'utf8'));
  const ref = parseIssueTarget(target);
  if (!ref)
    throw new CliError(
      `"${target}" is neither a file nor a GitHub issue.`,
      'Pass a markdown file, a URL such as https://github.com/owner/repo/issues/12, or owner/repo#12.',
    );
  return github.getIssue(ref);
}

function pct(n: number | undefined): string {
  return n === undefined ? ' -  ' : n.toFixed(2);
}

export function renderExtraction(res: ExtractionResult, notes: readonly string[]): string {
  const lines: string[] = [];
  if (!res.requirements.length) lines.push('No checkable requirements found.');
  for (const r of res.requirements) {
    const flags = [
      r.supersededBy ? `superseded by ${r.supersededBy}` : '',
      r.kind === 'non_goal' ? 'non-goal' : '',
      r.checkableInCode ? '' : 'manual check',
      r.confirmed ? 'confirmed' : '',
    ]
      .filter(Boolean)
      .join(', ');
    lines.push(
      `${r.id.padEnd(6)} ${r.priority.padEnd(6)} ${r.kind.padEnd(11)} amb ${pct(r.signals?.ambiguous)}  chk ${pct(r.signals?.checkable)}  "${r.quote.length > 90 ? `${r.quote.slice(0, 89)}…` : r.quote}"${flags ? `  (${flags})` : ''}`,
    );
    for (const e of r.examples)
      lines.push(`         example: ${JSON.stringify(e.input)} -> ${JSON.stringify(e.expected)}`);
  }
  if (res.openQuestions.length) {
    lines.push('', 'Open questions:');
    for (const q of res.openQuestions)
      lines.push(
        `  - ${q.requirementId ? `${q.requirementId}: ` : ''}${q.question}${q.readings.length ? ` (readings: ${q.readings.join(' | ')})` : ''}`,
      );
  }
  for (const n of notes) lines.push(`note: ${n}`);
  for (const w of res.warnings) lines.push(`warning: ${w}`);
  return `${lines.join('\n')}\n`;
}

export async function extractCommand(argv: string[], io: Io, providers?: CliProviders): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      offline: { type: 'boolean', default: false },
      config: { type: 'string' },
    },
    strict: true,
  });
  const target = positionals[0];
  if (!target)
    throw new CliError(
      'remit extract needs an issue.',
      'Run `remit extract issue.md` or `remit extract https://github.com/owner/repo/issues/12`.',
    );
  const config = loadConfig(io.cwd, values.config);
  const p = providers ?? buildProviders(config, io.env, { offline: values.offline });
  try {
    const issue = await loadIssue(target, io.cwd, p.github);
    const res = await extractRequirements([issue], {
      ...(p.llm ? { llm: p.llm } : {}),
      ...(p.jev ? { jev: p.jev } : {}),
      config,
      reviewId: `rv_extract_${Date.now()}`,
    });
    io.out(
      values.json
        ? `${JSON.stringify({ ...res, notes: p.notes, usage: p.costs.usage }, null, 2)}\n`
        : renderExtraction(res, p.notes),
    );
    return EXIT.ok;
  } catch (e) {
    if (e instanceof ProviderError)
      throw new CliError(
        e.message,
        e.fix ?? 'Run `remit doctor` to check keys and connectivity.',
        e.kind === 'budget' ? EXIT.budget : EXIT.provider,
      );
    throw e;
  }
}
