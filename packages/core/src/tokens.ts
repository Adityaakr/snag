/**
 * Conservative token estimate used for every budget (BUILD_PROMPT 7.3): `ceil(chars / 3)`.
 * Pass a string, or any JSON value (it is serialized first).
 */
export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return Math.ceil(text.length / 3);
}
