/**
 * Record-and-replay storage (BUILD_PROMPT 7.4). A cassette holds the request (provider, model, question set,
 * state, questions) and the response, never headers. Keys are sha256 of the canonical JSON request.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ProviderError } from '../common/errors.js';

export type CacheMode = 'live' | 'record' | 'replay' | 'replay_or_live';
export const CACHE_MODES: readonly CacheMode[] = ['live', 'record', 'replay', 'replay_or_live'];

/** Reads REMIT_CACHE_MODE, falling back to the given default. */
export function cacheModeFrom(env: Record<string, string | undefined>, fallback: CacheMode): CacheMode {
  const v = env.REMIT_CACHE_MODE;
  if (!v) return fallback;
  if ((CACHE_MODES as readonly string[]).includes(v)) return v as CacheMode;
  throw new ProviderError(
    'cache',
    'config',
    `REMIT_CACHE_MODE "${v}" is not valid`,
    `Use one of ${CACHE_MODES.join(', ')}.`,
  );
}

/** JSON with object keys sorted at every level, so equal requests serialize identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function cacheKey(request: unknown): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

const SECRET_KEY =
  /^(authorization|proxy-authorization|x-api-key|api[-_]?key|cookie|set-cookie|token|secret|password)$/i;

/** Removes header-like secret fields at any depth (defense in depth: requests never carry headers). */
export function scrub<T>(value: T): T {
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SECRET_KEY.test(k))
        .map(([k, v]) => [k, scrub(v)]),
    ) as T;
  }
  return value;
}

export interface Cassette<Req = unknown, Res = unknown> {
  key: string;
  /** Omitted in content-free stores (production caching by key only). */
  request?: Req;
  response: Res;
  recordedAt: string;
}

export interface CassetteStore {
  get(provider: string, key: string): Promise<Cassette | null>;
  put(provider: string, cassette: Cassette): Promise<void>;
}

export class MemoryStore implements CassetteStore {
  readonly items = new Map<string, Cassette>();
  async get(provider: string, key: string) {
    return this.items.get(`${provider}/${key}`) ?? null;
  }
  async put(provider: string, cassette: Cassette) {
    this.items.set(`${provider}/${cassette.key}`, structuredClone(cassette));
  }
}

/** Cassettes as JSON files: `<dir>/<provider>/<key[0..2]>/<key>.json`. */
export class FileStore implements CassetteStore {
  constructor(
    readonly dir: string,
    readonly options: { contentFree?: boolean } = {},
  ) {}

  private path(provider: string, key: string): string {
    return join(this.dir, provider, key.slice(0, 2), `${key}.json`);
  }

  async get(provider: string, key: string): Promise<Cassette | null> {
    try {
      return JSON.parse(readFileSync(this.path(provider, key), 'utf8')) as Cassette;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ProviderError(
        'cache',
        'config',
        `cassette ${key} is unreadable: ${(e as Error).message}`,
        'Delete it and record again.',
      );
    }
  }

  async put(provider: string, cassette: Cassette): Promise<void> {
    const path = this.path(provider, cassette.key);
    mkdirSync(dirname(path), { recursive: true });
    const body = this.options.contentFree
      ? { key: cassette.key, response: cassette.response, recordedAt: cassette.recordedAt }
      : cassette;
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(scrub(body), null, 2)}\n`);
    renameSync(tmp, path);
  }
}
