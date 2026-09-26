#!/usr/bin/env node
// Build progress reader (BUILD_PROMPT Appendix A.4).
//   node scripts/progress.mjs            one line per milestone, then "current: M<N>"
//   node scripts/progress.mjs --json     the same as JSON
//   node scripts/progress.mjs --check    exit 0 only when M0..M10 are all terminal
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED-HUMAN'];
export const REQUIRED = Array.from({ length: 11 }, (_, i) => i); // M0..M10

export class ProgressError extends Error {}

/** Parses PROGRESS.md text into milestones. Throws ProgressError on malformed input. */
export function parseProgress(text) {
  const milestones = [];
  let current = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const heading = /^##\s+M(\d+)\b\s*(.*)$/.exec(line);
    if (heading) {
      const number = Number(heading[1]);
      if (milestones.some((m) => m.number === number)) {
        throw new ProgressError(`Milestone M${number} appears twice (line ${index + 1}).`);
      }
      current = { number, title: heading[2].trim(), status: null, items: [] };
      milestones.push(current);
      return;
    }
    if (!current) return;
    const status = /^Status:\s*(\S+)\s*$/.exec(line);
    if (status) {
      if (!STATUSES.includes(status[1])) {
        throw new ProgressError(
          `M${current.number} has unknown status "${status[1]}" (line ${index + 1}). Use one of ${STATUSES.join(', ')}.`,
        );
      }
      current.status = status[1];
      return;
    }
    const item = /^- \[( |x|X)\]\s+(.*)$/.exec(line);
    if (item) current.items.push({ checked: item[1] !== ' ', text: item[2] });
  });
  if (milestones.length === 0) {
    throw new ProgressError('No milestone sections found. Expected headings like "## M0 Bootstrap".');
  }
  for (const m of milestones) {
    if (!m.status) throw new ProgressError(`M${m.number} has no "Status:" line.`);
  }
  return milestones;
}

/** Summarizes milestones: counts, and the first milestone that is not DONE or BLOCKED-HUMAN. */
export function summarize(milestones) {
  const rows = milestones.map((m) => ({
    milestone: `M${m.number}`,
    status: m.status,
    checked: m.items.filter((i) => i.checked).length,
    total: m.items.length,
  }));
  const open = [...milestones]
    .sort((a, b) => a.number - b.number)
    .find((m) => m.status !== 'DONE' && m.status !== 'BLOCKED-HUMAN');
  return { milestones: rows, current: open ? `M${open.number}` : null };
}

/** True when a BLOCKERS.md line is an open item mentioning M<n> with an unblock step. */
export function hasOpenBlocker(blockersText, number) {
  const mention = new RegExp(`\\bM${number}\\b`);
  return blockersText
    .split(/\r?\n/)
    .some((line) => /^- \[ \]/.test(line) && mention.test(line) && line.includes('unblock:'));
}

/** Returns the reasons the required milestones are not all terminal (empty when done). */
export function checkTerminal(milestones, { tags, blockersText }) {
  const reasons = [];
  for (const number of REQUIRED) {
    const m = milestones.find((x) => x.number === number);
    if (!m) {
      reasons.push(`M${number}: missing from PROGRESS.md`);
      continue;
    }
    if (m.status === 'DONE') {
      if (m.items.length === 0) reasons.push(`M${number}: DONE but has no items`);
      const unchecked = m.items.filter((i) => !i.checked).length;
      if (unchecked > 0) reasons.push(`M${number}: DONE but ${unchecked} item(s) unchecked`);
      const noEvidence = m.items.filter((i) => i.checked && !i.text.includes('(evidence:')).length;
      if (noEvidence > 0) reasons.push(`M${number}: ${noEvidence} checked item(s) lack "(evidence:"`);
      if (!tags.includes(`m${number}-done`))
        reasons.push(`M${number}: DONE but git tag m${number}-done is missing`);
    } else if (m.status === 'BLOCKED-HUMAN') {
      if (!hasOpenBlocker(blockersText, number)) {
        reasons.push(
          `M${number}: BLOCKED-HUMAN but BLOCKERS.md has no open item mentioning M${number} with "unblock:"`,
        );
      }
    } else {
      reasons.push(`M${number}: status is ${m.status}`);
    }
  }
  return reasons;
}

function readTags(root) {
  try {
    return execFileSync('git', ['tag', '--list', 'm*-done'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** CLI entry. Returns the exit code; writes to the given streams. */
export function main(argv, { root = process.cwd(), out = process.stdout, err = process.stderr } = {}) {
  const flags = new Set(argv);
  const progressPath = join(root, '.agent', 'PROGRESS.md');
  if (!existsSync(progressPath)) {
    err.write(`progress: ${progressPath} not found. Create it in M0 (BUILD_PROMPT 3.1).\n`);
    return 1;
  }
  let milestones;
  try {
    milestones = parseProgress(readFileSync(progressPath, 'utf8'));
  } catch (e) {
    err.write(`progress: .agent/PROGRESS.md is malformed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  if (flags.has('--check')) {
    const blockersPath = join(root, '.agent', 'BLOCKERS.md');
    const blockersText = existsSync(blockersPath) ? readFileSync(blockersPath, 'utf8') : '';
    const reasons = checkTerminal(milestones, { tags: readTags(root), blockersText });
    if (reasons.length === 0) {
      out.write('ALL REQUIRED MILESTONES TERMINAL\n');
      return 0;
    }
    for (const r of reasons) out.write(`${r}\n`);
    return 1;
  }
  const summary = summarize(milestones);
  if (flags.has('--json')) {
    out.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }
  for (const row of summary.milestones)
    out.write(`${row.milestone} ${row.status} ${row.checked}/${row.total}\n`);
  out.write(`current: ${summary.current ?? 'none'}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`progress: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
