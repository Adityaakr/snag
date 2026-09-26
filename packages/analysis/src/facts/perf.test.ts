import { createTwoFilesPatch } from 'diff';
import { describe, expect, it } from 'vitest';
import { parseDiff } from '../diff/parse.js';
import { buildUnits } from '../units/build.js';
import { detectFacts } from './index.js';

// BUILD_PROMPT 12: units and facts for a 5,000-line diff in under 3 s locally.
describe('performance', () => {
  it('builds units and facts for a 5,000-line diff in under 3 s', async () => {
    const files = new Map<string, [string, string]>();
    for (let f = 0; f < 50; f++) {
      const fn = (i: number, v: number) => `export function f${f}_${i}(x: number) {\n  const a = x + ${v};\n  return a * 2;\n}\n`;
      const before = Array.from({ length: 25 }, (_, i) => fn(i, i)).join('\n');
      const after = Array.from({ length: 25 }, (_, i) => fn(i, i + 1000)).join('\n') + Array.from({ length: 20 }, (_, i) => fn(100 + i, i)).join('\n');
      files.set(`src/m${f}.ts`, [before, after]);
    }
    const patch = [...files].map(([p, [b, a]]) => createTwoFilesPatch(`a/${p}`, `b/${p}`, b, a, '', '', { context: 3 })).join('');
    const changed = patch.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length;
    expect(changed).toBeGreaterThanOrEqual(5000);
    const contents = { get: async (side: 'base' | 'head', path: string) => files.get(path)?.[side === 'base' ? 0 : 1] ?? null };
    const t = performance.now();
    const { units } = await buildUnits(parseDiff(patch), { contents });
    await detectFacts(units, { contents, references: { count: async () => 1 } });
    const ms = performance.now() - t;
    expect(units.length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(3000);
  }, 20_000);
});
