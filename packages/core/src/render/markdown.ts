/**
 * Markdown renderers (BUILD_PROMPT 6.10, Appendix E): the sticky PR comment (E.1), the rework request (E.2) and
 * the issue checklist (E.3). Copy style: sentence case headings, plain words, no em-dashes, numbers in monospace.
 */
import { BRAND } from '../brand.js';
import type {
  Finding,
  IssueRef,
  Requirement,
  RequirementVerdict,
  ReviewResult,
  UnitVerdict,
} from '../contracts/index.js';
import type { OpenQuestion } from '../extract/schema.js';
import { code, sanitize, sanitizeWithCode } from './sanitize.js';

export const STATUS_LABEL: Record<RequirementVerdict['status'], { icon: string; word: string }> = {
  done: { icon: '✅', word: 'done' },
  partial: { icon: '🟡', word: 'partial' },
  missing: { icon: '❌', word: 'missing' },
  contradicted: { icon: '⛔', word: 'contradicted' },
  interpretation_mismatch: { icon: '❓', word: 'interpretation mismatch' },
  uncertain: { icon: '❔', word: 'uncertain' },
  preexisting: { icon: '☑️', word: 'already there' },
  deferred: { icon: '⏭️', word: 'deferred' },
  not_checkable: { icon: '👀', word: 'manual check' },
};

const n2 = (x: number) => `\`${x.toFixed(2)}\``;
const num = (x: number) => `\`${x}\``;

/** "#12" for one issue in the PR's repo, "owner/repo#12" otherwise; several are joined with "and". */
export function issueLabel(issues: readonly IssueRef[], repo?: string): string {
  const one = (i: IssueRef) =>
    repo && `${i.owner}/${i.repo}` === repo
      ? `#${i.number}`
      : issues.length === 1 && !repo
        ? `#${i.number}`
        : `${i.owner}/${i.repo}#${i.number}`;
  if (!issues.length) return 'the linked issue';
  if (issues.length === 1) return one(issues[0] as IssueRef);
  return `${issues.slice(0, -1).map(one).join(', ')} and ${one(issues[issues.length - 1] as IssueRef)}`;
}

function lines(r: [number, number]): string {
  return r[0] === r[1] ? `L${r[0]}` : `L${r[0]}-${r[1]}`;
}

function evidenceCell(v: RequirementVerdict): string {
  const e = v.evidence[0];
  if (!e)
    return v.status === 'done' || v.status === 'partial' || v.status === 'contradicted'
      ? 'not linked'
      : 'none found';
  return `${code(e.file)} ${e.lines.map(lines).join(', ')}`;
}

function findingLine(f: Finding, r: ReviewResult): string {
  const loc = f.locations[0];
  const where = loc && loc.lines[0] > 0 ? `${code(loc.file)} ${lines(loc.lines)}: ` : '';
  const text = f.reasons.map((x) => sanitizeWithCode(x.text, 400)).join(' ');
  const req = r.requirements.find((q) => q.id === f.targetId);
  return `- **${f.id}** ${where}${req && f.type === 'requirement' ? `${req.id}: ${text}` : text}`;
}

function summaryLine(r: ReviewResult): string {
  const counts = r.summary.counts;
  const statuses = r.requirementVerdicts.length;
  const parts = Object.keys(STATUS_LABEL)
    .filter((s) => counts[s])
    .map((s) => `${num(counts[s] as number)} ${STATUS_LABEL[s as RequirementVerdict['status']].word}`);
  const bits = [
    `${num(statuses)} requirement${statuses === 1 ? '' : 's'}${parts.length ? `: ${parts.join(', ')}` : ''}`,
  ];
  const unexplained = r.findings.filter((f) => f.type === 'unit' && f.priority !== 'P2').length;
  if (unexplained) bits.push(`${num(unexplained)} unexplained change${unexplained === 1 ? '' : 's'}`);
  const integrity = r.findings.filter((f) => f.type === 'test_integrity').length;
  if (integrity) bits.push(`${num(integrity)} test integrity flag${integrity === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

function modeLine(r: ReviewResult): string {
  if (r.summary.mode === 'rework')
    return 'Rework mode: problems that need rework get a separate rework request. Nothing here blocks the merge.';
  if (r.summary.mode === 'gate') {
    if (r.summary.gateDecision === 'fail')
      return 'Gate mode: this check fails because of a confident P0 finding.';
    if (r.summary.gateDecision === 'pass') return 'Gate mode: no confident P0 finding, so this check passes.';
    return 'Gate mode is configured but refused: there is not enough calibration evidence yet, so nothing here blocks the merge.';
  }
  return 'Comment only. Nothing here blocks the merge.';
}

function details(title: string, items: string[]): string[] {
  return items.length
    ? [`<details><summary>${title} (${items.length})</summary>`, '', ...items, '</details>', '']
    : [];
}

export interface CommentOptions {
  reviewId: string;
}

/** The sticky PR comment (Appendix E.1). One per PR, found again by its hidden marker. */
export function renderComment(r: ReviewResult, opts: CommentOptions): string {
  const marker = `<!-- ${BRAND.commentMarker} v1 review=${opts.reviewId} head=${r.input.headSha.slice(0, 7)} -->`;
  const label = issueLabel(r.input.issues, r.input.repo);
  if (!r.requirements.length && !r.input.issues.length) {
    return [
      `### ${BRAND.name}: no linked issue`,
      '',
      ...r.warnings.map((w) => sanitize(w, 600)),
      '',
      marker,
      '',
    ].join('\n');
  }
  const out: string[] = [
    `### ${BRAND.name}: does this PR do what ${label} asked?`,
    '',
    summaryLine(r),
    modeLine(r),
    '',
  ];

  const verdicts = new Map(r.requirementVerdicts.map((v) => [v.requirementId, v]));
  const shown = r.requirements.filter((q) => !q.supersededBy && verdicts.has(q.id));
  if (shown.length) {
    out.push(
      `| | Requirement (quoted from ${label}) | Status | Confidence | Evidence |`,
      '|---|---|---|---|---|',
    );
    for (const q of shown) {
      const v = verdicts.get(q.id) as RequirementVerdict;
      const s = STATUS_LABEL[v.status];
      out.push(
        `| ${q.id} | "${sanitize(q.quote)}" | ${s.icon} ${s.word} | ${n2(v.confidence)} | ${evidenceCell(v)} |`,
      );
    }
    out.push('');
  } else if (!r.requirements.length) {
    out.push(`No checkable requirement was found in ${label}.`, '');
  }

  const byRoute = (route: Finding['route'], priority?: Finding['priority']) =>
    r.findings.filter(
      (f) =>
        f.route === route &&
        (!priority || f.priority === priority) &&
        f.type !== 'unit' &&
        f.type !== 'test_integrity' &&
        f.type !== 'fact',
    );
  const sendBack = byRoute('send_back');
  if (sendBack.length) out.push('**Needs rework**', ...sendBack.map((f) => findingLine(f, r)), '');
  const askAuthor = r.findings.filter((f) => f.route === 'ask_author' && f.priority !== 'P2');
  if (askAuthor.length) out.push('**Needs the author**', ...askAuthor.map((f) => findingLine(f, r)), '');
  const attention = byRoute('reviewer_attention', 'P1');
  if (attention.length) out.push('**Worth a look**', ...attention.map((f) => findingLine(f, r)), '');

  out.push(
    ...details(
      'Unexplained changes',
      r.findings.filter((f) => f.type === 'unit' && f.priority !== 'P2').map((f) => findingLine(f, r)),
    ),
  );
  out.push(
    ...details(
      'Test integrity',
      r.findings.filter((f) => f.type === 'test_integrity').map((f) => findingLine(f, r)),
    ),
  );
  const notes = r.findings.filter(
    (f) =>
      f.priority === 'P2' &&
      (f.type === 'unit' ||
        f.type === 'fact' ||
        f.type === 'ambiguity' ||
        f.route === 'reviewer_attention' ||
        f.route === 'none'),
  );
  out.push(
    ...details(
      'Notes',
      notes.map((f) => findingLine(f, r)),
    ),
  );
  const ignored = r.unitVerdicts.filter((u: UnitVerdict) => u.role === 'ignored');
  if (ignored.length) {
    const files = ignored
      .map((u) => r.units.find((x) => x.id === u.unitId))
      .filter(Boolean)
      .map((u) => `- ${code(u?.file ?? '')} (${u?.filtered?.replace('_', ' ') ?? 'ignored'})`);
    out.push(...details('Ignored files', files));
  }
  if (r.warnings.length)
    out.push(
      ...details(
        'Warnings',
        r.warnings.map((w) => `- ${sanitize(w, 400)}`),
      ),
    );

  const calibrated = r.requirementVerdicts.some((v) => v.calibrated);
  out.push(
    '<details><summary>How this was checked</summary>',
    '',
    `Requirements were extracted from ${label} without looking at this PR. Each verdict combines typed model decisions (${code(r.versions.jevModel)}) using fixed rules. Confidences are ${calibrated ? 'calibrated' : 'raw (not calibrated yet)'}. ${BRAND.name} checks intent, not bugs, style or security. Cost ${code(`$${r.usage.costUsd.toFixed(2)}`)}, time ${code(`${Math.round(r.usage.latencyMs / 1000)} s`)}.`,
    '</details>',
    '',
  );
  const example = r.findings.find((f) => f.priority === 'P0') ?? r.findings[0];
  const other = r.findings.find((f) => f !== example);
  if (example) {
    out.push(
      `Help ${BRAND.name} learn: reply ${code(`${BRAND.slashCommand} agree ${example.id}`)}${other ? ` or ${code(`${BRAND.slashCommand} disagree ${other.id} <why>`)}` : ''}.`,
    );
  }
  out.push(marker, '');
  return out.join('\n');
}

export interface ReworkOptions {
  /** Optional handle that wakes a coding-agent integration (config `rework.mention`); empty means none. */
  mention?: string;
}

/** The rework request for the coding agent (Appendix E.2): P0 items only, plus a machine-readable block. */
export function renderRework(r: ReviewResult, opts: ReworkOptions = {}): string | null {
  const items = r.findings.filter((f) => f.priority === 'P0');
  if (!items.length) return null;
  const label = issueLabel(r.input.issues, r.input.repo);
  const lines: string[] = [`### ${BRAND.name} rework request`, ''];
  const who = opts.mention?.trim() ? `${opts.mention.trim()} ` : '';
  lines.push(
    `${who}This PR does not yet do everything ${label} asked. Please address these items. Keep existing tests strict and leave unrelated files alone.`,
    '',
  );
  const json: Record<string, unknown>[] = [];
  items.forEach((f, i) => {
    const req = r.requirements.find((q) => q.id === f.targetId);
    const v = r.requirementVerdicts.find((x) => x.requirementId === f.targetId);
    if (req && v) {
      const what =
        v.status === 'missing'
          ? 'no implementation found'
          : v.status === 'contradicted'
            ? 'the change does something different from what the issue states'
            : v.status.replace('_', ' ');
      lines.push(`${i + 1}. **${req.id}** "${sanitize(req.quote)}" (quoted from ${label}): ${what}.`);
      json.push({ id: f.id, requirement: req.id, status: v.status, quote: req.quote.slice(0, 200) });
    } else {
      const loc = f.locations[0];
      lines.push(
        `${i + 1}. **${f.id}** ${loc ? `${code(loc.file)} ${loc.lines[0] === loc.lines[1] ? `L${loc.lines[0]}` : `L${loc.lines[0]}-${loc.lines[1]}`}: ` : ''}${f.reasons.map((x) => sanitizeWithCode(x.text, 300)).join(' ')}`,
      );
      json.push({ id: f.id, type: f.type, ...(loc ? { file: loc.file, lines: loc.lines } : {}) });
    }
  });
  const issue =
    r.input.issues.length === 1
      ? (r.input.issues[0] as IssueRef).number
      : r.input.issues.map((i) => `${i.owner}/${i.repo}#${i.number}`);
  lines.push(
    '',
    '```json',
    JSON.stringify({ [BRAND.slug]: 'rework', version: 1, issue, items: json }),
    '```',
    '',
  );
  return lines.join('\n');
}

/** The issue-time checklist (Appendix E.3). */
export function renderChecklist(
  requirements: readonly Requirement[],
  openQuestions: readonly OpenQuestion[],
): string {
  const active = requirements.filter((q) => !q.supersededBy);
  const out = [
    `### ${BRAND.name} read this issue as ${num(active.length)} requirement${active.length === 1 ? '' : 's'}`,
    '',
  ];
  for (const q of active)
    out.push(`- [ ] **${q.id}** "${sanitize(q.quote)}"${q.kind === 'non_goal' ? ' (non-goal)' : ''}`);
  if (!active.length) out.push('No checkable requirement was found.');
  for (const q of openQuestions) {
    const readings =
      q.readings.length === 2
        ? ` could mean ${sanitize(q.readings[0] as string, 120)} or ${sanitize(q.readings[1] as string, 120)}. Which one?`
        : '';
    out.push(
      '',
      `**Open question:** ${q.requirementId && readings ? `${q.requirementId}${readings}` : sanitize(q.question, 300)}`,
    );
  }
  out.push(
    '',
    `If this is right, reply ${code(`${BRAND.slashCommand} confirm`)}. If not, edit the issue and ${BRAND.name} will read it again. Reviews of PRs for this issue will use the confirmed list.`,
    '',
  );
  return out.join('\n');
}
