/**
 * `--explain <finding-id>` and `/remit explain` (BUILD_PROMPT 10.1, 10.2): the raw answers, thresholds and
 * evidence behind one finding, as plain text.
 */
import type { Thresholds } from '../config/schema.js';
import type { Answer, ReviewResult } from '../contracts/index.js';
import { plain } from './sanitize.js';

function answerLine(a: Answer): string {
  const probs = a.probabilities
    ? ` ${Object.entries(a.probabilities)
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join(' ')}`
    : '';
  const value = typeof a.value === 'number' ? a.value.toFixed(3) : a.value;
  return `  ${a.call} ${a.question}: ${value}${a.confidence !== undefined ? ` (confidence ${a.confidence.toFixed(2)})` : ''}${probs}`;
}

/** Returns the explanation, or null when no finding has that id. */
export function explainFinding(r: ReviewResult, id: string, thresholds: Thresholds): string | null {
  const f = r.findings.find((x) => x.id === id);
  if (!f) return null;
  const out = [
    `${f.id} (${f.type}) ${f.priority} route ${f.route.replace('_', ' ')} confidence ${f.confidence.toFixed(2)}`,
    ...f.reasons.map((x) => `  reason [${x.template}]: ${plain(x.text, 500)}`),
    ...f.locations
      .filter((l) => l.lines[0] > 0)
      .map((l) => `  location: ${l.file}:${l.lines[0]}-${l.lines[1]}`),
  ];
  const req = r.requirements.find((q) => q.id === f.targetId);
  const verdict = r.requirementVerdicts.find((v) => v.requirementId === f.targetId);
  if (req && verdict) {
    out.push(
      `  requirement ${req.id}: "${plain(req.quote)}" (${req.kind}, ${req.priority})`,
      `  status ${verdict.status}, tested ${verdict.tested}, calibrated ${verdict.calibrated}`,
    );
    for (const e of verdict.evidence)
      out.push(
        `  evidence: ${e.unitId} ${e.file} ${e.lines.map(([a, b]) => `${a}-${b}`).join(',')} (${e.probability.toFixed(2)})`,
      );
    for (const e of verdict.testEvidence)
      out.push(`  test evidence: ${e.unitId} ${e.file} (${e.probability.toFixed(2)})`);
    if (verdict.claimMismatch) out.push(`  claim: "${plain(verdict.claimMismatch.sentence)}"`);
    out.push('  answers:', ...verdict.answers.map(answerLine));
  }
  const unitId =
    f.type === 'unit'
      ? f.targetId
      : r.units.find((u) => u.facts.some((x) => `F-${x.id}` === f.id) || `F-${u.id}-integrity` === f.id)?.id;
  const uv = unitId ? r.unitVerdicts.find((v) => v.unitId === unitId) : undefined;
  if (uv) {
    const u = r.units.find((x) => x.id === uv.unitId);
    out.push(
      `  unit ${uv.unitId} ${u?.file ?? ''}${u?.symbol ? ` (${u.symbol.name})` : ''}: role ${uv.role}`,
    );
    for (const fact of u?.facts ?? [])
      out.push(`  fact ${fact.id} ${fact.kind} [${fact.severity}]: ${plain(fact.detail, 200)}`);
    out.push('  answers:', ...uv.answers.map(answerLine));
  }
  out.push(
    '  thresholds:',
    `  ${Object.entries(thresholds)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')}`,
  );
  return `${out.join('\n')}\n`;
}
