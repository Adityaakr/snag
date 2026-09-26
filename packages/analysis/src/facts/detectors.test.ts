import type { CodeFactKind } from '@remit/core';
import { createTwoFilesPatch } from 'diff';
import { describe, expect, it } from 'vitest';
import { parseDiff } from '../diff/parse.js';
import { buildUnits } from '../units/build.js';
import type { ReferenceIndex } from './api.js';
import { detectFacts } from './index.js';
import { entropy, secretKind } from './secrets.js';

interface Case {
  name: string;
  path: string;
  before: string;
  after: string;
  /** Expected number of facts of the detector's kind (0 for negative cases). */
  count: number;
  severity?: 'info' | 'warn' | 'high';
  refs?: number | null;
}

async function factsFor(c: Pick<Case, 'path' | 'before' | 'after' | 'refs'>) {
  const patch = createTwoFilesPatch(`a/${c.path}`, `b/${c.path}`, c.before, c.after, '', '', { context: 3 });
  const contents = { get: async (side: 'base' | 'head') => (side === 'base' ? c.before : c.after) };
  const { units } = await buildUnits(parseDiff(patch), { contents });
  const references: ReferenceIndex | undefined =
    c.refs === undefined ? undefined : { count: async () => (c.refs === null ? null : (c.refs as number)) };
  return detectFacts(units, { contents, ...(references ? { references } : {}) });
}

function table(kind: CodeFactKind, cases: Case[]) {
  const pos = cases.filter((c) => c.count > 0).length;
  const neg = cases.filter((c) => c.count === 0).length;
  describe(kind, () => {
    it('has at least 3 positive and 2 negative cases', () => {
      expect(pos).toBeGreaterThanOrEqual(3);
      expect(neg).toBeGreaterThanOrEqual(2);
    });
    it.each(cases)('$name', async (c) => {
      const { units } = await factsFor(c);
      const facts = units.flatMap((u) => u.facts).filter((f) => f.kind === kind);
      expect(facts, JSON.stringify(units.flatMap((u) => u.facts))).toHaveLength(c.count);
      if (c.severity) for (const f of facts) expect(f.severity).toBe(c.severity);
    });
  });
}

const ts = (body: string) => `import { expect, it } from 'vitest';\n\nit('works', () => {\n${body}\n});\n`;
const py = (body: string) => `def test_total():\n${body}\n`;
const rs = (body: string) => `#[cfg(test)]\nmod tests {\n    #[test]\n    fn parses() {\n${body}\n    }\n}\n`;

table('assertion_removed', [
  {
    name: 'ts: one of two expects removed',
    path: 'a.test.ts',
    before: ts('  expect(a).toBe(1);\n  expect(b).toBe(2);'),
    after: ts('  expect(a).toBe(1);'),
    count: 1,
    severity: 'high',
  },
  {
    name: 'py: assert removed',
    path: 'tests/test_a.py',
    before: py('    assert total() == 3\n    assert other() == 4'),
    after: py('    assert total() == 3\n    pass'),
    count: 1,
  },
  {
    name: 'rs: assert_eq removed',
    path: 'src/lib.rs',
    before: rs('        assert_eq!(parse("3"), Ok(3));\n        assert_eq!(parse("4"), Ok(4));'),
    after: rs('        assert_eq!(parse("3"), Ok(3));'),
    count: 1,
  },
  {
    name: 'ts: assertion replaced one for one',
    path: 'a.test.ts',
    before: ts('  expect(a).toBe(1);'),
    after: ts('  expect(a).toBe(2);'),
    count: 0,
  },
  {
    name: 'ts: assertion added',
    path: 'a.test.ts',
    before: ts('  expect(a).toBe(1);'),
    after: ts('  expect(a).toBe(1);\n  expect(b).toBe(2);'),
    count: 0,
  },
  {
    name: 'source file ignored',
    path: 'src/a.ts',
    before: 'export function f() {\n  expect(1);\n  expect(2);\n}\n',
    after: 'export function f() {\n  expect(1);\n}\n',
    count: 0,
  },
]);

table('assertion_weakened', [
  {
    name: 'toEqual to toBeDefined',
    path: 'totals.test.ts',
    before: ts('  expect(total).toEqual(42);'),
    after: ts('  expect(total).toBeDefined();'),
    count: 1,
    severity: 'high',
  },
  {
    name: 'toStrictEqual to toEqual',
    path: 'a.test.ts',
    before: ts('  expect(o).toStrictEqual({ a: 1 });'),
    after: ts('  expect(o).toEqual({ a: 1 });'),
    count: 1,
  },
  {
    name: 'toThrow(msg) to toThrow()',
    path: 'a.test.ts',
    before: ts("  expect(() => f()).toThrow('bad id');"),
    after: ts('  expect(() => f()).toThrow();'),
    count: 1,
  },
  {
    name: 'toHaveBeenCalledWith to toHaveBeenCalled',
    path: 'a.test.ts',
    before: ts("  expect(spy).toHaveBeenCalledWith('x');"),
    after: ts('  expect(spy).toHaveBeenCalled();'),
    count: 1,
  },
  {
    name: 'py assertEqual to assertTrue',
    path: 'tests/test_a.py',
    before: 'class T:\n    def test_x(self):\n        self.assertEqual(f(), 3)\n',
    after: 'class T:\n    def test_x(self):\n        self.assertTrue(f())\n',
    count: 1,
  },
  {
    name: 'py pytest.raises loses match',
    path: 'tests/test_a.py',
    before: py("    with pytest.raises(ValueError, match='bad'):\n        f()"),
    after: py('    with pytest.raises(ValueError):\n        f()'),
    count: 1,
  },
  {
    name: 'rs assert_eq to is_ok',
    path: 'src/lib.rs',
    before: rs('        assert_eq!(parse(x), Ok(3));'),
    after: rs('        assert!(parse(x).is_ok());'),
    count: 1,
  },
  {
    name: 'toEqual kept, value changed',
    path: 'a.test.ts',
    before: ts('  expect(t).toEqual(1);'),
    after: ts('  expect(t).toEqual(2);'),
    count: 0,
  },
  {
    name: 'toEqual to toStrictEqual (stricter)',
    path: 'a.test.ts',
    before: ts('  expect(o).toEqual({});'),
    after: ts('  expect(o).toStrictEqual({});'),
    count: 0,
  },
  {
    name: 'commented-out loose matcher',
    path: 'a.test.ts',
    before: ts('  expect(t).toEqual(1);'),
    after: ts('  expect(t).toEqual(1);\n  // expect(t).toBeDefined();'),
    count: 0,
  },
]);

table('expected_value_changed', [
  {
    name: 'ts toBe literal changed',
    path: 'users.test.ts',
    before: ts('  expect(res.status).toBe(404);'),
    after: ts('  expect(res.status).toBe(400);'),
    count: 1,
    severity: 'warn',
  },
  {
    name: 'py assert == literal changed',
    path: 'tests/test_o.py',
    before: py('    assert recent_days() == 30'),
    after: py('    assert recent_days() == 7'),
    count: 1,
  },
  {
    name: 'rs assert_eq literal changed',
    path: 'src/lib.rs',
    before: rs('        assert_eq!(parse("3"), Ok(3));'),
    after: rs('        assert_eq!(parse("3"), Ok(4));'),
    count: 1,
  },
  {
    name: 'subject changed, not expected',
    path: 'a.test.ts',
    before: ts('  expect(a).toBe(1);'),
    after: ts('  expect(b).toBe(1);'),
    count: 0,
  },
  {
    name: 'expected is a variable on both sides',
    path: 'a.test.ts',
    before: ts('  expect(a).toBe(x);'),
    after: ts('  expect(a).toBe(y);'),
    count: 0,
  },
]);

table('test_skipped', [
  {
    name: 'it.skip',
    path: 'a.test.ts',
    before: ts('  expect(1).toBe(1);'),
    after: ts('  expect(1).toBe(1);').replace("it('works'", "it.skip('works'"),
    count: 1,
    severity: 'high',
  },
  {
    name: 'xit',
    path: 'a.test.js',
    before: "it('a', () => {\n  expect(1).toBe(1);\n});\n",
    after: "xit('a', () => {\n  expect(1).toBe(1);\n});\n",
    count: 1,
  },
  {
    name: 'pytest.mark.skip',
    path: 'tests/test_a.py',
    before: py('    assert 1'),
    after: `@pytest.mark.skip\n${py('    assert 1')}`,
    count: 1,
  },
  {
    name: 'rust #[ignore]',
    path: 'src/lib.rs',
    before: rs('        assert!(true);'),
    after: rs('        assert!(true);').replace('#[test]', '#[test]\n    #[ignore]'),
    count: 1,
  },
  {
    name: 'it.todo',
    path: 'a.test.ts',
    before: ts('  expect(1).toBe(1);'),
    after: `${ts('  expect(1).toBe(1);')}it.todo('later');\n`,
    count: 1,
  },
  {
    name: 'skip removed',
    path: 'a.test.ts',
    before: ts('  x();').replace("it('works'", "it.skip('works'"),
    after: ts('  x();'),
    count: 0,
  },
  {
    name: 'skip kept while body changes',
    path: 'a.test.ts',
    before: ts('  x();').replace("it('works'", "it.skip('works'"),
    after: ts('  y();').replace("it('works'", "it.skip('works'"),
    count: 0,
  },
]);

table('test_focused', [
  {
    name: 'it.only',
    path: 'a.test.ts',
    before: ts('  x();'),
    after: ts('  x();').replace("it('works'", "it.only('works'"),
    count: 1,
    severity: 'high',
  },
  {
    name: 'describe.only',
    path: 'a.spec.ts',
    before: "describe('d', () => {\n  it('a', () => {});\n});\n",
    after: "describe.only('d', () => {\n  it('a', () => {});\n});\n",
    count: 1,
  },
  {
    name: 'fit',
    path: 'a.test.js',
    before: "it('a', () => {\n  x();\n});\n",
    after: "fit('a', () => {\n  x();\n});\n",
    count: 1,
  },
  {
    name: 'only removed',
    path: 'a.test.ts',
    before: ts('  x();').replace("it('works'", "it.only('works'"),
    after: ts('  x();'),
    count: 0,
  },
  {
    name: 'word only in a string',
    path: 'a.test.ts',
    before: ts("  log('a');"),
    after: ts("  log('only this');"),
    count: 0,
  },
]);

table('test_deleted', [
  {
    name: 'test function deleted',
    path: 'a.test.ts',
    before: `${ts('  x();')}\nit('second', () => {\n  y();\n});\n`,
    after: ts('  x();'),
    count: 1,
    severity: 'high',
  },
  {
    name: 'python test deleted',
    path: 'tests/test_a.py',
    before: `${py('    assert 1')}\n\ndef test_other():\n    assert 2\n`,
    after: py('    assert 1'),
    count: 1,
  },
  { name: 'test file deleted', path: 'tests/test_gone.py', before: py('    assert 1'), after: '', count: 1 },
  { name: 'test body edited', path: 'a.test.ts', before: ts('  x();'), after: ts('  y();'), count: 0 },
  {
    name: 'source function deleted',
    path: 'src/a.ts',
    before: 'export function a() {\n  return 1;\n}\n\nexport function b() {\n  return 2;\n}\n',
    after: 'export function a() {\n  return 1;\n}\n',
    count: 0,
  },
]);

table('snapshot_updated', [
  {
    name: 'jest snapshot file',
    path: 'src/__snapshots__/a.test.ts.snap',
    before: 'exports[`a 1`] = `1`;\n',
    after: 'exports[`a 1`] = `2`;\n',
    count: 1,
    severity: 'warn',
  },
  {
    name: 'nested snapshot dir',
    path: 'pkg/x/__snapshots__/b.test.tsx.snap',
    before: 'a\n',
    after: 'b\n',
    count: 1,
  },
  { name: 'standalone .snap', path: 'tests/out.snap', before: 'a\n', after: 'b\n', count: 1 },
  { name: 'regular test file', path: 'a.test.ts', before: ts('  x();'), after: ts('  y();'), count: 0 },
  {
    name: 'file named snapshots.ts',
    path: 'src/snapshots.ts',
    before: 'export const a = 1;\n',
    after: 'export const a = 2;\n',
    count: 0,
  },
]);

table('tolerance_widened', [
  {
    name: 'pytest.approx rel widened',
    path: 'tests/test_m.py',
    before: py('    assert f() == pytest.approx(1.0, rel=1e-6)'),
    after: py('    assert f() == pytest.approx(1.0, rel=0.1)'),
    count: 1,
    severity: 'warn',
  },
  {
    name: 'pytest.approx abs widened',
    path: 'tests/test_m.py',
    before: py('    assert f() == pytest.approx(1.0, abs=0.001)'),
    after: py('    assert f() == pytest.approx(1.0, abs=0.5)'),
    count: 1,
  },
  {
    name: 'toBeCloseTo digits reduced',
    path: 'm.test.ts',
    before: ts('  expect(x).toBeCloseTo(0.3, 5);'),
    after: ts('  expect(x).toBeCloseTo(0.3, 1);'),
    count: 1,
  },
  {
    name: 'toBe replaced by toBeCloseTo',
    path: 'm.test.ts',
    before: ts('  expect(x).toBe(0.3);'),
    after: ts('  expect(x).toBeCloseTo(0.3);'),
    count: 1,
  },
  {
    name: 'tolerance tightened',
    path: 'tests/test_m.py',
    before: py('    assert f() == pytest.approx(1.0, rel=0.1)'),
    after: py('    assert f() == pytest.approx(1.0, rel=1e-6)'),
    count: 0,
  },
  {
    name: 'digits increased',
    path: 'm.test.ts',
    before: ts('  expect(x).toBeCloseTo(0.3, 1);'),
    after: ts('  expect(x).toBeCloseTo(0.3, 5);'),
    count: 0,
  },
]);

table('retry_or_timeout_added', [
  {
    name: 'vitest retry option',
    path: 'a.test.ts',
    before: ts('  x();'),
    after: ts('  x();').replace("it('works', ()", "it('works', { retry: 3 }, ()"),
    count: 1,
    severity: 'warn',
  },
  {
    name: 'pytest flaky marker',
    path: 'tests/test_a.py',
    before: py('    assert 1'),
    after: `@pytest.mark.flaky(reruns=3)\n${py('    assert 1')}`,
    count: 1,
  },
  {
    name: 'timeout raised in config',
    path: 'vitest.config.ts',
    before: 'export default { test: { testTimeout: 5000 } };\n',
    after: 'export default { test: { testTimeout: 60000 } };\n',
    count: 1,
  },
  {
    name: 'jest.retryTimes added',
    path: 'a.test.js',
    before: "it('a', () => {\n  x();\n});\n",
    after: "jest.retryTimes(3);\nit('a', () => {\n  x();\n});\n",
    count: 1,
  },
  {
    name: 'timeout lowered',
    path: 'vitest.config.ts',
    before: 'export default { test: { testTimeout: 60000 } };\n',
    after: 'export default { test: { testTimeout: 5000 } };\n',
    count: 0,
  },
  {
    name: 'retry in source code',
    path: 'src/client.ts',
    before: 'export const opts = { a: 1 };\n',
    after: 'export const opts = { retry: 3 };\n',
    count: 0,
  },
]);

table('suppression_added', [
  {
    name: '@ts-ignore',
    path: 'src/a.ts',
    before: 'export const a: number = f();\n',
    after: '// @ts-ignore\nexport const a: number = f();\n',
    count: 1,
    severity: 'warn',
  },
  {
    name: 'eslint-disable-next-line',
    path: 'src/a.js',
    before: 'const a = 1;\n',
    after: '// eslint-disable-next-line no-unused-vars\nconst a = 1;\n',
    count: 1,
  },
  {
    name: '# noqa and # type: ignore',
    path: 'src/a.py',
    before: 'import os\nx = f()\n',
    after: 'import os  # noqa: F401\nx = f()  # type: ignore\n',
    count: 2,
  },
  {
    name: 'rust #[allow]',
    path: 'src/lib.rs',
    before: 'fn a() {}\n',
    after: '#[allow(dead_code)]\nfn a() {}\n',
    count: 1,
  },
  {
    name: 'suppression removed',
    path: 'src/a.ts',
    before: '// @ts-ignore\nexport const a = f();\n',
    after: 'export const a = f();\n',
    count: 0,
  },
  {
    name: 'suppression moved',
    path: 'src/a.ts',
    before: '// @ts-ignore\nexport const a = f();\nexport const b = 1;\n',
    after: 'export const b = 1;\n// @ts-ignore\nexport const a = f();\n',
    count: 0,
  },
  {
    // Dogfood M5 X1: prose that mentions a marker is not a suppression.
    name: 'docs that mention a suppression',
    path: 'README.md',
    before: '# X\n',
    after: '# X\n\nFacts such as a new `@ts-ignore` are flagged.\n',
    count: 0,
  },
]);

table('catch_broadened', [
  {
    name: 'empty catch',
    path: 'src/a.ts',
    before: 'export function f() {\n  g();\n}\n',
    after: 'export function f() {\n  try {\n    g();\n  } catch {}\n}\n',
    count: 1,
    severity: 'warn',
  },
  {
    name: 'empty .catch',
    path: 'src/a.ts',
    before: 'export function f() {\n  return g();\n}\n',
    after: 'export function f() {\n  return g().catch(() => {});\n}\n',
    count: 1,
  },
  {
    name: 'bare except',
    path: 'src/a.py',
    before: 'def f():\n    g()\n',
    after: 'def f():\n    try:\n        g()\n    except:\n        log()\n',
    count: 1,
  },
  {
    name: 'except Exception: pass',
    path: 'src/a.py',
    before: 'def f():\n    g()\n',
    after: 'def f():\n    try:\n        g()\n    except Exception:\n        pass\n',
    count: 1,
  },
  {
    name: 'rust ? replaced by unwrap_or_default',
    path: 'src/lib.rs',
    before: 'fn f() -> Result<u32, E> {\n    let v = g()?;\n    Ok(v)\n}\n',
    after: 'fn f() -> Result<u32, E> {\n    let v = g().unwrap_or_default();\n    Ok(v)\n}\n',
    count: 1,
  },
  {
    name: 'catch that handles',
    path: 'src/a.ts',
    before: 'export function f() {\n  g();\n}\n',
    after: 'export function f() {\n  try {\n    g();\n  } catch (e) {\n    log(e);\n  }\n}\n',
    count: 0,
  },
  {
    name: 'except ValueError with handling',
    path: 'src/a.py',
    before: 'def f():\n    g()\n',
    after: 'def f():\n    try:\n        g()\n    except ValueError:\n        raise Bad()\n',
    count: 0,
  },
]);

table('threshold_lowered', [
  {
    name: 'vitest coverage lines lowered',
    path: 'vitest.config.ts',
    before: 'export default { coverage: { thresholds: { lines: 90 } } };\n',
    after: 'export default { coverage: { thresholds: { lines: 70 } } };\n',
    count: 1,
    severity: 'high',
  },
  {
    name: 'pytest fail_under lowered',
    path: 'pyproject.toml',
    before: '[tool.coverage.report]\nfail_under = 85\n',
    after: '[tool.coverage.report]\nfail_under = 50\n',
    count: 1,
  },
  {
    name: 'eslint rule error to warn',
    path: '.eslintrc.json',
    before: '{\n  "rules": {\n    "no-console": "error"\n  }\n}\n',
    after: '{\n  "rules": {\n    "no-console": "warn"\n  }\n}\n',
    count: 1,
  },
  {
    name: 'max-warnings raised',
    path: 'package.json',
    before: '{\n  "scripts": { "lint": "eslint . --max-warnings 0" }\n}\n',
    after: '{\n  "scripts": { "lint": "eslint . --max-warnings 50" }\n}\n',
    count: 1,
  },
  {
    name: 'threshold raised',
    path: 'vitest.config.ts',
    before: 'export default { coverage: { thresholds: { lines: 70 } } };\n',
    after: 'export default { coverage: { thresholds: { lines: 90 } } };\n',
    count: 0,
  },
  {
    name: 'rule made stricter',
    path: '.eslintrc.json',
    before: '{\n  "rules": {\n    "no-console": "warn"\n  }\n}\n',
    after: '{\n  "rules": {\n    "no-console": "error"\n  }\n}\n',
    count: 0,
  },
]);

const WF =
  'name: ci\non: [push]\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm lint\n';
const ciCases: Case[] = [
  {
    name: 'step edited (warn)',
    path: '.github/workflows/ci.yml',
    before: WF,
    after: WF.replace('pnpm test', 'pnpm test --silent'),
    count: 1,
    severity: 'warn',
  },
  {
    name: 'permissions broadened (high)',
    path: '.github/workflows/ci.yml',
    before: WF,
    after: WF.replace('contents: read', 'contents: write'),
    count: 1,
    severity: 'high',
  },
  {
    name: 'job removed (high)',
    path: '.github/workflows/ci.yml',
    before: WF,
    after: WF.replace('  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm lint\n', ''),
    count: 1,
    severity: 'high',
  },
  {
    name: 'gitlab ci edited',
    path: '.gitlab-ci.yml',
    before: 'test:\n  script: make test\n',
    after: 'test:\n  script: make test-fast\n',
    count: 1,
  },
  { name: 'non-CI yaml', path: 'config/app.yml', before: 'a: 1\n', after: 'a: 2\n', count: 0 },
  { name: 'docs about CI', path: 'docs/ci.md', before: '# CI\n', after: '# CI pipeline\n', count: 0 },
];
table('ci_changed', ciCases);

table('dependency_added', [
  {
    name: 'npm dependency',
    path: 'package.json',
    before: '{\n  "dependencies": {\n    "zod": "4.0.0"\n  }\n}\n',
    after: '{\n  "dependencies": {\n    "left-pad": "1.3.0",\n    "zod": "4.0.0"\n  }\n}\n',
    count: 1,
    severity: 'info',
  },
  {
    name: 'pyproject dependency',
    path: 'pyproject.toml',
    before: '[project]\nname = "x"\ndependencies = [\n  "requests>=2",\n]\n',
    after: '[project]\nname = "x"\ndependencies = [\n  "requests>=2",\n  "httpx>=0.27",\n]\n',
    count: 1,
  },
  {
    name: 'cargo dev-dependency',
    path: 'Cargo.toml',
    before: '[package]\nname = "x"\n\n[dependencies]\nserde = "1"\n',
    after: '[package]\nname = "x"\n\n[dependencies]\nserde = "1"\n\n[dev-dependencies]\nproptest = "1"\n',
    count: 1,
  },
  {
    name: 'version bump only',
    path: 'package.json',
    before: '{\n  "dependencies": {\n    "zod": "4.0.0"\n  }\n}\n',
    after: '{\n  "dependencies": {\n    "zod": "4.1.0"\n  }\n}\n',
    count: 0,
  },
  {
    name: 'script added',
    path: 'package.json',
    before: '{\n  "scripts": {\n    "a": "x"\n  }\n}\n',
    after: '{\n  "scripts": {\n    "a": "x",\n    "b": "y"\n  }\n}\n',
    count: 0,
  },
]);

table('public_api_changed', [
  {
    name: 'exported function signature',
    path: 'src/users.ts',
    before: 'export function getUser(id: string) {\n  return id;\n}\n',
    after: 'export function getUser(id: string, opts: Opts) {\n  return id;\n}\n',
    count: 1,
    severity: 'warn',
  },
  {
    name: 'exported function removed',
    path: 'src/users.ts',
    before: 'export function a() {\n  return 1;\n}\n\nexport function b() {\n  return 2;\n}\n',
    after: 'export function a() {\n  return 1;\n}\n',
    count: 1,
  },
  {
    name: 'python public def changed',
    path: 'src/orders.py',
    before: 'def recent(days):\n    return days\n',
    after: 'def recent(days, limit):\n    return days\n',
    count: 1,
  },
  {
    name: 'rust pub fn changed',
    path: 'src/lib.rs',
    before: 'pub fn parse(s: &str) -> u32 {\n    0\n}\n',
    after: 'pub fn parse(s: &str, radix: u32) -> u32 {\n    0\n}\n',
    count: 1,
  },
  {
    name: 'export dropped',
    path: 'src/a.ts',
    before: 'export function a() {\n  return 1;\n}\n',
    after: 'function a() {\n  return 1;\n}\n',
    count: 1,
  },
  {
    name: 'body change only',
    path: 'src/users.ts',
    before: 'export function getUser(id: string) {\n  return id;\n}\n',
    after: 'export function getUser(id: string) {\n  return id.trim();\n}\n',
    count: 0,
  },
  {
    name: 'private python def changed',
    path: 'src/orders.py',
    before: 'def _helper(a):\n    return a\n',
    after: 'def _helper(a, b):\n    return a\n',
    count: 0,
  },
]);

table('new_symbol_unreferenced', [
  {
    name: 'new exported function, no references',
    path: 'src/export.ts',
    before: 'export const a = 1;\n',
    after: 'export const a = 1;\n\nexport function toCsv(rows: string[]) {\n  return rows.join(",");\n}\n',
    count: 1,
    severity: 'warn',
    refs: 0,
  },
  {
    name: 'new python function, no references',
    path: 'src/orders.py',
    before: 'X = 1\n',
    after: 'X = 1\n\n\ndef recent(days):\n    return days\n',
    count: 1,
    refs: 0,
  },
  {
    name: 'new rust pub fn, no references',
    path: 'src/util.rs',
    before: 'pub const X: u32 = 1;\n',
    after: 'pub const X: u32 = 1;\n\npub fn helper() -> u32 {\n    1\n}\n',
    count: 1,
    refs: 0,
  },
  {
    name: 'new function that is referenced',
    path: 'src/export.ts',
    before: 'export const a = 1;\n',
    after: 'export const a = 1;\n\nexport function toCsv(rows: string[]) {\n  return rows.join(",");\n}\n',
    count: 0,
    refs: 2,
  },
  {
    name: 'entrypoint file',
    path: 'src/index.ts',
    before: 'export const a = 1;\n',
    after: 'export const a = 1;\n\nexport function boot() {\n  return 1;\n}\n',
    count: 0,
    refs: 0,
  },
  {
    name: 'references unavailable',
    path: 'src/export.ts',
    before: 'export const a = 1;\n',
    after: 'export const a = 1;\n\nexport function toCsv() {\n  return 1;\n}\n',
    count: 0,
    refs: null,
  },
]);

const k = (...p: string[]) => p.join('');
table('secret_like', [
  {
    name: 'Anthropic key',
    path: 'src/config.ts',
    before: 'export const a = 1;\n',
    after: `export const key = "${k('sk-', 'ant-', 'api03-', 'A'.repeat(40))}";\n`,
    count: 1,
    severity: 'high',
  },
  {
    name: 'AWS key',
    path: 'deploy.yml',
    before: 'a: 1\n',
    after: `aws_key: ${k('AKIA', 'ABCDEFGHIJKLMNOP')}\n`,
    count: 1,
  },
  {
    name: 'private key',
    path: 'certs/key.txt',
    before: 'x\n',
    after: `${k('-----BEGIN ', 'PRIVATE KEY-----')}\nabc\n`,
    count: 1,
  },
  {
    name: 'high-entropy token',
    path: 'src/a.ts',
    before: 'export const a = 1;\n',
    after: `export const token = "${k('q8Zr2LxP0vN7', 'kD4mW9tY1bH6', 'sJ3fG5cE8uA0')}";\n`,
    count: 1,
  },
  {
    name: 'hex digest',
    path: 'src/a.ts',
    before: 'export const a = 1;\n',
    after: `export const sha = "${'ab12'.repeat(10)}";\n`,
    count: 0,
  },
  {
    name: 'env reference',
    path: 'src/a.ts',
    before: 'export const a = 1;\n',
    after: 'export const key = process.env.ANTHROPIC_API_KEY;\n',
    count: 0,
  },
]);

describe('fact ids and redaction', () => {
  it('numbers facts X1..Xn by unit then line and links them to units', async () => {
    const { units } = await factsFor({
      path: 'a.test.ts',
      before: ts('  expect(a).toEqual(1);\n  expect(b).toEqual(2);'),
      after: ts('  expect(a).toBeDefined();\n  expect(b).toBeTruthy();').replace(
        "it('works'",
        "it.only('works'",
      ),
    });
    const facts = units.flatMap((u) => u.facts);
    expect(facts.map((f) => f.id)).toEqual(facts.map((_, i) => `X${i + 1}`));
    expect(facts.every((f) => f.unitId === units[0]?.id)).toBe(true);
    const lines = facts.map((f) => f.line ?? 0);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });

  it('never puts the secret value in the detail', async () => {
    const secret = k('ghp_', 'Z9'.repeat(20));
    const { units } = await factsFor({
      path: 'x.ts',
      before: 'export const a = 1;\n',
      after: `export const t = "${secret}";\n`,
    });
    const detail = units[0]?.facts[0]?.detail ?? '';
    expect(detail).toMatch(/redacted/);
    expect(detail).not.toContain(secret);
  });

  it('warns once when references are unavailable', async () => {
    const r = await factsFor({
      path: 'src/e.ts',
      before: 'export const a = 1;\n',
      after: 'export const a = 1;\n\nexport function x() {}\n\nexport function y() {}\n',
    });
    expect(r.warnings).toEqual([
      'new_symbol_unreferenced is unavailable: the head tree could not be searched.',
    ]);
  });

  it('skips filtered units', async () => {
    const { units } = await factsFor({ path: 'dist/a.js', before: 'a\n', after: `// @ts-ignore\n${'b'}\n` });
    expect(units[0]?.facts).toEqual([]);
  });

  it('entropy and secretKind basics', () => {
    expect(entropy('aaaa')).toBe(0);
    expect(entropy('abcd')).toBe(2);
    expect(secretKind('no secrets here')).toBeNull();
  });
});

describe('secret_like and GitHub node ids (dogfood M7)', () => {
  it('ignores GraphQL node ids but still flags key patterns on the same kind of line', () => {
    expect(secretKind('  "node_id": "MDIzOkludGVncmF0aW9uSW5zdGFsbGF0aW9uNDI0Mg==",')).toBeNull();
    const key = ['sk', 'ant', 'api03', 'a'.repeat(30)].join('-');
    expect(secretKind(`  "node_id": "${key}",`)).toBe('Anthropic API key');
    expect(secretKind('  "token": "MDIzOkludGVncmF0aW9uSW5zdGFsbGF0aW9uNDI0Mg==",')).toBe(
      'high-entropy token',
    );
  });
});
