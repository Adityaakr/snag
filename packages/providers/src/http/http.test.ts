import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ProviderError } from '../common/errors.js';
import { classifyHttpStatus, FakeHttp, LiveHttp } from './http.js';
import { buildZip, listZip, readZipEntry } from './zip.js';

describe('zip over HTTP ranges', () => {
  it('lists entries and reads deflated and stored ones without fetching the whole archive', async () => {
    const url = 'https://zenodo.example/archive.zip';
    for (const deflate of [true, false]) {
      const zip = buildZip(
        { 'a/RQ34.csv': 'tool,instance_id\nX,y\n', 'b/big.json': '{"k":1}'.repeat(500) },
        deflate,
      );
      const fake = new FakeHttp({ [url]: zip });
      const entries = await listZip(fake, url);
      expect(entries.map((e) => e.name)).toEqual(['a/RQ34.csv', 'b/big.json']);
      const csv = await readZipEntry(fake, url, entries[0] as (typeof entries)[number]);
      expect(csv.toString()).toBe('tool,instance_id\nX,y\n');
      expect(fake.calls.every((c) => c.range)).toBe(true);
    }
  });

  it('rejects servers without range support and non-zip data', async () => {
    const url = 'https://x.example/f.zip';
    const noRange = { get: async () => ({ status: 200, body: Buffer.alloc(10), headers: {} }) };
    await expect(listZip(noRange, url)).rejects.toThrow(/range requests/);
    await expect(listZip(new FakeHttp({ [url]: Buffer.alloc(100) }), url)).rejects.toThrow(/end-of-central/);
  });
});

describe('FakeHttp', () => {
  it('serves bodies and 404s unknown URLs as fatal', async () => {
    const f = new FakeHttp({ 'https://a.example/x': 'hello' });
    expect((await f.get('https://a.example/x')).body.toString()).toBe('hello');
    const err = await f.get('https://a.example/missing').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
  });
});

describe('classifyHttpStatus', () => {
  it('maps statuses to retryable and fatal kinds', () => {
    expect(classifyHttpStatus('https://h.example/', 429, '3')).toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 3000,
    });
    expect(classifyHttpStatus('https://h.example/', 503).retryable).toBe(true);
    expect(classifyHttpStatus('https://h.example/', 403).kind).toBe('auth');
    expect(classifyHttpStatus('not a url', 404).message).toContain('the server');
  });
});

describe('LiveHttp (msw)', () => {
  let hits = 0;
  const server = setupServer(
    http.get('https://data.example/file', ({ request }) => {
      hits++;
      if (hits === 1) return new HttpResponse(null, { status: 503 });
      const range = request.headers.get('range');
      return new HttpResponse(range ? `range:${range}` : 'full', { status: range ? 206 : 200 });
    }),
    http.get('https://data.example/missing', () => new HttpResponse(null, { status: 404 })),
  );
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('retries server errors, sends ranges and fails fast on 404', async () => {
    const live = new LiveHttp({ retry: { sleep: async () => {}, attempts: 3 } });
    const r = await live.get('https://data.example/file', { range: { start: 5, end: 9 } });
    expect(r.status).toBe(206);
    expect(r.body.toString()).toBe('range:bytes=5-9');
    expect(hits).toBe(2);
    await expect(live.get('https://data.example/missing')).rejects.toMatchObject({ kind: 'bad_request' });
  });

  it('classifies connection failures as retryable', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const live = new LiveHttp({ fetchImpl: failing, retry: { attempts: 1 } });
    await expect(live.get('https://data.example/x')).rejects.toMatchObject({
      kind: 'connection',
      retryable: true,
    });
  });
});
