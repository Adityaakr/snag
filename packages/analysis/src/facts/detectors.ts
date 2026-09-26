/**
 * Code-fact detectors (BUILD_PROMPT 6.4.2). Each one is plain code over a unit's changed lines: no model calls.
 * Detectors return drafts; the runner assigns ids (X1..Xn) and attaches them to units.
 */
import type { ChangeUnit, CodeFactKind, Language, Severity } from '@remit/core';
import {
  countMatches,
  isLiteral,
  type Line,
  type LineView,
  parenBody,
  splitArgs,
  type UnitViews,
} from './lines.js';

export interface FactDraft {
  kind: CodeFactKind;
  severity: Severity;
  line?: number;
  detail: string;
}

/** File-level context a detector may need beyond its own unit. */
export interface DetectorContext {
  /** Every changed line of the unit's file across all units (for moves inside a file). */
  fileView: LineView;
  /** File contents at base and head, when available. */
  baseText: string | null;
  headText: string | null;
}

export type LangGroup = 'js' | 'py' | 'rs';

export function langGroup(lang: Language): LangGroup | null {
  if (lang === 'ts' || lang === 'tsx' || lang === 'js') return 'js';
  if (lang === 'py') return 'py';
  if (lang === 'rs') return 'rs';
  return null;
}

export interface Detector {
  kind: CodeFactKind;
  /** Language groups the detector understands; `all` for language-independent detectors. */
  languages: LangGroup[] | 'all';
  appliesTo?: (unit: ChangeUnit) => boolean;
  detect(v: UnitViews, ctx: DetectorContext): FactDraft[];
}

const isTest = (u: ChangeUnit) => u.kind === 'test';
const shorten = (s: string, n = 80) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Added lines whose pattern count exceeds the deleted lines' count (so moved code does not trigger). */
function netAdded(view: LineView, re: RegExp): Line[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const removed = view.dels.reduce((n, l) => n + countMatches(l.content, g), 0);
  let budget = removed;
  const out: Line[] = [];
  for (const l of view.adds) {
    const n = countMatches(l.content, g);
    if (n === 0) continue;
    if (budget >= n) budget -= n;
    else {
      budget = 0;
      out.push(l);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- assertions

const ASSERTION: Record<LangGroup, RegExp> = {
  js: /\bexpect\s*\(|\bassert(?:\.\w+)?\s*\(|\.should\b/g,
  py: /^\s*assert\b|\bself\.assert\w+\s*\(|\bpytest\.raises\s*\(|\bnp\.testing\.assert_\w+\s*\(/gm,
  rs: /\b(?:debug_)?assert(?:_eq|_ne)?!\s*\(/g,
};

const assertionRemoved: Detector = {
  kind: 'assertion_removed',
  languages: ['js', 'py', 'rs'],
  appliesTo: isTest,
  detect({ unit, code: judge }) {
    const g = langGroup(unit.language);
    if (!g) return [];
    const re = ASSERTION[g];
    // A test that is deleted outright is reported as test_deleted instead.
    if (unit.before !== undefined && unit.after === undefined) return [];
    let before: number;
    let after: number;
    if (unit.before !== undefined && unit.after !== undefined) {
      before = countMatches(unit.before, re);
      after = countMatches(unit.after, re);
    } else {
      before = judge.dels.reduce((n, l) => n + countMatches(l.content, re), 0);
      after = judge.adds.reduce((n, l) => n + countMatches(l.content, re), 0);
    }
    if (after >= before) return [];
    const where = judge.dels.find((l) => countMatches(l.content, re) > 0);
    return [
      {
        kind: 'assertion_removed',
        severity: 'high',
        ...(where ? { line: where.line } : {}),
        detail: `assertions in ${unit.symbol ? `\`${unit.symbol.name}\`` : 'this test'} went from ${before} to ${after}`,
      },
    ];
  },
};

interface WeakeningPair {
  lang: LangGroup;
  strict: RegExp;
  loose: RegExp;
}

/** Stricter matcher replaced by a looser one (BUILD_PROMPT 6.4.2 weakening pairs, extended). */
export const WEAKENING_PAIRS: WeakeningPair[] = [
  { lang: 'js', strict: /\.toStrictEqual\s*\(/, loose: /\.toEqual\s*\(/ },
  {
    lang: 'js',
    strict: /\.(?:toEqual|toBe|toStrictEqual)\s*\(/,
    loose:
      /\.(?:toBeTruthy|toBeDefined|toBeTypeOf|toBeInstanceOf)\s*\(|expect\.anything\(\)|\.not\.(?:toBeNull|toBeUndefined)\s*\(/,
  },
  { lang: 'js', strict: /\.toThrow(?:Error)?\s*\(\s*[^)\s]/, loose: /\.toThrow(?:Error)?\s*\(\s*\)/ },
  { lang: 'js', strict: /\.toHaveBeenCalled(?:With|Times)\s*\(/, loose: /\.toHaveBeenCalled\s*\(\s*\)/ },
  { lang: 'js', strict: /\.toHaveLength\s*\(/, loose: /\.(?:toBeTruthy|toBeDefined)\s*\(/ },
  { lang: 'py', strict: /\bassertEqual\s*\(/, loose: /\bassert(?:True|IsNotNone|IsInstance)\s*\(/ },
  {
    lang: 'py',
    strict: /\bpytest\.raises\s*\([^)]*\bmatch\s*=/,
    loose: /\bpytest\.raises\s*\((?![^)]*\bmatch\s*=)/,
  },
  { lang: 'py', strict: /^\s*assert\s+.+(?:==|!=|\bin\b)/, loose: /^\s*assert\s+(?!.*(?:==|!=|\bin\b))\S/ },
  {
    lang: 'rs',
    strict: /\bassert_eq!\s*\(/,
    loose: /\bassert!\s*\(.*\.(?:is_ok|is_some|is_err|is_none)\(\)/,
  },
  { lang: 'rs', strict: /\bassert_eq!\s*\(/, loose: /\bassert!\s*\(\s*[^=]*\)\s*;?\s*$/ },
];

const matchText = (s: string, re: RegExp) => re.exec(s)?.[0]?.trim() ?? '';

const assertionWeakened: Detector = {
  kind: 'assertion_weakened',
  languages: ['js', 'py', 'rs'],
  appliesTo: isTest,
  detect({ unit, code: judge }) {
    const g = langGroup(unit.language);
    const out: FactDraft[] = [];
    for (const block of judge.blocks) {
      const used = new Set<Line>();
      for (const del of block.dels) {
        for (const pair of WEAKENING_PAIRS) {
          if (pair.lang !== g || !pair.strict.test(del.content)) continue;
          const add = block.adds.find(
            (a) => !used.has(a) && pair.loose.test(a.content) && !pair.strict.test(a.content),
          );
          if (!add) continue;
          used.add(add);
          out.push({
            kind: 'assertion_weakened',
            severity: 'high',
            line: add.line,
            detail: `assertion loosened from \`${shorten(matchText(del.content, pair.strict), 40)}\` to \`${shorten(matchText(add.content, pair.loose), 40)}\``,
          });
          break;
        }
      }
    }
    return out;
  },
};

interface Assertion {
  shape: string;
  subject: string;
  expected: string;
}

/** Parses one assertion line into (shape, subject, expected), or null. */
export function parseAssertion(content: string, g: LangGroup): Assertion | null {
  const text = content.trim().replace(/;$/, '');
  if (g === 'js') {
    const m = /\bexpect\s*\(/.exec(text);
    if (!m) return null;
    const open = m.index + m[0].length - 1;
    const subject = parenBody(text, open);
    if (subject === null) return null;
    const rest = text.slice(open + subject.length + 2);
    const mm =
      /^\.((?:not\.)?(?:toBe|toEqual|toStrictEqual|toHaveLength|toContain|toMatch|toBeCloseTo|toHaveProperty))\s*\(/.exec(
        rest,
      );
    if (!mm) return null;
    const args = parenBody(rest, mm[0].length - 1);
    if (args === null) return null;
    return { shape: `expect.${mm[1]}`, subject: subject.trim(), expected: splitArgs(args)[0] ?? '' };
  }
  if (g === 'py') {
    const eq = /^assert\s+(.+?)\s*==\s*(.+)$/.exec(text);
    if (eq) return { shape: 'assert==', subject: eq[1] as string, expected: (eq[2] as string).trim() };
    const m = /\bself\.assert(Equal|Equals|AlmostEqual)\s*\(/.exec(text);
    if (m) {
      const args = parenBody(text, m.index + m[0].length - 1);
      const [a, b] = args ? splitArgs(args) : [];
      if (a !== undefined && b !== undefined) return { shape: `assert${m[1]}`, subject: a, expected: b };
    }
    return null;
  }
  const m = /\bassert_(eq|ne)!\s*\(/.exec(text);
  if (!m) return null;
  const args = parenBody(text, m.index + m[0].length - 1);
  const [a, b] = args ? splitArgs(args) : [];
  return a !== undefined && b !== undefined ? { shape: `assert_${m[1]}`, subject: a, expected: b } : null;
}

const expectedValueChanged: Detector = {
  kind: 'expected_value_changed',
  languages: ['js', 'py', 'rs'],
  appliesTo: isTest,
  detect({ unit, judge }) {
    const g = langGroup(unit.language);
    if (!g) return [];
    const out: FactDraft[] = [];
    for (const block of judge.blocks) {
      for (const del of block.dels) {
        const a = parseAssertion(del.content, g);
        if (!a) continue;
        for (const add of block.adds) {
          const b = parseAssertion(add.content, g);
          if (!b || b.shape !== a.shape || b.subject.replace(/\s/g, '') !== a.subject.replace(/\s/g, ''))
            continue;
          if (b.expected.replace(/\s/g, '') === a.expected.replace(/\s/g, '')) continue;
          if (!isLiteral(b.expected) && !isLiteral(a.expected)) continue;
          out.push({
            kind: 'expected_value_changed',
            severity: 'warn',
            line: add.line,
            detail: `expected value for \`${shorten(a.subject, 40)}\` changed from \`${shorten(a.expected, 30)}\` to \`${shorten(b.expected, 30)}\``,
          });
          break;
        }
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------- test markers

const SKIP: Record<LangGroup, RegExp> = {
  js: /\b(?:it|test|describe|suite|context)\.skip\b|\bx(?:it|test|describe)\s*\(|\b(?:it|test)\.todo\s*\(|\.skipIf\s*\(/,
  py: /@pytest\.mark\.(?:skip|skipif|xfail)\b|@unittest\.(?:skip\w*|expectedFailure)\b|\bpytest\.skip\s*\(|\bself\.skipTest\s*\(/,
  rs: /#\[\s*ignore\b/,
};

const testSkipped: Detector = {
  kind: 'test_skipped',
  languages: 'all',
  appliesTo: (u) => isTest(u) || u.language === 'rs',
  detect({ unit, code: judge }) {
    const g = langGroup(unit.language);
    const patterns = g ? [SKIP[g]] : Object.values(SKIP);
    return patterns.flatMap((re) =>
      netAdded(judge, re).map((l) => ({
        kind: 'test_skipped' as const,
        severity: 'high' as const,
        line: l.line,
        detail: `skip marker added: \`${shorten(matchText(l.content, re), 40)}\``,
      })),
    );
  },
};

const FOCUS = /\b(?:it|test|describe|suite|context)\.only\b|\bf(?:it|describe)\s*\(/;

const testFocused: Detector = {
  kind: 'test_focused',
  languages: ['js'],
  appliesTo: isTest,
  detect({ code: judge }) {
    return netAdded(judge, FOCUS).map((l) => ({
      kind: 'test_focused',
      severity: 'high',
      line: l.line,
      detail: `focus marker added, so other tests stop running: \`${shorten(matchText(l.content, FOCUS), 40)}\``,
    }));
  },
};

const testDeleted: Detector = {
  kind: 'test_deleted',
  languages: 'all',
  appliesTo: isTest,
  detect({ unit }) {
    const first = unit.lines.old[0]?.[0];
    if (unit.changeType === 'deleted') {
      return [
        {
          kind: 'test_deleted',
          severity: 'high',
          ...(first ? { line: first } : {}),
          detail: `test file \`${unit.file}\` deleted`,
        },
      ];
    }
    if (unit.symbol?.kind === 'test' && unit.before !== undefined && unit.after === undefined) {
      return [
        {
          kind: 'test_deleted',
          severity: 'high',
          ...(first ? { line: first } : {}),
          detail: `test \`${shorten(unit.symbol.name, 60)}\` deleted`,
        },
      ];
    }
    return [];
  },
};

const snapshotUpdated: Detector = {
  kind: 'snapshot_updated',
  languages: 'all',
  appliesTo: (u) => /(^|\/)__snapshots__\//.test(u.file) || u.file.endsWith('.snap'),
  detect({ unit }) {
    const line = unit.lines.new[0]?.[0] ?? unit.lines.old[0]?.[0];
    return [
      {
        kind: 'snapshot_updated',
        severity: 'warn',
        ...(line ? { line } : {}),
        detail: `snapshot \`${unit.file}\` changed`,
      },
    ];
  },
};

// ---------------------------------------------------------------------------------------------- numbers

const WIDER_IS_LOOSER = [
  'rel',
  'abs',
  'rtol',
  'atol',
  'rel_tol',
  'abs_tol',
  'delta',
  'tolerance',
  'epsilon',
  'eps',
];
const FEWER_IS_LOOSER = ['places', 'numDigits', 'digits'];

/** Numeric keyword arguments on a line, for example `rel=1e-6` or `abs: 0.1`. */
function numericKwargs(content: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of content.matchAll(/\b([A-Za-z_]\w*)\s*[=:]\s*(-?\d[\d_]*(?:\.\d+)?(?:[eE][-+]?\d+)?)/g)) {
    out.set(m[1] as string, Number((m[2] as string).replace(/_/g, '')));
  }
  return out;
}

/** The digits argument of `toBeCloseTo(x, d)`; 2 when omitted (Jest and Vitest default). */
function closeToDigits(content: string): number | null {
  const m = /\.toBeCloseTo\s*\(/.exec(content);
  if (!m) return null;
  const args = parenBody(content, m.index + m[0].length - 1);
  if (args === null) return null;
  const parts = splitArgs(args);
  return parts[1] !== undefined ? Number(parts[1]) : 2;
}

const toleranceWidened: Detector = {
  kind: 'tolerance_widened',
  languages: ['js', 'py'],
  appliesTo: isTest,
  detect({ judge }) {
    const out: FactDraft[] = [];
    for (const block of judge.blocks) {
      for (const add of block.adds) {
        let detail: string | null = null;
        for (const del of block.dels) {
          const a = numericKwargs(del.content);
          const b = numericKwargs(add.content);
          for (const [k, v] of b) {
            const old = a.get(k);
            if (old === undefined) continue;
            if (WIDER_IS_LOOSER.includes(k) && v > old)
              detail = `tolerance \`${k}\` widened from \`${old}\` to \`${v}\``;
            if (FEWER_IS_LOOSER.includes(k) && v < old)
              detail = `precision \`${k}\` reduced from \`${old}\` to \`${v}\``;
          }
          const dOld = closeToDigits(del.content);
          const dNew = closeToDigits(add.content);
          if (dOld !== null && dNew !== null && dNew < dOld)
            detail = `\`toBeCloseTo\` digits reduced from \`${dOld}\` to \`${dNew}\``;
          if (dNew !== null && dOld === null && /\.to(?:Be|Equal|StrictEqual)\s*\(/.test(del.content)) {
            detail = 'exact match replaced by `toBeCloseTo`';
          }
          if (
            /\bapprox\s*\(/.test(add.content) &&
            !/\bapprox\s*\(/.test(del.content) &&
            /==/.test(del.content)
          ) {
            detail = 'exact comparison replaced by `approx`';
          }
          if (detail) break;
        }
        if (detail) out.push({ kind: 'tolerance_widened', severity: 'warn', line: add.line, detail });
      }
    }
    return out;
  },
};

const RETRY =
  /\b(?:jest|vi)\.retryTimes\s*\(|\bretry\s*:\s*\d+|\bretries\s*[:=]\s*\d+|@pytest\.mark\.flaky\b|@flaky\b|--reruns\b|\breruns\s*=|\.retries\s*\(|@retry\b|\bflaky\s*=\s*True/;
const TIMEOUT_KEYS =
  /\b(testTimeout|hookTimeout|timeout|jest\.setTimeout|timeout_ms|timeoutMs)\b\s*[:=(]\s*(\d[\d_]*)/g;
const IT_TIMEOUT_ARG = /\b(?:it|test)\s*\(.*,\s*(\d{3,}[\d_]*)\s*\)\s*;?\s*$/;
const PYTEST_TIMEOUT = /@pytest\.mark\.timeout\s*\(\s*(\d+)/;

function timeouts(content: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of content.matchAll(TIMEOUT_KEYS))
    out.set(m[1] as string, Number((m[2] as string).replace(/_/g, '')));
  const it = IT_TIMEOUT_ARG.exec(content);
  if (it) out.set('test-arg', Number((it[1] as string).replace(/_/g, '')));
  const py = PYTEST_TIMEOUT.exec(content);
  if (py) out.set('pytest.mark.timeout', Number(py[1]));
  return out;
}

const isTestConfig = (u: ChangeUnit) =>
  u.kind === 'config' &&
  /(jest|vitest|pytest|playwright|cypress|karma|mocha|conftest|pyproject|setup\.cfg|tox)/i.test(u.file);

const retryOrTimeoutAdded: Detector = {
  kind: 'retry_or_timeout_added',
  languages: 'all',
  appliesTo: (u) => isTest(u) || isTestConfig(u),
  detect({ code: judge }) {
    const out: FactDraft[] = netAdded(judge, RETRY).map((l) => ({
      kind: 'retry_or_timeout_added' as const,
      severity: 'warn' as const,
      line: l.line,
      detail: `retry or flaky marker added: \`${shorten(matchText(l.content, RETRY), 40)}\``,
    }));
    const before = new Map<string, number>();
    for (const l of judge.dels)
      for (const [k, v] of timeouts(l.content)) before.set(k, Math.max(before.get(k) ?? 0, v));
    for (const l of judge.adds) {
      for (const [k, v] of timeouts(l.content)) {
        const old = before.get(k);
        if (old === undefined || v > old) {
          out.push({
            kind: 'retry_or_timeout_added',
            severity: 'warn',
            line: l.line,
            detail:
              old === undefined
                ? `timeout \`${k}\` set to \`${v}\``
                : `timeout \`${k}\` raised from \`${old}\` to \`${v}\``,
          });
        }
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------- suppression and errors

const SUPPRESSION =
  /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|biome-ignore|#\s*noqa\b|#\s*type:\s*ignore|pragma:\s*no\s*cover|#!?\[allow\(|pylint:\s*disable|\bnolint\b|istanbul\s+ignore|[cv]8\s+ignore|NOSONAR/;

const suppressionAdded: Detector = {
  kind: 'suppression_added',
  languages: 'all',
  detect({ raw }) {
    return netAdded(raw, SUPPRESSION).map((l) => ({
      kind: 'suppression_added',
      severity: 'warn',
      line: l.line,
      detail: `check suppressed: \`${shorten(matchText(l.content, SUPPRESSION), 40)}\``,
    }));
  },
};

const catchBroadened: Detector = {
  kind: 'catch_broadened',
  languages: ['js', 'py', 'rs'],
  detect({ unit, code: judge }) {
    const g = langGroup(unit.language);
    const out: FactDraft[] = [];
    const push = (l: Line, detail: string) =>
      out.push({ kind: 'catch_broadened', severity: 'warn', line: l.line, detail });
    const adds = judge.adds;
    if (g === 'js') {
      for (const l of netAdded(judge, /\bcatch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}/))
        push(l, 'empty `catch` block added');
      for (const l of netAdded(
        judge,
        /\.catch\s*\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*(?:\{\s*\}|undefined|null|void 0)\s*\)/,
      )) {
        push(l, 'promise errors swallowed with an empty `.catch`');
      }
      adds.forEach((l, i) => {
        const next = adds[i + 1];
        if (
          /\bcatch\s*(?:\(\s*\w*\s*\))?\s*\{\s*$/.test(l.content) &&
          next &&
          next.line === l.line + 1 &&
          /^\s*\}/.test(next.content)
        ) {
          push(l, 'empty `catch` block added');
        }
      });
    } else if (g === 'py') {
      for (const l of netAdded(judge, /^\s*except\s*:/)) push(l, 'bare `except:` added');
      adds.forEach((l, i) => {
        const broad =
          /^\s*except\s+(?:Exception|BaseException)(?:\s+as\s+\w+)?\s*:\s*(pass|\.\.\.)?\s*$/.exec(l.content);
        if (!broad) return;
        const next = adds[i + 1];
        const swallows =
          broad[1] !== undefined ||
          (next && next.line === l.line + 1 && /^\s*(pass|\.\.\.)\s*$/.test(next.content));
        if (swallows) push(l, '`except Exception` that swallows errors added');
      });
    } else if (g === 'rs') {
      for (const block of judge.blocks) {
        const propagated = block.dels.some((d) => /\?\s*(?:[;.),]|$)/.test(d.content));
        for (const a of block.adds) {
          if (/\.unwrap_or_default\s*\(\s*\)/.test(a.content) && propagated)
            push(a, 'error propagation (`?`) replaced by `unwrap_or_default()`');
        }
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------- config and CI

const COVERAGE_KEYS =
  /["']?\b(lines|branches|functions|statements|fail_under|fail-under|cov-fail-under|minimum_coverage|min_coverage|coverage_threshold|threshold|global)\b["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/gi;
const SEVERITY = /["']?([\w@/-]+)["']?\s*[:=]\s*\[?\s*["']?(error|warn|warning|off|2|1|0)\b/g;
const SEVERITY_RANK: Record<string, number> = {
  error: 2,
  '2': 2,
  warn: 1,
  warning: 1,
  '1': 1,
  off: 0,
  '0': 0,
};
const MAX_WARNINGS = /--max-warnings[=\s]+(\d+)/;

const thresholdLowered: Detector = {
  kind: 'threshold_lowered',
  languages: 'all',
  appliesTo: (u) => u.kind === 'config' || u.kind === 'ci' || u.kind === 'build',
  detect({ judge }) {
    const out: FactDraft[] = [];
    for (const block of judge.blocks) {
      const oldCov = new Map<string, number>();
      const oldSev = new Map<string, number>();
      let oldMax: number | null = null;
      for (const d of block.dels) {
        for (const m of d.content.matchAll(COVERAGE_KEYS))
          oldCov.set((m[1] as string).toLowerCase(), Number(m[2]));
        for (const m of d.content.matchAll(SEVERITY))
          oldSev.set(m[1] as string, SEVERITY_RANK[(m[2] as string).toLowerCase()] ?? 0);
        const mw = MAX_WARNINGS.exec(d.content);
        if (mw) oldMax = Number(mw[1]);
      }
      for (const a of block.adds) {
        for (const m of a.content.matchAll(COVERAGE_KEYS)) {
          const key = (m[1] as string).toLowerCase();
          const old = oldCov.get(key);
          if (old !== undefined && Number(m[2]) < old) {
            out.push({
              kind: 'threshold_lowered',
              severity: 'high',
              line: a.line,
              detail: `\`${key}\` threshold lowered from \`${old}\` to \`${m[2]}\``,
            });
          }
        }
        for (const m of a.content.matchAll(SEVERITY)) {
          const old = oldSev.get(m[1] as string);
          const now = SEVERITY_RANK[(m[2] as string).toLowerCase()] ?? 0;
          if (old !== undefined && now < old) {
            out.push({
              kind: 'threshold_lowered',
              severity: 'high',
              line: a.line,
              detail: `rule \`${m[1]}\` severity lowered to \`${m[2]}\``,
            });
          }
        }
        const mw = MAX_WARNINGS.exec(a.content);
        if (mw && oldMax !== null && Number(mw[1]) > oldMax) {
          out.push({
            kind: 'threshold_lowered',
            severity: 'high',
            line: a.line,
            detail: `\`--max-warnings\` raised from \`${oldMax}\` to \`${mw[1]}\``,
          });
        }
      }
    }
    return out;
  },
};

const PERMISSION_WRITE =
  /\b(?:contents|packages|id-token|actions|pull-requests|issues|deployments|checks|statuses|security-events|pages|attestations)\s*:\s*write\b|permissions\s*:\s*write-all/;

const ciChanged: Detector = {
  kind: 'ci_changed',
  languages: 'all',
  appliesTo: (u) => u.kind === 'ci',
  detect({ unit, judge, raw }) {
    const first = unit.lines.new[0]?.[0] ?? unit.lines.old[0]?.[0];
    const broadened = netAdded(judge, PERMISSION_WRITE)[0];
    if (broadened)
      return [
        {
          kind: 'ci_changed',
          severity: 'high',
          line: broadened.line,
          detail: 'CI workflow permissions broadened',
        },
      ];
    const target = netAdded(raw, /\bpull_request_target\b/)[0];
    if (target)
      return [
        {
          kind: 'ci_changed',
          severity: 'high',
          line: target.line,
          detail: 'CI now runs on `pull_request_target`',
        },
      ];
    const jobKey = /^ {2}([\w-]+):\s*$/;
    const addedJobs = new Set(judge.adds.map((l) => jobKey.exec(l.content)?.[1]).filter(Boolean));
    const removed = judge.dels.find((l) => {
      const k = jobKey.exec(l.content)?.[1];
      return k && !addedJobs.has(k) && !['on', 'env', 'permissions', 'defaults', 'concurrency'].includes(k);
    });
    if (removed) {
      return [
        {
          kind: 'ci_changed',
          severity: 'high',
          line: removed.line,
          detail: `CI job \`${jobKey.exec(removed.content)?.[1]}\` removed`,
        },
      ];
    }
    return [
      {
        kind: 'ci_changed',
        severity: 'warn',
        ...(first ? { line: first } : {}),
        detail: `CI workflow \`${unit.file}\` edited`,
      },
    ];
  },
};

export const DETECTORS: Detector[] = [
  assertionRemoved,
  assertionWeakened,
  expectedValueChanged,
  testSkipped,
  testFocused,
  testDeleted,
  snapshotUpdated,
  toleranceWidened,
  retryOrTimeoutAdded,
  suppressionAdded,
  catchBroadened,
  thresholdLowered,
  ciChanged,
];
