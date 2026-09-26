import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type AttributeRule,
  buildUnits,
  type ContentSource,
  DiffParseError,
  detectFacts,
  GitError,
  GitGrepReferences,
  LocalGit,
  localContents,
  parseDiff,
  parseGitattributes,
  parseRange,
  type ReferenceIndex,
} from '@remit/analysis';
import type { ChangeUnit } from '@remit/core';
import { CliError } from '../errors.js';
import type { Io } from '../io.js';

export interface DiffInput {
  text: string;
  contents?: ContentSource;
  attributes?: AttributeRule[];
  references?: ReferenceIndex;
  baseSha: string;
  headSha: string;
}

function inGitRepo(cwd: string): boolean {
  try {
    new LocalGit(cwd).resolve('HEAD');
    return true;
  } catch {
    return false;
  }
}

/** Resolves `--diff` as a file path or a git range (`base..head`, `base...head`). */
export function loadDiff(spec: string, cwd: string): DiffInput {
  const path = isAbsolute(spec) ? spec : join(cwd, spec);
  if (existsSync(path)) {
    const text = readFileSync(path, 'utf8');
    const gitAttrPath = join(cwd, '.gitattributes');
    return {
      text,
      ...(existsSync(gitAttrPath)
        ? { attributes: parseGitattributes(readFileSync(gitAttrPath, 'utf8')) }
        : {}),
      // Local mode searches the working tree for references (BUILD_PROMPT 6.4.2).
      ...(inGitRepo(cwd) ? { references: new GitGrepReferences(cwd) } : {}),
      baseSha: 'unknown',
      headSha: 'unknown',
    };
  }
  const range = parseRange(spec);
  if (!range) {
    throw new CliError(
      `--diff "${spec}" is neither a file nor a git range.`,
      'Pass a diff file, or a range such as main..HEAD or main...feature.',
    );
  }
  try {
    const git = new LocalGit(cwd);
    const d = git.diff(range);
    const attrs = git.show(d.headSha, '.gitattributes');
    return {
      text: d.text,
      contents: localContents(git, d.baseSha, d.headSha),
      ...(attrs && 'content' in attrs ? { attributes: parseGitattributes(attrs.content) } : {}),
      references: new GitGrepReferences(cwd, d.headSha),
      baseSha: d.baseSha,
      headSha: d.headSha,
    };
  } catch (e) {
    if (e instanceof GitError) throw new CliError(e.message, e.hint);
    throw e;
  }
}

/** Parses the diff and returns units with facts. */
export async function unitsFromInput(input: DiffInput): Promise<{ units: ChangeUnit[]; warnings: string[] }> {
  let parsed: ReturnType<typeof parseDiff>;
  try {
    parsed = parseDiff(input.text);
  } catch (e) {
    if (e instanceof DiffParseError)
      throw new CliError(
        `The diff could not be read: ${e.message}.`,
        'Generate it with `git diff` or pass a git range instead.',
      );
    throw e;
  }
  const built = await buildUnits(parsed, {
    ...(input.contents ? { contents: input.contents } : {}),
    ...(input.attributes ? { attributes: input.attributes } : {}),
  });
  const facts = await detectFacts(built.units, {
    ...(input.contents ? { contents: input.contents } : {}),
    ...(input.references ? { references: input.references } : {}),
  });
  return { units: facts.units, warnings: [...built.warnings, ...facts.warnings] };
}

const ranges = (r: [number, number][]) => r.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',');

/** Renders units as a plain table; filtered units are marked with words, not only color. */
export function renderUnitsTable(units: readonly ChangeUnit[], warnings: readonly string[]): string {
  const rows = units.map((u) => [
    u.id,
    u.kind,
    `${u.file}:${ranges(u.lines.new.length ? u.lines.new : u.lines.old) || '-'}`,
    u.symbol ? `${u.symbol.kind} ${u.symbol.name}` : '-',
    u.filtered ? `filtered (${u.filtered})` : '',
    u.facts.map((f) => `${f.id} ${f.kind} [${f.severity}]`).join('; '),
  ]);
  const header = ['id', 'kind', 'location', 'symbol', 'status', 'facts'];
  const widths = header.map((h, i) =>
    Math.min(60, Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))),
  );
  const fmt = (r: string[]) =>
    r
      .map((c, i) =>
        c.length > (widths[i] ?? 0) ? `${c.slice(0, (widths[i] ?? 1) - 1)}…` : c.padEnd(widths[i] ?? 0),
      )
      .join('  ')
      .trimEnd();
  const lines = [fmt(header), ...rows.map(fmt)];
  const factCount = units.reduce((n, u) => n + u.facts.length, 0);
  lines.push('', `${units.length} units, ${factCount} facts`);
  for (const w of warnings) lines.push(`warning: ${w}`);
  return `${lines.join('\n')}\n`;
}

export async function unitsCommand(argv: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { diff: { type: 'string' }, json: { type: 'boolean', default: false } },
    strict: true,
  });
  if (!values.diff)
    throw new CliError(
      'remit units needs --diff.',
      'Run `remit units --diff main..HEAD` or `remit units --diff changes.patch`.',
    );
  const result = await unitsFromInput(loadDiff(values.diff, io.cwd));
  io.out(
    values.json ? `${JSON.stringify(result, null, 2)}\n` : renderUnitsTable(result.units, result.warnings),
  );
  return 0;
}
