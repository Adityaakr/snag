/**
 * Dashboard sessions (BUILD_PROMPT 9.10): an HMAC-signed cookie holding the login, the installations the user can
 * access (read from GitHub at sign-in), a CSRF token and an expiry. No GitHub token is kept.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Session {
  login: string;
  installationIds: number[];
  csrf: string;
  /** Epoch milliseconds. */
  exp: number;
}

export const SESSION_TTL_MS = 8 * 3600_000;
export const MIN_SESSION_SECRET = 32;

const mac = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('base64url');

export function signSession(secret: string, s: Omit<Session, 'csrf' | 'exp'>, now = Date.now()): string {
  if (secret.length < MIN_SESSION_SECRET)
    throw new Error(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET} characters.`);
  const body = Buffer.from(
    JSON.stringify({ ...s, csrf: randomBytes(16).toString('hex'), exp: now + SESSION_TTL_MS }),
  ).toString('base64url');
  return `${body}.${mac(secret, body)}`;
}

export function readSession(secret: string, cookie: string | undefined, now = Date.now()): Session | null {
  if (!cookie || secret.length < MIN_SESSION_SECRET) return null;
  const [body, sig] = cookie.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(secret, body));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session;
    if (
      typeof s.login !== 'string' ||
      !Array.isArray(s.installationIds) ||
      typeof s.exp !== 'number' ||
      s.exp < now
    )
      return null;
    return s;
  } catch {
    return null;
  }
}

/** A fixed-window rate limiter per key (for example per session or per client address). */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}
  allow(key: string, now = Date.now()): boolean {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      if (this.windows.size > 10_000) this.windows.delete(this.windows.keys().next().value as string);
      return true;
    }
    w.count++;
    return w.count <= this.limit;
  }
}
