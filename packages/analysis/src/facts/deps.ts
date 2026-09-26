/**
 * `dependency_added` (BUILD_PROMPT 6.4.2): new entries in package.json, pyproject.toml or Cargo.toml.
 * Compares dependency names in the base and head manifests; falls back to added lines without contents.
 */
import type { Detector, FactDraft } from './detectors.js';
import type { Line } from './lines.js';

const JS_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function packageJsonDeps(text: string): Set<string> | null {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const names = new Set<string>();
    for (const s of JS_SECTIONS) {
      const section = json[s];
      if (section && typeof section === 'object') for (const k of Object.keys(section)) names.add(k);
    }
    return names;
  } catch {
    return null;
  }
}

/** Splits TOML into `[table]` sections (naive but enough for dependency tables). */
function tomlSections(text: string): { table: string; lines: string[] }[] {
  const out: { table: string; lines: string[] }[] = [{ table: '', lines: [] }];
  for (const line of text.split('\n')) {
    const m = /^\s*\[\[?([^\]]+)\]\]?\s*$/.exec(line);
    if (m) out.push({ table: (m[1] as string).trim(), lines: [] });
    else out[out.length - 1]?.lines.push(line);
  }
  return out;
}

const PEP508_NAME = /^\s*["']([A-Za-z0-9][A-Za-z0-9._-]*)/;

function pyprojectDeps(text: string): Set<string> {
  const names = new Set<string>();
  for (const { table, lines } of tomlSections(text)) {
    if (
      table === 'tool.poetry.dependencies' ||
      table === 'tool.poetry.dev-dependencies' ||
      /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(table)
    ) {
      for (const l of lines) {
        const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(l);
        if (m && m[1] !== 'python') names.add((m[1] as string).toLowerCase());
      }
      continue;
    }
    if (table === 'project' || table === 'project.optional-dependencies' || table === 'dependency-groups') {
      let inList = table !== 'project';
      for (const l of lines) {
        if (table === 'project' && /^\s*dependencies\s*=\s*\[/.test(l)) inList = true;
        if (!inList) continue;
        const items = l.replace(/^\s*[\w-]+\s*=\s*\[/, '').split(',');
        for (const item of items) {
          const m = PEP508_NAME.exec(item);
          if (m) names.add((m[1] as string).toLowerCase());
        }
        if (table === 'project' && /\]\s*$/.test(l)) inList = false;
      }
    }
  }
  return names;
}

function cargoDeps(text: string): Set<string> {
  const names = new Set<string>();
  for (const { table, lines } of tomlSections(text)) {
    const dotted = /^(?:target\.[^.]+(?:\.[^.]+)*\.)?(?:dev-|build-)?dependencies\.([A-Za-z0-9_-]+)$/.exec(
      table,
    );
    if (dotted) {
      names.add(dotted[1] as string);
      continue;
    }
    if (!/^(?:target\..+\.)?(?:dev-|build-)?dependencies$/.test(table) && table !== 'workspace.dependencies')
      continue;
    for (const l of lines) {
      const m = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(l);
      if (m) names.add(m[1] as string);
    }
  }
  return names;
}

export type ManifestKind = 'npm' | 'pyproject' | 'cargo';

export function manifestKind(file: string): ManifestKind | null {
  const base = file.slice(file.lastIndexOf('/') + 1);
  if (base === 'package.json') return 'npm';
  if (base === 'pyproject.toml') return 'pyproject';
  if (base === 'Cargo.toml') return 'cargo';
  return null;
}

/** Dependency names declared in a manifest, or null when it cannot be parsed. */
export function dependencyNames(kind: ManifestKind, text: string): Set<string> | null {
  if (kind === 'npm') return packageJsonDeps(text);
  if (kind === 'pyproject') return pyprojectDeps(text);
  return cargoDeps(text);
}

function lineOf(text: string, name: string, kind: ManifestKind): number | undefined {
  const lines = text.split('\n');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re =
    kind === 'npm'
      ? new RegExp(`"${esc}"\\s*:`)
      : new RegExp(`(^|["'\\s.\\[])${esc}(["'\\s=<>~!;\\[\\]]|$)`, 'i');
  const i = lines.findIndex((l) => re.test(l));
  return i === -1 ? undefined : i + 1;
}

const FALLBACK: Record<ManifestKind, RegExp> = {
  npm: /^\s*"(@?[\w./-]+)"\s*:\s*"(?:\^|~|>=?|<=?|=|\d|\*|workspace:|npm:|file:|link:|git|https?:|latest|next)/,
  pyproject: /^\s*["']([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:[<>=!~;[\]]|["'])/,
  cargo: /^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"[\d^~*<>=]|\{)/,
};

export const dependencyAdded: Detector = {
  kind: 'dependency_added',
  languages: 'all',
  appliesTo: (u) => manifestKind(u.file) !== null,
  detect({ unit, judge }, ctx) {
    const kind = manifestKind(unit.file);
    if (!kind) return [];
    const head = ctx.headText ? dependencyNames(kind, ctx.headText) : null;
    const base =
      ctx.baseText !== null
        ? dependencyNames(kind, ctx.baseText)
        : unit.changeType === 'added'
          ? new Set<string>()
          : null;
    const inUnit = (line: number | undefined) =>
      line !== undefined && unit.lines.new.some(([a, b]) => line >= a && line <= b);
    if (head && base && ctx.headText) {
      return [...head]
        .filter((n) => !base.has(n))
        .map((name) => ({ name, line: lineOf(ctx.headText as string, name, kind) }))
        .filter(({ line }) => inUnit(line) || unit.lines.new.length === 0)
        .map(
          ({ name, line }): FactDraft => ({
            kind: 'dependency_added',
            severity: 'info',
            ...(line ? { line } : {}),
            detail: `new dependency \`${name}\``,
          }),
        );
    }
    // No contents: added lines that look like dependency entries and were not simply moved.
    const removed = new Set(judge.dels.map((l) => FALLBACK[kind].exec(l.content)?.[1]).filter(Boolean));
    return judge.adds
      .map((l: Line) => ({ l, name: FALLBACK[kind].exec(l.content)?.[1] }))
      .filter(
        ({ name }) =>
          name &&
          !removed.has(name) &&
          !['name', 'version', 'edition', 'python', 'description'].includes(name),
      )
      .map(({ l, name }) => ({
        kind: 'dependency_added',
        severity: 'info',
        line: l.line,
        detail: `new dependency \`${name}\``,
      }));
  },
};
