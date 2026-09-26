/**
 * tree-sitter (WASM) parsing for TS, TSX, JS, Python and Rust (BUILD_PROMPT 6.3 step 3): named symbols with
 * line ranges, comment ranges for judge views, and test titles.
 */
import { createRequire } from 'node:module';
import type { Language as LangId, SymbolKind } from '@remit/core';
import { Language, type Node, Parser, type Tree } from 'web-tree-sitter';

const require = createRequire(import.meta.url);

export type ParsedLanguage = Exclude<LangId, 'other'>;

const GRAMMARS: Record<ParsedLanguage, string> = {
  ts: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  js: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  py: 'tree-sitter-python/tree-sitter-python.wasm',
  rs: 'tree-sitter-rust/tree-sitter-rust.wasm',
};

let initialized: Promise<void> | null = null;
const languages = new Map<ParsedLanguage, Promise<Language>>();

/** True when tree-sitter can parse this language. */
export function isParsed(lang: LangId): lang is ParsedLanguage {
  return lang !== 'other';
}

/** Where a grammar's .wasm file lives; bundles can override with REMIT_GRAMMAR_DIR. */
export function grammarPath(lang: ParsedLanguage): string {
  const dir = process.env.REMIT_GRAMMAR_DIR;
  const rel = GRAMMARS[lang];
  if (dir) return `${dir}/${rel.slice(rel.lastIndexOf('/') + 1)}`;
  return require.resolve(rel);
}

async function language(lang: ParsedLanguage): Promise<Language> {
  if (!initialized) initialized = Parser.init();
  await initialized;
  let loaded = languages.get(lang);
  if (!loaded) {
    loaded = Language.load(grammarPath(lang));
    languages.set(lang, loaded);
  }
  return loaded;
}

/** Parses source text. The caller owns the tree and should call `tree.delete()` when done. */
export async function parse(lang: ParsedLanguage, source: string): Promise<Tree> {
  const loaded = await language(lang); // initializes the runtime before any Parser exists
  const parser = new Parser();
  try {
    parser.setLanguage(loaded);
    const tree = parser.parse(source);
    if (!tree) throw new Error(`tree-sitter returned no tree for ${lang}`);
    return tree;
  } finally {
    parser.delete();
  }
}

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based, inclusive. Includes decorators and attributes above the symbol. */
  startLine: number;
  endLine: number;
  /** Nesting depth; 0 for top level. */
  depth: number;
  /** Names of enclosing symbols and this one, joined with `/` (for example `Exporter/run`). */
  qualifiedName: string;
  /** For test symbols, the title string or function name. */
  testTitle?: string;
}

const TEST_CALLEES = new Set([
  'it',
  'test',
  'describe',
  'xit',
  'xtest',
  'xdescribe',
  'fit',
  'fdescribe',
  'suite',
  'bench',
]);

/** The base identifier of a callee like `it`, `it.only`, `describe.skip.each(...)`. */
function calleeBase(node: Node | null): string | null {
  let n = node;
  while (n) {
    if (n.type === 'identifier') return n.text;
    if (n.type === 'member_expression') n = n.childForFieldName('object');
    else if (n.type === 'call_expression') n = n.childForFieldName('function');
    else return null;
  }
  return null;
}

function stringValue(node: Node | null | undefined): string | null {
  if (!node) return null;
  if (node.type === 'string' || node.type === 'template_string') {
    return node.text.slice(1, -1);
  }
  return null;
}

function line(n: Node): number {
  return n.startPosition.row + 1;
}

function endLine(n: Node): number {
  // A node ending at column 0 ends on the previous line.
  return n.endPosition.column === 0 && n.endPosition.row > n.startPosition.row
    ? n.endPosition.row
    : n.endPosition.row + 1;
}

/** Start line including preceding decorators or attributes (Rust `#[...]`, Python decorators are wrapped already). */
function startWithAttributes(n: Node): number {
  let start = line(n);
  let prev = n.previousNamedSibling;
  while (
    prev &&
    (prev.type === 'attribute_item' || prev.type === 'decorator') &&
    endLine(prev) >= start - 1
  ) {
    start = line(prev);
    prev = prev.previousNamedSibling;
  }
  return start;
}

function jsSymbol(n: Node, parentKinds: SymbolKind[]): Omit<CodeSymbol, 'depth' | 'qualifiedName'> | null {
  switch (n.type) {
    case 'function_declaration':
    case 'generator_function_declaration': {
      const name = n.childForFieldName('name')?.text;
      return name ? { name, kind: 'function', startLine: line(n), endLine: endLine(n) } : null;
    }
    case 'class_declaration':
    case 'abstract_class_declaration': {
      const name = n.childForFieldName('name')?.text;
      return name ? { name, kind: 'class', startLine: startWithAttributes(n), endLine: endLine(n) } : null;
    }
    case 'method_definition':
    case 'method_signature': {
      const name = n.childForFieldName('name')?.text;
      return name ? { name, kind: 'method', startLine: startWithAttributes(n), endLine: endLine(n) } : null;
    }
    case 'interface_declaration':
    case 'type_alias_declaration':
    case 'enum_declaration': {
      const name = n.childForFieldName('name')?.text;
      return name ? { name, kind: 'block', startLine: line(n), endLine: endLine(n) } : null;
    }
    case 'variable_declarator': {
      const name = n.childForFieldName('name');
      const value = n.childForFieldName('value');
      if (name?.type !== 'identifier' || !value) return null;
      const decl = n.parent;
      const range = decl && decl.namedChildCount === 1 ? decl : n;
      if (['arrow_function', 'function_expression', 'function', 'generator_function'].includes(value.type)) {
        return { name: name.text, kind: 'function', startLine: line(range), endLine: endLine(range) };
      }
      // Top-level constants holding object or array literals (config tables, defaults).
      const topLevel =
        parentKinds.length === 0 &&
        (decl?.parent?.type === 'program' || decl?.parent?.type === 'export_statement');
      if (
        topLevel &&
        ['object', 'array', 'call_expression', 'as_expression', 'satisfies_expression'].includes(value.type)
      ) {
        return { name: name.text, kind: 'block', startLine: line(range), endLine: endLine(range) };
      }
      return null;
    }
    case 'public_field_definition':
    case 'field_definition': {
      const name = n.childForFieldName('name') ?? n.childForFieldName('property');
      const value = n.childForFieldName('value');
      if (name && value && ['arrow_function', 'function_expression', 'function'].includes(value.type)) {
        return { name: name.text, kind: 'method', startLine: line(n), endLine: endLine(n) };
      }
      return null;
    }
    case 'call_expression': {
      const base = calleeBase(n.childForFieldName('function'));
      if (!base || !TEST_CALLEES.has(base)) return null;
      const args = n.childForFieldName('arguments');
      const title = stringValue(args?.namedChildren[0]);
      if (title === null) return null;
      // Use the enclosing expression statement so the whole call is covered.
      const stmt = n.parent?.type === 'expression_statement' ? n.parent : n;
      return { name: title, kind: 'test', startLine: line(stmt), endLine: endLine(stmt), testTitle: title };
    }
    default:
      return null;
  }
}

function pySymbol(n: Node, parentKinds: SymbolKind[]): Omit<CodeSymbol, 'depth' | 'qualifiedName'> | null {
  const target = n.type === 'decorated_definition' ? n.childForFieldName('definition') : n;
  if (!target || (n.type !== 'decorated_definition' && n.parent?.type === 'decorated_definition'))
    return null;
  const name = target.childForFieldName('name')?.text;
  if (!name) return null;
  if (target.type === 'function_definition') {
    const inClass = parentKinds[parentKinds.length - 1] === 'class';
    const isTest = name.startsWith('test');
    return {
      name,
      kind: isTest ? 'test' : inClass ? 'method' : 'function',
      startLine: line(n),
      endLine: endLine(n),
      ...(isTest ? { testTitle: name } : {}),
    };
  }
  if (target.type === 'class_definition') {
    return { name, kind: 'class', startLine: line(n), endLine: endLine(n) };
  }
  return null;
}

function hasAttribute(n: Node, attr: RegExp): boolean {
  let prev = n.previousNamedSibling;
  while (prev && prev.type === 'attribute_item') {
    if (attr.test(prev.text)) return true;
    prev = prev.previousNamedSibling;
  }
  return false;
}

function rsSymbol(n: Node, parentKinds: SymbolKind[]): Omit<CodeSymbol, 'depth' | 'qualifiedName'> | null {
  switch (n.type) {
    case 'function_item':
    case 'function_signature_item': {
      const name = n.childForFieldName('name')?.text;
      if (!name) return null;
      const isTest = hasAttribute(n, /#\[\s*(?:tokio::)?test\b/);
      const inImpl = parentKinds[parentKinds.length - 1] === 'class';
      return {
        name,
        kind: isTest ? 'test' : inImpl ? 'method' : 'function',
        startLine: startWithAttributes(n),
        endLine: endLine(n),
        ...(isTest ? { testTitle: name } : {}),
      };
    }
    case 'impl_item': {
      const type = n.childForFieldName('type')?.text;
      const trait = n.childForFieldName('trait')?.text;
      if (!type) return null;
      return {
        name: trait ? `${trait} for ${type}` : type,
        kind: 'class',
        startLine: startWithAttributes(n),
        endLine: endLine(n),
      };
    }
    case 'struct_item':
    case 'enum_item':
    case 'trait_item':
    case 'union_item': {
      const name = n.childForFieldName('name')?.text;
      return name ? { name, kind: 'class', startLine: startWithAttributes(n), endLine: endLine(n) } : null;
    }
    case 'mod_item': {
      const name = n.childForFieldName('name')?.text;
      if (!name || !n.childForFieldName('body')) return null;
      return { name, kind: 'module', startLine: startWithAttributes(n), endLine: endLine(n) };
    }
    case 'const_item':
    case 'static_item': {
      const name = n.childForFieldName('name')?.text;
      return name ? { name, kind: 'block', startLine: startWithAttributes(n), endLine: endLine(n) } : null;
    }
    default:
      return null;
  }
}

const EXTRACTORS: Record<
  ParsedLanguage,
  (n: Node, parents: SymbolKind[]) => Omit<CodeSymbol, 'depth' | 'qualifiedName'> | null
> = {
  ts: jsSymbol,
  tsx: jsSymbol,
  js: jsSymbol,
  py: pySymbol,
  rs: rsSymbol,
};

/** Walks a tree and returns every named symbol in source order (parents before children). */
export function symbolsOf(lang: ParsedLanguage, tree: Tree): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const extract = EXTRACTORS[lang];
  const visit = (n: Node, parents: SymbolKind[], names: string[]) => {
    const sym = extract(n, parents);
    if (sym) out.push({ ...sym, depth: parents.length, qualifiedName: [...names, sym.name].join('/') });
    const next = sym ? [...parents, sym.kind] : parents;
    const nextNames = sym ? [...names, sym.name] : names;
    for (const child of n.namedChildren) if (child) visit(child, next, nextNames);
  };
  visit(tree.rootNode, [], []);
  return out;
}

/** Parses and extracts symbols in one step. */
export async function extractSymbols(lang: ParsedLanguage, source: string): Promise<CodeSymbol[]> {
  const tree = await parse(lang, source);
  try {
    return symbolsOf(lang, tree);
  } finally {
    tree.delete();
  }
}

/** The smallest symbol containing every line in [start, end], or null. */
export function smallestEnclosing(
  symbols: readonly CodeSymbol[],
  start: number,
  end: number,
): CodeSymbol | null {
  let best: CodeSymbol | null = null;
  for (const s of symbols) {
    if (s.startLine <= start && s.endLine >= end) {
      if (
        !best ||
        s.endLine - s.startLine < best.endLine - best.startLine ||
        (s.endLine - s.startLine === best.endLine - best.startLine && s.depth > best.depth)
      ) {
        best = s;
      }
    }
  }
  return best;
}

export interface TextRange {
  startIndex: number;
  endIndex: number;
}

/** Byte ranges (UTF-16 indices in JS strings) of comments, and of Python docstrings. */
export function commentRanges(lang: ParsedLanguage, tree: Tree): TextRange[] {
  const types = lang === 'rs' ? ['line_comment', 'block_comment'] : ['comment'];
  const ranges: TextRange[] = tree.rootNode
    .descendantsOfType(types)
    .flatMap((n) => (n ? [{ startIndex: n.startIndex, endIndex: n.endIndex }] : []));
  if (lang === 'py') {
    for (const s of tree.rootNode.descendantsOfType('expression_statement')) {
      if (s?.namedChildCount !== 1 || s.namedChildren[0]?.type !== 'string') continue;
      const parent = s.parent;
      const isFirst = parent?.namedChildren.find((c) => c && c.type !== 'comment')?.id === s.id;
      if (isFirst && (parent?.type === 'module' || parent?.type === 'block')) {
        ranges.push({ startIndex: s.startIndex, endIndex: s.endIndex });
      }
    }
  }
  return ranges.sort((a, b) => a.startIndex - b.startIndex);
}
