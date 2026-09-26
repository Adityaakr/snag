/**
 * Webhook signatures (BUILD_PROMPT 9.1): HMAC SHA-256 over the raw body, compared in constant time. Unsigned or
 * malformed requests are rejected.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signBody(secret: string, body: string | Buffer): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function verifySignature(
  secret: string,
  body: string | Buffer,
  header: string | undefined | null,
): boolean {
  if (!secret || !header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = Buffer.from(signBody(secret, body));
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
