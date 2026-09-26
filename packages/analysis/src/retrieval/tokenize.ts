/** Tokenizer for retrieval (BUILD_PROMPT 6.5 step 1): split identifiers, lowercase, drop stop words. */

const STOP = new Set(
  // English stop words plus code keywords that carry no meaning; words like export, return or add stay, since
  // requirements use them ("CSV export").
  'a an and are as at be but by can could do does for from has have if in into is it its must need not of on or should so that the their then there these this to use used uses was were when which while will with would you your we our all any each every also only than via per such const let var def fn pub true false null none undefined self'.split(
    ' ',
  ),
);

/** Splits camelCase, PascalCase, snake_case, kebab-case and digits; lowercases; drops stop words and 1-char tokens. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[^A-Za-z0-9]+/)) {
    if (!raw) continue;
    const parts = raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(' ');
    for (const p of parts) {
      const t = p.toLowerCase();
      if (t.length < 2 || STOP.has(t)) continue;
      out.push(t);
    }
  }
  return out;
}

/** String literal contents in code text (quoted with ', " or `). */
export function stringLiterals(code: string): string[] {
  return [...code.matchAll(/(["'`])((?:\\.|(?!\1).){1,200})\1/g)].map((m) => m[2] as string);
}
