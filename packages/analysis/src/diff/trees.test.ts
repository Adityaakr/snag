import { describe, expect, it } from 'vitest';
import { parseDiff } from './parse.js';
import { diffTrees } from './trees.js';

describe('diffTrees', () => {
  it('diffs added, deleted and modified files and skips unchanged ones', () => {
    const text = diffTrees(
      { 'a.ts': 'one\ntwo\n', 'gone.ts': 'x\n', 'same.ts': 's\n' },
      { 'a.ts': 'one\nthree\n', 'new.ts': 'n\n', 'same.ts': 's\n' },
    );
    const parsed = parseDiff(text);
    expect(parsed.files.map((f) => [f.newPath ?? f.oldPath, f.status])).toEqual([
      ['a.ts', 'modified'],
      ['gone.ts', 'deleted'],
      ['new.ts', 'added'],
    ]);
    expect(text).not.toContain('same.ts');
    expect(diffTrees({ 'a.ts': 'x\n' }, { 'a.ts': 'x\n' })).toBe('');
  });
});
