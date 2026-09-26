import { describe, expect, it } from 'vitest';
import { blankStrings, isLiteral, splitArgs, viewOf } from './lines.js';

describe('line helpers', () => {
  it.each([
    [`it.skip("a .only b")`, `it.skip("")`],
    [`x = 'it\\'s' + "y"`, `x = '' + ""`],
    ['plain code', 'plain code'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the input is template-literal source text
    ['`tpl ${a}`', '``'],
  ])('blankStrings(%s)', (input, out) => {
    expect(blankStrings(input)).toBe(out);
  });

  it('splits arguments at top-level commas', () => {
    expect(splitArgs('a, f(b, c), "d,e", [1, 2]')).toEqual(['a', 'f(b, c)', '"d,e"', '[1, 2]']);
  });

  it('recognizes literals', () => {
    for (const l of ['404', '-1.5e3', '"x"', 'None', 'Ok(3)', '[1]', 'true']) expect(isLiteral(l)).toBe(true);
    for (const l of ['x', 'f(1)', 'a + b']) expect(isLiteral(l)).toBe(false);
  });

  it('returns an empty view for text without hunks', () => {
    expect(viewOf('renamed a -> b')).toEqual({ adds: [], dels: [], blocks: [] });
  });
});
