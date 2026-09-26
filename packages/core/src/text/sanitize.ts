/**
 * Text hygiene for untrusted content (BUILD_PROMPT 9 rule 5, Appendix C conventions): bidi controls and invisible
 * characters are removed everywhere, and sizes are capped.
 */

// Bidi embeddings/overrides/isolates, zero-width and other invisible format characters, BOM, soft hyphen,
// and the Unicode tag block (used for invisible prompt injection).
// biome-ignore lint/suspicious/noMisleadingCharacterClass: variation selectors are listed on purpose; they are invisible and removed
const INVISIBLE = /[­؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]|[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}]/gu;

/** Removes bidi and invisible Unicode. */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, '');
}

/** Caps text at `max` characters, marking the cut. */
export function capText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Invisible-stripped and capped: the standard treatment for any user text placed in a model input. */
export function cleanText(text: string, max = 20_000): string {
  return capText(stripInvisible(text), max);
}
