import { matchGlob } from './glob.js';

export interface AttributeRule {
  pattern: string;
  attrs: Record<string, string | boolean>;
}

/** Parses `.gitattributes` text. `attr` sets true, `-attr` sets false, `attr=value` sets the value. */
export function parseGitattributes(text: string): AttributeRule[] {
  const rules: AttributeRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [pattern, ...parts] = line.split(/\s+/);
    if (!pattern || pattern.startsWith('[')) continue; // macro definitions
    const attrs: Record<string, string | boolean> = {};
    for (const part of parts) {
      if (part.startsWith('-')) attrs[part.slice(1)] = false;
      else if (part.startsWith('!')) delete attrs[part.slice(1)];
      else if (part.includes('=')) {
        const [k, v] = part.split('=', 2) as [string, string];
        attrs[k] = v === 'true' ? true : v === 'false' ? false : v;
      } else attrs[part] = true;
    }
    rules.push({ pattern, attrs });
  }
  return rules;
}

/** Resolves one attribute for a path; later rules win, like git. */
export function attributeFor(
  rules: readonly AttributeRule[],
  path: string,
  attr: string,
): string | boolean | undefined {
  let value: string | boolean | undefined;
  for (const rule of rules) {
    if (attr in rule.attrs && matchGlob(path, rule.pattern)) value = rule.attrs[attr];
  }
  return value;
}
