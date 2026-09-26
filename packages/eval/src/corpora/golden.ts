/** Corpus D (BUILD_PROMPT 11.1): the Appendix D golden scenarios, always run, never split. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { RequirementStatus } from '@remit/core';
import { listScenarios, loadScenario } from '@remit/pipeline';
import { type EvalItem, prLabelFrom, type TreeFiles } from '../item.js';

function readTree(root: string): Record<string, string> {
  if (!existsSync(root)) return {};
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(root);
  return out;
}

export function goldenItems(): EvalItem[] {
  return listScenarios().map((name) => {
    const s = loadScenario(name);
    const e = s.expected;
    const trees: TreeFiles = { base: readTree(join(s.dir, 'base')), head: readTree(join(s.dir, 'head')) };
    // A PR is a problem when Appendix D expects a P0/P1 finding or a high-severity code fact (for example a weakened test).
    const problemFinding =
      (e.findings ?? []).some((f) => f.priority === 'P0' || f.priority === 'P1') ||
      (e.facts ?? []).some((f) => f.severity === 'high');
    return {
      id: `golden/${name}`,
      corpus: 'golden',
      input: s.input,
      trees,
      config: s.config,
      labels: {
        requirements: e.requirements as Record<string, RequirementStatus>,
        units: (e.units ?? []) as EvalItem['labels']['units'],
        facts: (e.facts ?? []).map((f) => ({
          kind: f.kind,
          ...(f.unit ? { file: f.unit.file, ...(f.unit.symbol ? { symbol: f.unit.symbol } : {}) } : {}),
        })),
        testIntegrity: (e.findings ?? [])
          .filter((f) => f.type === 'test_integrity' && f.unit)
          .map((f) => ({
            file: f.unit?.file as string,
            ...(f.unit?.symbol ? { symbol: f.unit.symbol } : {}),
          })),
        pr: prLabelFrom(e.requirements as Record<string, RequirementStatus>, problemFinding),
      },
      scripts: { jev: s.jevScript, llm: s.llmScript },
      expected: e,
      annotatedBy: 'claude-code',
    };
  });
}
