/**
 * Seed and operator checks (BUILD_PROMPT G.1, G.2): every seed is well formed, every operator applies to it, every
 * mutated file re-parses cleanly, and the recomputed diff parses.
 */
import { parseDiff } from '@remit/analysis';
import { parseIssueMarkdown, taskListRequirements } from '@remit/core';
import { describe, expect, it } from 'vitest';
import { assertParses } from './ast.js';
import { SEEDS_ROOT, seedItems, splitOf, stratifiedSplits } from './generate.js';
import { allMutations, OPERATORS } from './operators.js';
import { loadSeed, seedDirs } from './seed.js';

const dirs = seedDirs(SEEDS_ROOT);
const PARSED = /\.(ts|tsx|js|py|rs)$/;

describe('mutation seeds', () => {
  it('has at least 4 synthetic seeds per language', () => {
    const langs = dirs.map((d) => loadSeed(d).seed.language);
    for (const l of ['ts', 'py', 'rs']) expect(langs.filter((x) => x === l).length).toBeGreaterThanOrEqual(4);
  });

  describe.each(dirs.map((d) => [d.split('/').pop() as string, d]))('%s', (_name, dir) => {
    const seed = loadSeed(dir);

    it('is ASCII, parses cleanly, and its task list matches the requirements in order', async () => {
      for (const [p, text] of [...Object.entries(seed.base), ...Object.entries(seed.head)]) {
        const ascii = [...text].every(
          (c) => c === '\t' || c === '\n' || c === '\r' || (c >= ' ' && c <= '~'),
        );
        expect(ascii, `${p} is not ASCII`).toBe(true);
        if (PARSED.test(p)) await assertParses(text, p);
      }
      const tasks = taskListRequirements(parseIssueMarkdown(seed.issue)).map((t) => t.text);
      expect(tasks).toEqual(seed.seed.requirements.map((r) => r.text));
      expect(seed.seed.requirements.map((r) => r.id)).toEqual(tasks.map((_, i) => `R${i + 1}`));
      expect(seed.seed.annotated_by).toBe('claude-code');
    });

    it('never reverts a whole symbol that another requirement also claims', () => {
      const owners = new Map<string, string[]>();
      for (const r of seed.seed.requirements)
        for (const u of [...r.implementing, ...r.tests]) {
          const key = `${u.file}|${u.symbol ?? '*'}`;
          owners.set(key, [...(owners.get(key) ?? []), u.remove || u.replace ? `${r.id}:edit` : r.id]);
        }
      for (const [key, ids] of owners)
        if (ids.length > 1)
          expect(
            ids.every((x) => x.endsWith(':edit')),
            `${key} is reverted whole by ${ids}`,
          ).toBe(true);
    });

    it('applies every operator, re-parses, and yields a parseable diff', async () => {
      const mutations = await allMutations(seed);
      const ops = new Set(mutations.map((m) => m.operator));
      for (const op of OPERATORS) expect(ops.has(op), `${op} did not apply`).toBe(true);
      expect(mutations.filter((m) => m.operator === 'drop_requirement')).toHaveLength(
        seed.seed.requirements.length,
      );
      const items = await seedItems(seed);
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
      for (const item of items) {
        expect(item.input.diffText.length).toBeGreaterThan(0);
        expect(() => parseDiff(item.input.diffText)).not.toThrow();
        expect(item.seedId).toBe(seed.seed.id);
      }
      expect(items[0]?.labels.pr).toBe('clean');
    });
  });
});

describe('seed splits', () => {
  it('pins about 30% of each language to test (D26)', () => {
    const seeds = dirs.map((d) => loadSeed(d).seed);
    for (const lang of ['ts', 'py', 'rs']) {
      const group = seeds.filter((s) => s.language === lang);
      expect(group.every((s) => s.split)).toBe(true);
      expect(group.filter((s) => s.split === 'test')).toHaveLength(Math.round(group.length * 0.3));
    }
    const stratified = stratifiedSplits(seeds.map((s) => ({ id: s.id, language: s.language })));
    for (const s of seeds) expect(s.split).toBe(stratified[s.id]);
  });
});

describe('splitOf', () => {
  it('is stable and roughly 70/30', () => {
    expect(splitOf('ts-job-intervals')).toBe(splitOf('ts-job-intervals'));
    const ids = Array.from({ length: 1000 }, (_, i) => `seed-${i}`);
    const dev = ids.filter((id) => splitOf(id) === 'dev').length;
    expect(dev).toBeGreaterThan(650);
    expect(dev).toBeLessThan(750);
  });
});
