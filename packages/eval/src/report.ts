/**
 * Eval reports (BUILD_PROMPT 11.9): report.md and report.html with metrics tables, confusion matrices,
 * reliability diagrams as inline SVG, cost and latency, versions and git SHA, and the 10 worst items with links
 * to their dumps. The HTML uses Satoshi from Fontshare with a system fallback stack.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND, EXTRACTION_PROMPT_VERSION, QUESTION_SET_VERSION } from '@remit/core';
import type { BaselineMetrics } from './baselines.js';
import type { Bin } from './calibration.js';
import type { Metrics } from './metrics.js';
import type { ItemOutcome, ProviderMode } from './runner.js';

export interface RunInfo {
  corpus: string;
  split: string;
  mode: ProviderMode;
  gitSha: string;
  startedAt: string;
  jevModel: string;
  stoppedForBudget?: boolean;
  baselines?: Record<string, { note: string; variants?: BaselineMetrics[] }>;
}

const f2 = (x: number) => x.toFixed(2);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function isRealMeasurement(mode: ProviderMode): boolean {
  return mode === 'live';
}

function failuresOf(o: ItemOutcome): string[] {
  const c = o.comparison;
  if (c.goldenFailures) return c.goldenFailures;
  return [
    ...c.requirements
      .filter((r) => r.actual !== r.expected)
      .map((r) => `${r.id} ${r.actual ?? 'none'} (expected ${r.expected})`),
    ...c.units
      .filter((u) => u.actual !== u.expected)
      .map(
        (u) => `${u.file}${u.symbol ? `#${u.symbol}` : ''} ${u.actual ?? 'none'} (expected ${u.expected})`,
      ),
    ...c.facts.filter((x) => !x.found).map((x) => `missing fact ${x.kind}`),
    ...c.testIntegrity.filter((x) => !x.found).map((x) => `missing test integrity on ${x.file}`),
  ];
}

export function worstItems(
  outcomes: readonly ItemOutcome[],
  n = 10,
): { outcome: ItemOutcome; failures: string[] }[] {
  return outcomes
    .map((o) => ({ outcome: o, failures: failuresOf(o) }))
    .filter((x) => x.failures.length)
    .sort(
      (a, b) => b.failures.length - a.failures.length || a.outcome.item.id.localeCompare(b.outcome.item.id),
    )
    .slice(0, n);
}

const dumpName = (id: string) => `${id.replace(/[^\w.-]+/g, '_')}.json`;

interface TargetRow {
  name: string;
  goal: string;
  actual: string;
  met: string;
}

/** The 11.8 targets that apply to this run, each reported honestly whether met or not. */
export function targetRows(info: RunInfo, m: Metrics): TargetRow[] {
  const rows: TargetRow[] = [];
  const add = (name: string, goal: string, value: number | null, ok: (v: number) => boolean, fmt = f2) =>
    rows.push({
      name,
      goal,
      actual: value === null ? 'n/a' : `\`${fmt(value)}\``,
      met: value === null ? 'n/a' : ok(value) ? 'yes' : 'no',
    });
  if (info.corpus === 'golden')
    add('Golden accuracy', '`100%`', m.items ? m.passed / m.items : null, (v) => v === 1, pct);
  const op = (k: string) => m.operators[k]?.recall ?? null;
  if (Object.keys(m.operators).length) {
    add('Recall: drop_requirement', '`>= 0.85`', op('drop_requirement'), (v) => v >= 0.85);
    add('Recall: flip_condition', '`>= 0.60`', op('flip_condition'), (v) => v >= 0.6);
    add('Recall: weaken_assertion', '`>= 0.90`', op('weaken_assertion'), (v) => v >= 0.9);
    add('Recall: inject_config', '`>= 0.70`', op('inject_config'), (v) => v >= 0.7);
    add('False alarms on clean seeds', '`<= 0.15`', m.pr.cleanSeedFalseAlarmRate, (v) => v <= 0.15);
  }
  if (info.corpus !== 'golden')
    add('P0 precision', '`>= 0.80`', m.p0Precision.p0 ? m.p0Precision.value : null, (v) => v >= 0.8);
  // 11.8 targets ECE after calibration: the out-of-sample (5-fold isotonic) estimate, never the raw ECE.
  for (const [k, c] of Object.entries(m.calibration))
    if (c.n >= 100) add(`ECE after calibration (5-fold) ${k}`, '`<= 0.10`', c.eceCalibrated, (v) => v <= 0.1);
  if (info.mode === 'live') {
    add(
      'Latency p50',
      '`<= 30 s`',
      m.ops.latencyP50 / 1000,
      (v) => v <= 30,
      (v) => `${v.toFixed(1)} s`,
    );
    add(
      'Cost p50',
      '`<= $0.10`',
      m.ops.costP50,
      (v) => v <= 0.1,
      (v) => `$${v.toFixed(4)}`,
    );
  }
  return rows;
}

export function renderReportMarkdown(info: RunInfo, m: Metrics, outcomes: readonly ItemOutcome[]): string {
  const real = isRealMeasurement(info.mode);
  const lines = [`# ${BRAND.name} eval: ${info.corpus} (${info.split})`, ''];
  if (!real)
    lines.push(
      `> Not a real measurement. Answers came from ${info.mode === 'scripted' ? 'recorded scripts' : 'the simulated Jev stand-in (no keys)'}, so these numbers check the plumbing, not model quality.`,
      '',
    );
  if (info.stoppedForBudget)
    lines.push('> The run stopped at the eval budget (EVAL_MAX_USD); results are partial.', '');
  lines.push(
    `Run \`${info.startedAt}\`, git \`${info.gitSha.slice(0, 12)}\`, provider mode \`${info.mode}\`, Jev \`${info.jevModel}\`, questions \`${QUESTION_SET_VERSION}\`, extraction \`${EXTRACTION_PROMPT_VERSION}\`.`,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|---|---|',
    `| Items | \`${m.items}\` (\`${m.passed}\` fully correct, \`${pct(m.items ? m.passed / m.items : 0)}\`) |`,
    `| Requirement problems: precision / recall / F1 | \`${f2(m.requirement.precision)}\` / \`${f2(m.requirement.recall)}\` / \`${f2(m.requirement.f1)}\` |`,
    `| Abstention rate (uncertain) | \`${pct(m.requirement.abstentionRate)}\` of \`${m.requirement.labeled}\` labeled requirements |`,
    `| Unexplained behavioral units: precision / recall | \`${f2(m.unitBehavioral.precision)}\` / \`${f2(m.unitBehavioral.recall)}\` |`,
    `| Test integrity: precision / recall | \`${f2(m.testIntegrity.precision)}\` / \`${f2(m.testIntegrity.recall)}\` |`,
    `| PR level (any P0 vs problem): precision / recall | \`${f2(m.pr.precision)}\` / \`${f2(m.pr.recall)}\` |`,
    `| False alarms (P0 or P1 per clean PR) | \`${f2(m.pr.falseAlarmRate)}\` over \`${m.pr.cleanItems}\` clean items |`,
    `| P0 precision | \`${f2(m.p0Precision.value)}\` (\`${m.p0Precision.correct}\` of \`${m.p0Precision.p0}\`) |`,
    `| AUROC, problem vs clean (strongest P0/P1 finding) | ${m.pr.auroc === null ? 'n/a (needs both classes)' : `\`${f2(m.pr.auroc)}\``} |`,
    `| Latency p50 / p95 | \`${m.ops.latencyP50} ms\` / \`${m.ops.latencyP95} ms\` |`,
    `| Cost total / p50 per review | \`$${m.ops.costTotal.toFixed(4)}\` / \`$${m.ops.costP50.toFixed(4)}\` |`,
    `| Tokens: Jev in / LLM in / LLM out | \`${m.ops.jevInputTokens}\` / \`${m.ops.llmInputTokens}\` / \`${m.ops.llmOutputTokens}\` |`,
    `| Truncation rate | \`${pct(m.ops.truncationRate)}\` |`,
    '',
  );
  const targets = targetRows(info, m);
  if (targets.length) {
    lines.push('## Targets (11.8)', '', '| Target | Goal | Actual | Met |', '|---|---|---|---|');
    for (const t of targets) lines.push(`| ${t.name} | ${t.goal} | ${t.actual} | ${t.met} |`);
    lines.push('');
  }
  if (Object.keys(m.operators).length) {
    lines.push(
      '## Mutation operators',
      '',
      '| Operator | Items | Detected (recall) | Every label correct |',
      '|---|---|---|---|',
    );
    for (const [op, v] of Object.entries(m.operators).sort())
      lines.push(`| ${op} | \`${v.items}\` | \`${f2(v.recall)}\` | \`${v.passed}\` |`);
    lines.push('');
  }
  if (m.feedback.agree + m.feedback.disagree + m.feedback.weakAgree + m.feedback.weakDisagree) {
    lines.push(
      '## Human feedback',
      '',
      `Strong labels: \`${m.feedback.agree}\` agree, \`${m.feedback.disagree}\` disagree (agreement ${m.feedback.agreement === null ? 'n/a' : `\`${f2(m.feedback.agreement)}\``}). Weak labels, kept apart: \`${m.feedback.weakAgree}\` agree, \`${m.feedback.weakDisagree}\` disagree.`,
      '',
    );
  }
  if (m.stability) {
    const st = m.stability;
    lines.push(
      '## Extraction stability',
      '',
      st.meanJaccard === null
        ? `Not measured: \`${st.sampled}\` sampled issues, \`${st.skipped}\` could not be extracted.`
        : `Mean Jaccard over quotes \`${f2(st.meanJaccard)}\` on \`${st.measured}\` of \`${st.sampled}\` sampled issues${st.deterministic ? ' (task-list extraction, deterministic by construction)' : ''}.`,
      '',
    );
  }
  if (Object.keys(m.slices).length) {
    lines.push(
      '## Label slices',
      '',
      '| Source and strength | Items | Labeled problem | Flagged (P0) |',
      '|---|---|---|---|',
    );
    for (const [k, v] of Object.entries(m.slices).sort())
      lines.push(`| ${k} | \`${v.items}\` | \`${v.problem}\` | \`${v.flagged}\` |`);
    lines.push('');
  }
  const statuses = [
    ...new Set([
      ...Object.keys(m.requirement.confusion),
      ...Object.values(m.requirement.confusion).flatMap((r) => Object.keys(r)),
    ]),
  ].sort();
  if (statuses.length) {
    lines.push(
      '## Requirement confusion matrix',
      '',
      'Rows are labels, columns are verdicts.',
      '',
      `| label \\ verdict | ${statuses.join(' | ')} |`,
      `|---|${statuses.map(() => '---').join('|')}|`,
    );
    for (const row of Object.keys(m.requirement.confusion).sort())
      lines.push(
        `| ${row} | ${statuses.map((c) => `\`${m.requirement.confusion[row]?.[c] ?? 0}\``).join(' | ')} |`,
      );
    lines.push('');
  }
  if (Object.keys(m.calibration).length) {
    lines.push(
      '## Calibration',
      '',
      '| Question key | Samples | ECE raw | ECE after isotonic (5-fold) | Brier raw |',
      '|---|---|---|---|---|',
    );
    for (const [k, v] of Object.entries(m.calibration).sort())
      lines.push(
        `| ${k} | \`${v.n}\` | \`${f2(v.ece)}\` | ${v.eceCalibrated === null ? 'n/a (under 50)' : `\`${f2(v.eceCalibrated)}\``} | \`${f2(v.brier)}\` |`,
      );
    lines.push('');
  }
  if (info.baselines && Object.keys(info.baselines).length) {
    lines.push(
      '## Baselines',
      '',
      'Comparisons on the same items, not gates (11.6).',
      '',
      '| Baseline | Requirement F1 | PR precision / recall | False alarms | Errors | Note |',
      '|---|---|---|---|---|---|',
    );
    for (const [name, b] of Object.entries(info.baselines)) {
      if (!b.variants?.length) lines.push(`| ${name} | n/a | n/a | n/a | n/a | ${b.note} |`);
      for (const v of b.variants ?? [])
        lines.push(
          `| ${name} (${v.variant}) | ${v.requirement ? `\`${f2(v.requirement.f1)}\`` : 'n/a'} | \`${f2(v.pr.precision)}\` / \`${f2(v.pr.recall)}\` | \`${f2(v.pr.falseAlarmRate)}\` | \`${v.errors}\` of \`${v.items}\` | ${b.note} |`,
        );
    }
    lines.push('');
  }
  const worst = worstItems(outcomes);
  lines.push('## Worst items', '');
  if (!worst.length) lines.push('Every item matched its labels.');
  for (const w of worst)
    lines.push(
      `- [${w.outcome.item.id}](items/${dumpName(w.outcome.item.id)}): ${w.failures.slice(0, 4).join('; ')}`,
    );
  lines.push('');
  return lines.join('\n');
}

function reliabilitySvg(key: string, b: Bin[]): string {
  const size = 160;
  const pad = 20;
  const inner = size - 2 * pad;
  const bars = b
    .filter((x) => x.n)
    .map((x) => {
      const h = x.accuracy * inner;
      return `<rect x="${pad + x.lo * inner + 1}" y="${pad + inner - h}" width="${inner / 10 - 2}" height="${h}" fill="var(--accent)"><title>${f2(x.lo)} to ${f2(x.hi)}: accuracy ${f2(x.accuracy)}, n ${x.n}</title></rect>`;
    })
    .join('');
  return `<figure><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Reliability diagram for ${key}"><rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" fill="none" stroke="var(--line)"/><line x1="${pad}" y1="${pad + inner}" x2="${pad + inner}" y2="${pad}" stroke="var(--muted)" stroke-dasharray="3 3"/>${bars}</svg><figcaption>${key}</figcaption></figure>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Minimal markdown table and paragraph rendering for the HTML report. */
function mdToHtml(md: string): string {
  const out: string[] = [];
  const blocks = md.split('\n\n');
  for (const block of blocks) {
    const lines = block.split('\n');
    const inline = (s: string) =>
      esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    if (lines[0]?.startsWith('# ')) out.push(`<h1>${inline(lines[0].slice(2))}</h1>`);
    else if (lines[0]?.startsWith('## ')) out.push(`<h2>${inline(lines[0].slice(3))}</h2>`);
    else if (lines[0]?.startsWith('> '))
      out.push(`<p class="banner">${inline(lines.map((l) => l.replace(/^> /, '')).join(' '))}</p>`);
    else if (lines[0]?.startsWith('|')) {
      const rows = lines
        .filter((l) => !/^\|[-| ]+\|$/.test(l))
        .map((l) =>
          l
            .slice(1, -1)
            .split(' | ')
            .map((c) => inline(c.trim())),
        );
      const [head, ...body] = rows;
      out.push(
        `<table><thead><tr>${(head ?? []).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
    } else if (lines[0]?.startsWith('- '))
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`);
    else if (block.trim()) out.push(`<p>${inline(block)}</p>`);
  }
  return out.join('\n');
}

export function renderReportHtml(info: RunInfo, m: Metrics, outcomes: readonly ItemOutcome[]): string {
  const md = renderReportMarkdown(info, m, outcomes);
  const diagrams = Object.entries(m.calibration)
    .sort()
    .map(([k, v]) => reliabilitySvg(k, v.bins))
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${BRAND.name} eval: ${esc(info.corpus)} ${esc(info.split)}</title>
<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap">
<style>
:root { --bg: #fbfaf7; --fg: #1d1d1b; --muted: #6b6b66; --line: #d9d6ce; --accent: #2f6f5e; --warn: #9a5b00; }
@media (prefers-color-scheme: dark) { :root { --bg: #151514; --fg: #ecebe6; --muted: #a3a29c; --line: #3a3935; --accent: #6fbfa6; --warn: #e0a54c; } }
body { margin: 0 auto; max-width: 980px; padding: 32px 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 Satoshi, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
h1 { font-size: 26px; font-weight: 700; } h2 { font-size: 19px; font-weight: 600; margin-top: 32px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 14px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.banner { border-left: 4px solid var(--warn); padding: 8px 12px; background: color-mix(in srgb, var(--warn) 10%, transparent); }
.diagrams { display: flex; flex-wrap: wrap; gap: 16px; } figure { margin: 0; } figcaption { font-size: 12px; color: var(--muted); text-align: center; }
a { color: var(--accent); }
</style>
</head>
<body>
${mdToHtml(md)}
${diagrams ? `<h2>Reliability diagrams</h2><p>Bars show observed accuracy per probability bin; the dashed line is perfect calibration.</p><div class="diagrams">${diagrams}</div>` : ''}
</body>
</html>
`;
}

/** Writes report.md, report.html, a metrics.json and item dumps; returns the directory. */
export function writeReport(
  root: string,
  info: RunInfo,
  m: Metrics,
  outcomes: readonly ItemOutcome[],
): string {
  const dir = join(root, info.startedAt.replace(/[:.]/g, '-'));
  mkdirSync(join(dir, 'items'), { recursive: true });
  writeFileSync(join(dir, 'report.md'), renderReportMarkdown(info, m, outcomes));
  writeFileSync(join(dir, 'report.html'), renderReportHtml(info, m, outcomes));
  writeFileSync(
    join(dir, 'metrics.json'),
    `${JSON.stringify({ info, metrics: m, realMeasurement: isRealMeasurement(info.mode) }, null, 2)}\n`,
  );
  const dumps = new Set(worstItems(outcomes, outcomes.length).map((w) => w.outcome.item.id));
  for (const o of outcomes) {
    if (!dumps.has(o.item.id) && outcomes.length > 50) continue;
    writeFileSync(
      join(dir, 'items', dumpName(o.item.id)),
      `${JSON.stringify({ id: o.item.id, labels: o.item.labels, comparison: o.comparison, result: o.result }, null, 2)}\n`,
    );
  }
  return dir;
}

/** The one-line summary appended to .agent/EXPERIMENTS.md after each run. */
export function summaryLine(info: RunInfo, m: Metrics, dir: string): string {
  const tag = isRealMeasurement(info.mode) ? '' : ' (not a real measurement)';
  return `- ${info.startedAt} ${info.corpus}/${info.split} ${info.mode}${tag}: ${m.passed}/${m.items} items correct, requirement F1 ${f2(m.requirement.f1)}, PR recall ${f2(m.pr.recall)}, false alarms ${f2(m.pr.falseAlarmRate)}, P0 precision ${f2(m.p0Precision.value)}, cost $${m.ops.costTotal.toFixed(4)}. Report: ${dir}`;
}

/** Re-renders report.md and report.html for a saved run from metrics.json and its item dumps (`remit report`). */
export function rerenderReport(dir: string): { md: string; html: string } {
  const metricsPath = join(dir, 'metrics.json');
  if (!existsSync(metricsPath)) throw new Error(`${dir} has no metrics.json; is it an eval run directory?`);
  const { info, metrics } = JSON.parse(readFileSync(metricsPath, 'utf8')) as {
    info: RunInfo;
    metrics: Metrics;
  };
  const itemsDir = join(dir, 'items');
  const outcomes: ItemOutcome[] = existsSync(itemsDir)
    ? readdirSync(itemsDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => {
          const d = JSON.parse(readFileSync(join(itemsDir, f), 'utf8'));
          return {
            item: { id: d.id, labels: d.labels },
            comparison: d.comparison,
            result: d.result,
            latencyMs: 0,
            costUsd: 0,
          } as ItemOutcome;
        })
    : [];
  const md = join(dir, 'report.md');
  const html = join(dir, 'report.html');
  writeFileSync(md, renderReportMarkdown(info, metrics, outcomes));
  writeFileSync(html, renderReportHtml(info, metrics, outcomes));
  return { md, html };
}

/** Appends a run summary under the "## Eval runs" heading of EXPERIMENTS.md, creating the heading if needed. */
export function appendEvalRun(path: string, line: string): void {
  const text = readFileSync(path, 'utf8');
  const heading = '## Eval runs';
  const at = text.indexOf(`\n${heading}\n`);
  if (at === -1) {
    writeFileSync(path, `${text.trimEnd()}\n\n${heading}\n\n${line}\n`);
    return;
  }
  const next = text.indexOf('\n## ', at + heading.length + 1);
  const end = next === -1 ? text.length : next;
  const section = text.slice(0, end).trimEnd();
  writeFileSync(path, `${section}\n${line}\n${next === -1 ? '' : `\n${text.slice(next + 1)}`}`);
}
