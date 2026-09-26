/**
 * tree-sitter helpers for mutation operators (BUILD_PROMPT Appendix G.1): locate nodes inside a named symbol, splice
 * text by node ranges, and re-parse to prove the mutated file is still syntactically clean. Seed sources are ASCII,
 * so tree-sitter indexes and string indexes agree.
 */
import { classifyFile, extractSymbols, type ParsedLanguage, parse } from '@remit/analysis';

type Tree = Awaited<ReturnType<typeof parse>>;
export type SyntaxNode = Tree['rootNode'];

export class MutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutationError';
  }
}

export function languageFor(path: string): ParsedLanguage {
  const lang = classifyFile(path).language;
  if (lang === 'other') throw new MutationError(`${path}: no tree-sitter grammar for this file`);
  return lang;
}

export interface Span {
  start: number;
  end: number;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

/** Character span of a symbol (by name or qualified name), whole lines, trailing newline included. */
export async function symbolSpan(text: string, path: string, name: string): Promise<Span | null> {
  const symbols = (await extractSymbols(languageFor(path), text)).filter(
    (s) => s.name === name || s.qualifiedName === name,
  );
  if (symbols.length > 1) throw new MutationError(`${path}: symbol "${name}" is ambiguous`);
  const s = symbols[0];
  if (!s) return null;
  const starts = lineStarts(text);
  const start = starts[s.startLine - 1] ?? 0;
  const end = starts[s.endLine] ?? text.length;
  return { start, end };
}

export async function requireSpan(text: string, path: string, name: string): Promise<Span> {
  const span = await symbolSpan(text, path, name);
  if (!span) throw new MutationError(`${path}: symbol "${name}" not found`);
  return span;
}

/** Runs `fn` over the parsed tree and frees it afterwards. `fn` must not return nodes: they die with the tree. */
export async function withTree<T>(text: string, path: string, fn: (root: SyntaxNode) => T): Promise<T> {
  const tree = await parse(languageFor(path), text);
  try {
    return fn(tree.rootNode);
  } finally {
    tree.delete();
  }
}

/** Every node (named and anonymous) in document order. */
export function descendants(root: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const walk = (n: SyntaxNode) => {
    out.push(n);
    for (const c of n.children) if (c) walk(c);
  };
  walk(root);
  return out;
}

export const inside = (n: SyntaxNode, span: Span) => n.startIndex >= span.start && n.endIndex <= span.end;

export function splice(text: string, start: number, end: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end);
}

/** Extends a removal to a trailing comma, and to whole lines when the node sits alone on its lines. */
export function removalRange(text: string, start: number, end: number): Span {
  let e = end;
  const after = /^[ \t]*,/.exec(text.slice(e));
  if (after) e += after[0].length;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', e);
  const lineEnd = nl === -1 ? text.length : nl + 1;
  if (/^[ \t]*$/.test(text.slice(lineStart, start)) && /^[ \t]*\r?\n?$/.test(text.slice(e, lineEnd)))
    return { start: lineStart, end: lineEnd };
  return { start, end: e };
}

/** Throws unless the text parses without error nodes. */
export async function assertParses(text: string, path: string): Promise<void> {
  const bad = await withTree(text, path, (root) => root.hasError);
  if (bad) throw new MutationError(`${path}: the mutated file does not re-parse cleanly:\n${text}`);
}

const LITERALS = new Set([
  'number',
  'integer',
  'float',
  'integer_literal',
  'float_literal',
  'string',
  'string_literal',
  'raw_string_literal',
  'boolean_literal',
  'true',
  'false',
  'template_string',
]);

/** Text inside a string literal is never a token of its own: `"false"` must not match `false`. */
const STRING_PARTS = new Set(['string_fragment', 'string_content', 'escape_sequence']);

/** The first literal or operator token inside the symbol whose text is exactly `from`. */
export async function findToken(text: string, path: string, symbol: string, from: string): Promise<Span> {
  const span = await requireSpan(text, path, symbol);
  const hit = await withTree(text, path, (root) => {
    const n = descendants(root).find(
      (x) =>
        inside(x, span) &&
        x.text === from &&
        (x.childCount === 0 || LITERALS.has(x.type)) &&
        !STRING_PARTS.has(x.type),
    );
    return n ? { start: n.startIndex, end: n.endIndex } : null;
  });
  if (!hit) throw new MutationError(`${path}: no token "${from}" in ${symbol}`);
  return hit;
}

/** The smallest node inside the symbol whose text is exactly `from`. */
export async function findExact(text: string, path: string, symbol: string, from: string): Promise<Span> {
  const span = await requireSpan(text, path, symbol);
  const hit = await withTree(text, path, (root) => {
    let best: SyntaxNode | undefined;
    for (const n of descendants(root))
      if (
        inside(n, span) &&
        n.text === from &&
        (!best || n.endIndex - n.startIndex < best.endIndex - best.startIndex)
      )
        best = n;
    return best ? { start: best.startIndex, end: best.endIndex } : null;
  });
  if (!hit) throw new MutationError(`${path}: no node with text "${from}" in ${symbol}`);
  return hit;
}

const REMOVABLE: Record<'ts' | 'py' | 'rs', Set<string>> = {
  ts: new Set([
    'if_statement',
    'switch_case',
    'pair',
    'expression_statement',
    'lexical_declaration',
    'array_element',
  ]),
  py: new Set([
    'if_statement',
    'elif_clause',
    'case_clause',
    'pair',
    'expression_statement',
    'assert_statement',
  ]),
  rs: new Set(['match_arm', 'expression_statement', 'let_declaration']),
};

const STATEMENTS: Record<'ts' | 'py' | 'rs', Set<string>> = {
  ts: new Set(['expression_statement']),
  py: new Set(['expression_statement', 'assert_statement']),
  rs: new Set(['expression_statement']),
};

const group = (path: string): 'ts' | 'py' | 'rs' => {
  const l = languageFor(path);
  return l === 'py' ? 'py' : l === 'rs' ? 'rs' : 'ts';
};

/** The smallest removable statement (or case, arm, pair) inside the symbol that contains `contains`. */
export async function findRemovable(
  text: string,
  path: string,
  symbol: string,
  contains: string,
  /** Only whole statements (for a test assertion): never a pair or case inside one. */
  statementsOnly = false,
): Promise<Span> {
  const span = await requireSpan(text, path, symbol);
  const at = text.indexOf(contains, span.start);
  if (at === -1 || at + contains.length > span.end)
    throw new MutationError(`${path}: "${contains}" is not inside ${symbol}`);
  const kinds = statementsOnly ? STATEMENTS[group(path)] : REMOVABLE[group(path)];
  const node = await withTree(text, path, (root) => {
    let best: SyntaxNode | undefined;
    for (const n of descendants(root)) {
      if (!kinds.has(n.type) || !inside(n, span)) continue;
      if (n.startIndex > at || n.endIndex < at + contains.length) continue;
      // An `else if` cannot be removed on its own in TS; its enclosing chain is the removable unit.
      if (n.type === 'if_statement' && n.parent?.type === 'else_clause') continue;
      if (!best || n.endIndex - n.startIndex < best.endIndex - best.startIndex) best = n;
    }
    return best ? { start: best.startIndex, end: best.endIndex } : null;
  });
  if (!node) throw new MutationError(`${path}: nothing removable around "${contains}" in ${symbol}`);
  return removalRange(text, node.start, node.end);
}

const CALLS: Record<'ts' | 'py' | 'rs', string> = {
  ts: 'call_expression',
  py: 'call',
  rs: 'call_expression',
};

/** Replaces the first call of `callee` inside the symbol with the call's first argument. */
export async function replaceCallWithArgument(
  text: string,
  path: string,
  symbol: string,
  callee: string,
): Promise<string> {
  const span = await requireSpan(text, path, symbol);
  const kind = CALLS[group(path)];
  const edit = await withTree(text, path, (root) => {
    const call = descendants(root).find(
      (n) => n.type === kind && inside(n, span) && n.childForFieldName('function')?.text === callee,
    );
    const arg = call?.childForFieldName('arguments')?.namedChildren[0];
    return call && arg ? { start: call.startIndex, end: call.endIndex, text: arg.text } : null;
  });
  if (!edit) throw new MutationError(`${path}: no call of ${callee}(...) with an argument in ${symbol}`);
  return splice(text, edit.start, edit.end, edit.text);
}

/** Renames every identifier `from` inside the symbol. */
export async function renameIdentifier(
  text: string,
  path: string,
  symbol: string,
  from: string,
  to: string,
): Promise<string> {
  const span = await requireSpan(text, path, symbol);
  const hits = await withTree(text, path, (root) =>
    descendants(root)
      .filter((n) => n.type === 'identifier' && n.text === from && inside(n, span))
      .map((n) => ({ start: n.startIndex, end: n.endIndex })),
  );
  if (!hits.length) throw new MutationError(`${path}: no identifier ${from} in ${symbol}`);
  let out = text;
  for (const h of hits.reverse()) out = splice(out, h.start, h.end, to);
  return out;
}

/** Adds a skip marker to a test: `it.skip`, `@pytest.mark.skip` or `#[ignore]`. */
export async function addSkipMarker(text: string, path: string, symbol: string): Promise<string> {
  const span = await requireSpan(text, path, symbol);
  const g = group(path);
  const edit = await withTree(text, path, (root) => {
    const nodes = descendants(root).filter((n) => inside(n, span));
    if (g === 'ts') {
      const call = nodes.find((n) => {
        if (n.type !== 'call_expression') return false;
        const fn = n.childForFieldName('function');
        const title = n.childForFieldName('arguments')?.namedChildren[0];
        return (
          fn?.type === 'identifier' && ['it', 'test'].includes(fn.text) && title?.text.slice(1, -1) === symbol
        );
      });
      const fn = call?.childForFieldName('function');
      return fn ? { at: fn.startIndex, end: fn.endIndex, text: `${fn.text}.skip` } : null;
    }
    const kind = g === 'py' ? 'function_definition' : 'function_item';
    const def = nodes.find((n) => n.type === kind && n.childForFieldName('name')?.text === symbol);
    if (!def) return null;
    const target = g === 'py' && def.parent?.type === 'decorated_definition' ? def.parent : def;
    const indent = ' '.repeat(target.startPosition.column);
    const marker = g === 'py' ? '@pytest.mark.skip(reason="flaky on CI")' : '#[ignore]';
    return { at: target.startIndex, end: target.startIndex, text: `${marker}\n${indent}` };
  });
  if (!edit) throw new MutationError(`${path}: test ${symbol} not found for a skip marker`);
  return splice(text, edit.at, edit.end, edit.text);
}

/** Top-level comma split of a macro token tree body. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (quote) {
      cur += c;
      if (c === '\\') cur += body[++i] ?? '';
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"') quote = c;
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Swaps the first strict assertion in a test for a looser one (the G.1 weakening pairs). */
export async function weakenAssertion(text: string, path: string, symbol: string): Promise<string> {
  const span = await requireSpan(text, path, symbol);
  const g = group(path);
  const edit = await withTree(text, path, (root) => {
    const nodes = descendants(root).filter((n) => inside(n, span));
    if (g === 'ts') {
      for (const n of nodes) {
        if (n.type !== 'call_expression') continue;
        const fn = n.childForFieldName('function');
        const prop = fn?.type === 'member_expression' ? fn.childForFieldName('property') : null;
        const args = n.childForFieldName('arguments');
        if (prop && args && ['toBe', 'toEqual', 'toStrictEqual'].includes(prop.text))
          return { start: prop.startIndex, end: args.endIndex, text: 'toBeDefined()' };
      }
      return null;
    }
    if (g === 'py') {
      for (const n of nodes) {
        if (n.type !== 'assert_statement') continue;
        const cmp = n.namedChildren[0];
        if (cmp?.type === 'comparison_operator' && cmp.children.some((c) => c?.type === '==')) {
          const left = cmp.namedChildren[0];
          if (left) return { start: cmp.startIndex, end: cmp.endIndex, text: left.text };
        }
      }
      return null;
    }
    for (const n of nodes) {
      if (n.type !== 'macro_invocation' || n.childForFieldName('macro')?.text !== 'assert_eq') continue;
      const tt = n.namedChildren.find((c) => c?.type === 'token_tree');
      if (!tt) continue;
      const [a, b] = splitTopLevel(tt.text.slice(1, -1));
      if (!a || !b) continue;
      const probe = b.startsWith('Ok(')
        ? `${a}.is_ok()`
        : b.startsWith('Some(')
          ? `${a}.is_some()`
          : b.startsWith('Err(')
            ? `${a}.is_err()`
            : b === 'None'
              ? `${a}.is_none()`
              : `!format!("{:?}", ${a}).is_empty()`;
      return { start: n.startIndex, end: n.endIndex, text: `assert!(${probe})` };
    }
    return null;
  });
  if (!edit) throw new MutationError(`${path}: no strict assertion to weaken in ${symbol}`);
  return splice(text, edit.start, edit.end, edit.text);
}

const IMPORTS: Record<'ts' | 'py' | 'rs', { statement: string; specifiers: Set<string> }> = {
  ts: { statement: 'import_statement', specifiers: new Set(['import_specifier']) },
  py: { statement: 'import_from_statement', specifiers: new Set(['dotted_name', 'aliased_import']) },
  rs: {
    statement: 'use_declaration',
    specifiers: new Set(['identifier', 'use_as_clause', 'scoped_identifier']),
  },
};

/**
 * Removes imports of `name` from a file: the specifier (with its comma), or the whole import statement when it was
 * the only one. Used when drop_requirement deletes a symbol, so no import of it is left dangling.
 */
export async function removeImportsOf(text: string, path: string, name: string): Promise<string> {
  const g = group(path);
  const { statement, specifiers } = IMPORTS[g];
  const edit = await withTree(text, path, (root) => {
    for (const stmt of descendants(root).filter((n) => n.type === statement)) {
      const lastSegment = (n: SyntaxNode) =>
        n.text
          .split(/::|\./)
          .pop()
          ?.split(/\s+as\s+/)[0]
          ?.trim();
      const specs = descendants(stmt).filter(
        (n) =>
          specifiers.has(n.type) &&
          n.parent?.type !== n.type &&
          // Python: the module path of `from x import a` is not a specifier.
          !(g === 'py' && n === stmt.childForFieldName('module_name')) &&
          // Rust: only items of a `{...}` list or the final path segment are specifiers.
          (g !== 'rs' || n.parent?.type === 'use_list' || n.parent === stmt),
      );
      const hit = specs.find((n) => lastSegment(n) === name);
      if (!hit) continue;
      if (specs.length === 1 || (g === 'rs' && hit.parent === stmt)) {
        const r = removalRange(text, stmt.startIndex, stmt.endIndex);
        return { start: r.start, end: r.end, text: '' };
      }
      // Remove the specifier and one adjacent comma.
      let start = hit.startIndex;
      let end = hit.endIndex;
      const after = /^\s*,[ \t]*/.exec(text.slice(end));
      if (after) end += after[0].length;
      else {
        const before = /,\s*$/.exec(text.slice(stmt.startIndex, start));
        if (before) start -= before[0].length;
      }
      return { start, end, text: '' };
    }
    return null;
  });
  if (!edit) return text;
  return removeImportsOf(splice(text, edit.start, edit.end, edit.text), path, name);
}
