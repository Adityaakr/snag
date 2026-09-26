/**
 * `public_api_changed` and `new_symbol_unreferenced` (BUILD_PROMPT 6.4.2). Both read declaration lines:
 * exported or top-level functions and classes in TS/JS, Python and Rust.
 */
import type { ChangeUnit } from '@remit/core';
import { type Detector, type FactDraft, type LangGroup, langGroup } from './detectors.js';
import type { Line, LineView } from './lines.js';

export interface Declaration {
  name: string;
  kind: 'function' | 'class' | 'type';
  exported: boolean;
  /** Whitespace-normalized declaration line up to the body, used to compare signatures. */
  signature: string;
  line: number;
}

const DECLS: Record<
  LangGroup,
  { re: RegExp; kind: Declaration['kind']; exported: (m: RegExpExecArray) => boolean }[]
> = {
  js: [
    {
      re: /^(export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
      kind: 'function',
      exported: (m) => !!m[1],
    },
    {
      re: /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
      kind: 'function',
      exported: (m) => !!m[1],
    },
    {
      re: /^(export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
      kind: 'class',
      exported: (m) => !!m[1],
    },
    { re: /^(export\s+)(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/, kind: 'type', exported: () => true },
  ],
  py: [
    {
      re: /^(?:async\s+)?def\s+([A-Za-z_]\w*)/,
      kind: 'function',
      exported: (m) => !(m[1] as string).startsWith('_'),
    },
    { re: /^class\s+([A-Za-z_]\w*)/, kind: 'class', exported: (m) => !(m[1] as string).startsWith('_') },
  ],
  rs: [
    {
      re: /^\s*(pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/,
      kind: 'function',
      exported: (m) => !!m[1],
    },
    {
      re: /^(pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|union)\s+([A-Za-z_]\w*)/,
      kind: 'class',
      exported: (m) => !!m[1],
    },
  ],
};

/** Reads a declaration from one line, or null. Python declarations count only at column 0. */
export function declarationOf(content: string, line: number, g: LangGroup): Declaration | null {
  for (const d of DECLS[g]) {
    const m = d.re.exec(content);
    if (!m) continue;
    const name = (g === 'py' ? m[1] : m[2]) as string;
    const sig = content
      .replace(/\s*[{:]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    return { name, kind: d.kind, exported: d.exported(m), signature: sig, line };
  }
  return null;
}

function decls(lines: readonly Line[], g: LangGroup): Declaration[] {
  return lines.flatMap((l) => {
    const d = declarationOf(l.content, l.line, g);
    return d ? [d] : [];
  });
}

export const publicApiChanged: Detector = {
  kind: 'public_api_changed',
  languages: ['js', 'py', 'rs'],
  appliesTo: (u) => u.kind === 'source',
  detect({ unit, judge }, ctx) {
    const g = langGroup(unit.language);
    if (!g) return [];
    const removed = decls(judge.dels, g).filter((d) => d.exported);
    const fileAdds = decls(ctx.fileView.adds, g);
    const out: FactDraft[] = [];
    for (const old of removed) {
      const now = fileAdds.find((d) => d.name === old.name && d.kind === old.kind);
      if (!now) {
        // Still declared, unchanged, elsewhere in the head file? Then it only moved.
        const stillThere = ctx.headText
          ?.split('\n')
          .some((l) => declarationOf(l, 0, g)?.signature === old.signature);
        if (!stillThere) {
          out.push({
            kind: 'public_api_changed',
            severity: 'warn',
            line: old.line,
            detail: `exported ${old.kind} \`${old.name}\` removed`,
          });
        }
      } else if (!now.exported) {
        out.push({
          kind: 'public_api_changed',
          severity: 'warn',
          line: now.line,
          detail: `\`${old.name}\` is no longer exported`,
        });
      } else if (now.signature !== old.signature && old.kind !== 'type' && old.kind !== 'class') {
        out.push({
          kind: 'public_api_changed',
          severity: 'warn',
          line: now.line,
          detail: `signature of exported ${old.kind} \`${old.name}\` changed`,
        });
      }
    }
    return out;
  },
};

/** Counts references to a name in the head tree, excluding tests and the definition line. Null when unavailable. */
export interface ReferenceIndex {
  count(name: string, definedAt: { file: string; line: number }): Promise<number | null>;
}

const ENTRYPOINT =
  /(^|\/)(index|main|cli|app|server|__main__|__init__|mod|lib|build|setup|conftest|manage|wsgi|asgi)\.[a-z]+$|(^|\/)(bin|cmd|scripts|pages|app|routes)\//;
const ENTRY_NAMES = new Set(['main', 'default', 'handler', 'setup', 'teardown', 'run']);

/** New top-level or exported functions and classes in a unit (not present in the file's deleted lines). */
export function newDeclarations(unit: ChangeUnit, judge: LineView, fileView: LineView): Declaration[] {
  const g = langGroup(unit.language);
  if (!g || unit.kind !== 'source' || ENTRYPOINT.test(unit.file)) return [];
  const before = new Set(decls(fileView.dels, g).map((d) => d.name));
  return decls(judge.adds, g).filter(
    (d) =>
      d.kind !== 'type' &&
      !before.has(d.name) &&
      !ENTRY_NAMES.has(d.name) &&
      !d.name.startsWith('__') &&
      // Rust and JS: exported or at column 0; Python declarations are column 0 by construction.
      (d.exported || !/^\s/.test(judge.adds.find((l) => l.line === d.line)?.content ?? ' ')),
  );
}
