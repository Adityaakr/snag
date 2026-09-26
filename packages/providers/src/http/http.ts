/**
 * Plain HTTP downloads for public evaluation data (BUILD_PROMPT 11.1 corpus A): Hugging Face rows, GitHub raw files
 * and Zenodo archives. Every external call goes through this provider (rule 7), with a fake for tests. Requests
 * carry no credentials.
 */
import { BRAND } from '@remit/core';
import { ProviderError } from '../common/errors.js';
import { type RetryOptions, withRetry } from '../common/retry.js';

export interface HttpResponseData {
  status: number;
  body: Buffer;
  headers: Record<string, string>;
}

export interface HttpGetOptions {
  /** Inclusive byte range, sent as `Range: bytes=start-end`. */
  range?: { start: number; end: number };
}

export interface HttpProvider {
  get(url: string, opts?: HttpGetOptions): Promise<HttpResponseData>;
}

export function classifyHttpStatus(url: string, status: number, retryAfter?: string | null): ProviderError {
  const host = safeHost(url);
  const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
  if (status === 429)
    return new ProviderError(
      'http',
      'rate_limited',
      `${host} rate limited the request`,
      undefined,
      retryAfterMs,
    );
  if (status >= 500) return new ProviderError('http', 'server', `${host} returned ${status}`);
  if (status === 401 || status === 403)
    return new ProviderError(
      'http',
      'auth',
      `${host} refused the request (${status})`,
      'The data must be public.',
    );
  return new ProviderError(
    'http',
    'bad_request',
    `${host} returned ${status} for ${url}`,
    'Check the pinned URL.',
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the server';
  }
}

export interface LiveHttpOptions {
  retry?: RetryOptions;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class LiveHttp implements HttpProvider {
  constructor(private readonly opts: LiveHttpOptions = {}) {}

  get(url: string, opts: HttpGetOptions = {}): Promise<HttpResponseData> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    return withRetry(async () => {
      const headers: Record<string, string> = { 'user-agent': `${BRAND.slug}-eval` };
      if (opts.range) headers.range = `bytes=${opts.range.start}-${opts.range.end}`;
      let res: Response;
      try {
        res = await doFetch(url, { headers, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000) });
      } catch (e) {
        const timeout = e instanceof Error && e.name === 'TimeoutError';
        throw new ProviderError('http', timeout ? 'timeout' : 'connection', `${safeHost(url)}: ${String(e)}`);
      }
      if (!res.ok) throw classifyHttpStatus(url, res.status, res.headers.get('retry-after'));
      const out: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        out[k] = v;
      });
      return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: out };
    }, this.opts.retry);
  }
}

/** In-memory HTTP for tests: exact URL to body. Honors byte ranges. */
export class FakeHttp implements HttpProvider {
  readonly calls: { url: string; range?: { start: number; end: number } }[] = [];
  constructor(private readonly files: Record<string, string | Buffer>) {}

  async get(url: string, opts: HttpGetOptions = {}): Promise<HttpResponseData> {
    this.calls.push({ url, ...(opts.range ? { range: opts.range } : {}) });
    const file = this.files[url];
    if (file === undefined) throw classifyHttpStatus(url, 404);
    const body = Buffer.isBuffer(file) ? file : Buffer.from(file);
    if (!opts.range) return { status: 200, body, headers: { 'content-length': String(body.length) } };
    const end = Math.min(opts.range.end, body.length - 1);
    return {
      status: 206,
      body: body.subarray(opts.range.start, end + 1),
      headers: { 'content-range': `bytes ${opts.range.start}-${end}/${body.length}` },
    };
  }
}
