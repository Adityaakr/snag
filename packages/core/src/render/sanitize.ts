/**
 * Output sanitization (BUILD_PROMPT 6.10, 9 rule 6). Every string that came from users (issue, PR, code) goes
 * through here before rendering, so the bot cannot be turned into a mention cannon or a link-spam channel.
 */
import { stripInvisible } from '../text/sanitize.js';

export const MAX_QUOTE = 200;
const ZWJ = '‍';

const URL_RE = /\b(?:https?|ftp|file|mailto|javascript|data):[^\s<>"'`)\]]+/gi;

/** Removes markdown and HTML images, then all remaining HTML tags. */
function stripHtmlAndImages(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/** Escapes characters markdown would interpret. */
export function escapeMarkdown(text: string): string {
  // Links need `[`/`]`, and code, emphasis, HTML and tables need the rest; parentheses, dashes and `!` are harmless
  // inline once brackets are escaped, so they stay readable.
  return text.replace(/([\\`*_{}[\]<>#|~])/g, '\\$1');
}

/** Inserts a zero-width joiner after `@` so `@user` and `@org/team` never notify anyone. */
export function neutralizeMentions(text: string): string {
  return text.replace(/@(?=[A-Za-z0-9_-])/g, `@${ZWJ}`);
}

/** Inline code that cannot break out of its backticks. */
export function code(text: string): string {
  const clean = neutralizeMentions(
    stripInvisible(text)
      .replace(/[\r\n]+/g, ' ')
      .replace(/`/g, "'"),
  );
  return `\`${clean}\``;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Sanitizes user text for markdown: invisible characters and HTML removed, URLs shown as inline code, markdown
 * escaped, mentions neutralized, newlines flattened, and the result truncated to `max` characters.
 */
export function sanitize(text: string, max = MAX_QUOTE, keepEdges = false): string {
  const collapsed = stripHtmlAndImages(stripInvisible(text)).replace(/\s+/g, ' ');
  const flat = truncate(keepEdges ? collapsed : collapsed.trim(), max);
  let out = '';
  let last = 0;
  for (const m of flat.matchAll(URL_RE)) {
    out += neutralizeMentions(escapeMarkdown(flat.slice(last, m.index)));
    out += code(m[0]);
    last = (m.index ?? 0) + m[0].length;
  }
  out += neutralizeMentions(escapeMarkdown(flat.slice(last)));
  return out;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matches terminal escape sequences in user text
const ANSI_ESCAPE = /\x1b\[[0-9;]*[A-Za-z]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matches control characters in user text
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;

/** Sanitizes for plain terminal output: no markdown escaping, but invisible characters and control codes removed. */
export function plain(text: string, max = MAX_QUOTE): string {
  return truncate(
    stripInvisible(text).replace(ANSI_ESCAPE, '').replace(CONTROL, '').replace(/\s+/g, ' ').trim(),
    max,
  );
}

/**
 * For reason texts built from templates: plain parts are sanitized, backtick spans (numbers, code snippets) are
 * rendered with `code`, which cannot break out of its backticks.
 */
export function sanitizeWithCode(text: string, max = 600): string {
  const parts = truncate(text, max).split(/`([^`\n]*)`/);
  return parts
    .map((p, i) => (i % 2 === 1 ? code(p) : sanitize(p, p.length + 1, true)))
    .join('')
    .trim();
}
