import { describe, expect, it } from 'vitest';
import { removeRanges, stripComments } from './strip.js';
import { extractSymbols, grammarPath, isParsed, smallestEnclosing } from './treesitter.js';

const names = (syms: { name: string; kind: string; startLine: number; endLine: number }[]) =>
  syms.map((s) => `${s.kind}:${s.name}@${s.startLine}-${s.endLine}`);

describe('extractSymbols', () => {
  it('finds TypeScript functions, classes, methods, arrows, types and top-level tables', async () => {
    const src = `export function getUser(id: string) {
  return id;
}
export const toCsv = (rows: string[]) => rows.join(',');
export class Exporter {
  run() {
    return 1;
  }
  handler = () => 2;
}
export interface Row { a: string }
type Id = string;
export const DEFAULTS = {
  requestTimeoutMs: 30000,
};
`;
    expect(names(await extractSymbols('ts', src))).toEqual([
      'function:getUser@1-3',
      'function:toCsv@4-4',
      'class:Exporter@5-10',
      'method:run@6-8',
      'method:handler@9-9',
      'block:Row@11-11',
      'block:Id@12-12',
      'block:DEFAULTS@13-15',
    ]);
  });

  it('finds test blocks with titles, including .only, .skip and .each', async () => {
    const src = `describe('users', () => {
  it('returns 404 for unknown ids', () => {
    expect(1).toBe(1);
  });
  it.skip(\`skipped\`, () => {});
  test.each([1, 2])('handles %s', (n) => {});
});
`;
    const syms = await extractSymbols('ts', src);
    expect(names(syms)).toEqual([
      'test:users@1-7',
      'test:returns 404 for unknown ids@2-4',
      'test:skipped@5-5',
      'test:handles %s@6-6',
    ]);
    expect(syms[1]?.testTitle).toBe('returns 404 for unknown ids');
  });

  it('parses TSX and JavaScript', async () => {
    expect(names(await extractSymbols('tsx', 'export const Button = () => <button>ok</button>;\n'))).toEqual([
      'function:Button@1-1',
    ]);
    expect(names(await extractSymbols('js', 'function a() {}\nconst b = function () {};\n'))).toEqual([
      'function:a@1-1',
      'function:b@2-2',
    ]);
  });

  it('finds Python functions, methods, classes and tests with decorators', async () => {
    const src = `class Orders:
    def recent(self, days):
        return days


@pytest.mark.skip
def test_recent():
    assert Orders().recent(7) == 7


def helper():
    pass
`;
    expect(names(await extractSymbols('py', src))).toEqual([
      'class:Orders@1-3',
      'method:recent@2-3',
      'test:test_recent@6-8',
      'function:helper@11-12',
    ]);
  });

  it('finds Rust functions, impls, test modules and #[test] fns with attributes', async () => {
    const src = `pub struct Parser;

impl Parser {
    pub fn parse(&self, s: &str) -> Result<u32, ()> {
        s.parse().map_err(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn parses_three() {
        assert_eq!(Parser.parse("3"), Ok(3));
    }
}
`;
    expect(names(await extractSymbols('rs', src))).toEqual([
      'class:Parser@1-1',
      'class:Parser@3-7',
      'method:parse@4-6',
      'module:tests@9-18',
      'test:parses_three@13-17',
    ]);
  });

  it('picks the smallest enclosing symbol', async () => {
    const syms = await extractSymbols('ts', 'class A {\n  m() {\n    return 1;\n  }\n}\n');
    expect(smallestEnclosing(syms, 3, 3)?.name).toBe('m');
    expect(smallestEnclosing(syms, 1, 3)?.name).toBe('A');
    expect(smallestEnclosing(syms, 7, 7)).toBeNull();
  });

  it('knows which languages it parses and where grammars live', () => {
    expect(isParsed('rs')).toBe(true);
    expect(isParsed('other')).toBe(false);
    expect(grammarPath('py')).toMatch(/tree-sitter-python\.wasm$/);
    process.env.REMIT_GRAMMAR_DIR = '/opt/grammars';
    try {
      expect(grammarPath('tsx')).toBe('/opt/grammars/tree-sitter-tsx.wasm');
    } finally {
      delete process.env.REMIT_GRAMMAR_DIR;
    }
  });
});

describe('stripComments', () => {
  it('removes TS comments and keeps line numbers', async () => {
    const src = `// remit: requirement R3 is implemented here
export function f() {
  /* multi
     line */ return 1; // trailing
}
const url = "http://example.com"; // not a comment inside the string
`;
    const out = await stripComments('ts', src);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out).not.toContain('remit:');
    expect(out).not.toContain('trailing');
    expect(out).toContain('"http://example.com"');
    expect(out.split('\n')[3]).toBe(' return 1;');
  });

  it('removes Python comments and docstrings but keeps other strings', async () => {
    const src = `def f():
    """Docstring
    spanning lines."""
    x = "keep me"  # comment
    return x
`;
    const out = await stripComments('py', src);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out).not.toContain('Docstring');
    expect(out).not.toContain('# comment');
    expect(out).toContain('"keep me"');
  });

  it('removes Rust line, block and doc comments', async () => {
    const src = '/// doc\nfn a() { /* x */ 1 } // y\n';
    const out = await stripComments('rs', src);
    expect(out).toBe('\nfn a() {  1 }\n');
  });

  it('removeRanges ignores overlapping ranges', () => {
    expect(
      removeRanges('abcdef', [
        { startIndex: 1, endIndex: 3 },
        { startIndex: 2, endIndex: 4 },
      ]),
    ).toBe('adef');
    expect(removeRanges('abc', [])).toBe('abc');
  });
});
