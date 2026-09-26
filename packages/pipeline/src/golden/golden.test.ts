import type { ChangeUnit, ReviewResult } from '@remit/core';
import type { FakeJev, FakeLlm } from '@remit/providers';
import { describe, expect, it } from 'vitest';
import { listScenarios, loadScenario, runScenario, type UnitSelector } from './harness.js';

const APPENDIX_D = [
  'three_reqs_one_missing',
  'misread_self_consistent',
  'ambiguous_recent',
  'unrelated_config',
  'surprise_refactor',
  'weakened_assertion',
  'supporting_changes',
  'preexisting',
  'deferred_part_one',
  'dead_implementation',
  'injection',
  'large_diff',
  'no_linked_issue',
  'two_issues',
  'rust_detectors',
  'python_detectors',
  'not_checkable',
  'partial_examples',
];

function unitFor(result: ReviewResult, sel: UnitSelector): ChangeUnit {
  const u = result.units.find((x) => x.file === sel.file && (!sel.symbol || x.symbol?.name === sel.symbol));
  if (!u)
    throw new Error(
      `no unit for ${sel.file}${sel.symbol ? `#${sel.symbol}` : ''}: ${result.units.map((x) => `${x.id} ${x.file}#${x.symbol?.name}`).join(', ')}`,
    );
  return u;
}

describe('golden scenarios (Appendix D)', () => {
  it('has all 18 scenarios', () => {
    expect(listScenarios()).toEqual([...APPENDIX_D].sort());
  });

  it.each(APPENDIX_D)('%s', async (name) => {
    const s = loadScenario(name);
    const { result, jev, llm } = await runScenario(s);
    const e = s.expected;
    const statuses = Object.fromEntries(result.requirementVerdicts.map((v) => [v.requirementId, v.status]));
    expect(statuses).toEqual(e.requirements);
    if (e.requirementIds) expect(result.requirements.map((r) => r.id)).toEqual(e.requirementIds);

    for (const u of e.units ?? [])
      expect(
        result.unitVerdicts.find((v) => v.unitId === unitFor(result, u).id)?.role,
        `${u.file}#${u.symbol}`,
      ).toBe(u.role);

    for (const f of e.facts ?? []) {
      const pool = f.unit ? unitFor(result, f.unit).facts : result.units.flatMap((x) => x.facts);
      expect(
        pool.some((x) => x.kind === f.kind && x.severity === f.severity),
        `${f.kind} ${f.severity}`,
      ).toBe(true);
    }

    for (const f of e.findings ?? []) {
      const match = result.findings.find((x) => {
        if (f.id && x.id !== f.id) return false;
        if (f.type && x.type !== f.type) return false;
        if (f.unit) {
          const u = unitFor(result, f.unit);
          const target =
            x.type === 'test_integrity' || x.type === 'fact'
              ? u.facts.some((ff) => `F-${ff.id}` === x.id) || x.targetId === u.id
              : x.targetId === u.id;
          if (!target) return false;
        }
        return true;
      });
      expect(match, JSON.stringify(f)).toBeDefined();
      expect(match?.priority).toBe(f.priority);
      if (f.route) expect(match?.route).toBe(f.route);
      if (f.reason) expect(match?.reasons.map((r) => r.text).join(' ')).toContain(f.reason);
    }
    for (const p of e.noFindingsOfPriority ?? [])
      expect(result.findings.filter((f) => f.priority === p).map((f) => f.id)).toEqual([]);
    if (e.noFindings) expect(result.findings).toEqual([]);
    for (const id of e.claimMismatch ?? [])
      expect(result.requirementVerdicts.find((v) => v.requirementId === id)?.claimMismatch).toBeDefined();
    for (const [id, text] of Object.entries(e.reasons ?? {}))
      expect(
        result.requirementVerdicts.find((v) => v.requirementId === id)?.reasons.map((r) => r.text),
      ).toContain(text);
    for (const w of e.warnings ?? []) expect(result.warnings.join('\n')).toContain(w);

    // Blindness: the PR description never reaches extraction.
    const prText = s.input.pr.body.trim();
    if (prText) expect(JSON.stringify((llm as FakeLlm).calls)).not.toContain(prText.slice(0, 40));

    // Comment stripping: injected comments never reach Jev.
    for (const text of e.mustNotAppearInJudgeViews ?? []) {
      expect(JSON.stringify((jev as FakeJev).calls.map((c) => c.state))).not.toContain(text);
      expect(result.units.some((u) => u.patch.includes(text))).toBe(true);
    }

    if (e.sameVerdictsAs) {
      const other = await runScenario(loadScenario(e.sameVerdictsAs));
      const brief = (r: ReviewResult) => ({
        requirements: r.requirements.map((x) => [x.id, x.quote]),
        verdicts: r.requirementVerdicts.map((v) => [v.requirementId, v.status]),
        findings: r.findings.filter((f) => f.type === 'requirement').map((f) => [f.id, f.priority, f.route]),
      });
      expect(brief(result)).toEqual(brief(other.result));
    }

    expect(result.schemaVersion).toBe('1.0.0');
  });

  it('runs the claims check only after the blind pass (6.8)', async () => {
    const { jev } = await runScenario(loadScenario('three_reqs_one_missing'));
    const kinds = (jev as FakeJev).calls.map((c) => `${c.meta.kind}:${c.meta.targetId}`);
    const firstClaim = kinds.findIndex((k) => k.startsWith('claims:'));
    expect(firstClaim).toBeGreaterThan(0);
    const blind = kinds.filter(
      (k, i) =>
        (k.startsWith('issue:') ||
          k.startsWith('reverse:') ||
          k.startsWith('tests:') ||
          (k.startsWith('forward:') && kinds.indexOf(k) === i)) &&
        i > firstClaim,
    );
    expect(blind).toEqual([]);
  });

  it('large_diff uses the rerank path and finds R2 in the widen pass', async () => {
    const s = loadScenario('large_diff');
    const { jev } = await runScenario(s);
    const calls = (jev as FakeJev).calls;
    expect(calls.some((c) => c.meta.kind === 'rerank' && c.meta.targetId.startsWith('R2'))).toBe(true);
    const r2 = calls.filter((c) => c.meta.kind === 'forward' && c.meta.targetId === 'R2');
    expect(r2).toHaveLength(2);
    const firstIds = (
      (r2[0]?.state as { candidates?: { file: string }[] } | undefined)?.candidates ?? []
    ).map((c) => c.file);
    const secondIds = (
      (r2[1]?.state as { candidates?: { file: string }[] } | undefined)?.candidates ?? []
    ).map((c) => c.file);
    expect(firstIds).not.toContain('src/alerts/pager.ts');
    expect(secondIds).toContain('src/alerts/pager.ts');
  });
});
