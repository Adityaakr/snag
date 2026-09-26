/**
 * Terminal output (BUILD_PROMPT 6.10, Appendix E.4): a table that uses words and icons as well as color, so
 * color is never the only signal.
 */
import { BRAND } from '../brand.js';
import type { Finding, ReviewResult } from '../contracts/index.js';
import { issueLabel, STATUS_LABEL } from './markdown.js';
import { plain } from './sanitize.js';

const ANSI = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

const ROUTE_WORD: Record<Finding['route'], string> = {
  send_back: 'send back',
  ask_author: 'ask author',
  reviewer_attention: 'reviewer',
  none: 'info',
};

export function renderTerminal(r: ReviewResult, opts: { color?: boolean } = {}): string {
  const c = (color: keyof typeof ANSI, s: string) => (opts.color ? `${ANSI[color]}${s}${ANSI.reset}` : s);
  const pr = r.input.pr
    ? `PR #${r.input.pr}`
    : `${r.input.baseSha.slice(0, 7)}..${r.input.headSha.slice(0, 7)}`;
  const mode = r.summary.mode.replace('_', '-');
  const head = `${BRAND.name}  ${pr} -> ${issueLabel(r.input.issues, r.input.repo)}   ${mode}   cost $${r.usage.costUsd.toFixed(2)}   ${Math.round(r.usage.latencyMs / 1000)} s`;
  const out = [c('bold', head)];
  const findingFor = (target: string) =>
    r.findings.find((f) => f.targetId === target && f.type === 'requirement');
  for (const v of r.requirementVerdicts) {
    const s = STATUS_LABEL[v.status];
    const problem = ['missing', 'contradicted', 'partial', 'interpretation_mismatch'].includes(v.status);
    const word = problem ? s.word.toUpperCase() : s.word;
    const ev = v.evidence[0];
    const where = ev
      ? `${ev.file}:${ev.lines.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',')}`
      : '(none)';
    const f = findingFor(v.requirementId);
    const tail = f
      ? `  ${f.priority} ${ROUTE_WORD[f.route]}${v.claimMismatch ? '  claim mismatch' : ''}`
      : '';
    const line = `  ${v.requirementId.padEnd(6)}${s.icon} ${word.padEnd(24)}${v.confidence.toFixed(2)}  ${plain(where, 60).padEnd(34)}${tail}`;
    out.push(
      problem
        ? c(v.status === 'partial' ? 'yellow' : 'red', line)
        : v.status === 'done'
          ? c('green', line)
          : line,
    );
  }
  for (const f of r.findings.filter((x) => x.type !== 'requirement' && x.type !== 'ambiguity')) {
    const loc = f.locations[0];
    const where = loc && loc.lines[0] > 0 ? `${loc.file}:${loc.lines[0]}` : (loc?.file ?? '');
    const label =
      f.type === 'test_integrity'
        ? 'TEST LOOSENED'
        : f.type === 'unit'
          ? f.priority === 'P1'
            ? 'UNEXPLAINED behavioral'
            : 'unexplained'
          : 'fact';
    const line = `  ${f.id.replace(/^F-/, '').padEnd(6)}${label.padEnd(26)}${plain(where, 60).padEnd(34)}${f.priority} ${ROUTE_WORD[f.route]}`;
    out.push(f.priority === 'P2' ? c('dim', line) : c('yellow', line));
  }
  for (const f of r.findings.filter((x) => x.type === 'ambiguity'))
    out.push(c('dim', `  ${f.targetId.padEnd(6)}ambiguous  ${plain(f.reasons[0]?.text ?? '', 120)}`));
  for (const w of r.warnings) out.push(c('dim', `  warning: ${plain(w, 300)}`));
  return `${out.join('\n')}\n`;
}
