import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeJev } from '../jev/fake.js';
import { CachedJev } from '../jev/cached.js';
import { noul } from '../jev/types.js';
import { cacheKey, cacheModeFrom, FileStore } from './store.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'remit-cassettes-'));
  dirs.push(d);
  return d;
};

const META = { kind: 'reverse', questionSet: 'qs-0.1.0', targetId: 'U7', reviewId: 'rv' } as const;
const Q = { behavior_change: noul('Does `change` alter behavior?') };

describe('cacheModeFrom', () => {
  it.each(['live', 'record', 'replay', 'replay_or_live'])('accepts %s', (mode) => {
    expect(cacheModeFrom({ REMIT_CACHE_MODE: mode }, 'live')).toBe(mode);
  });

  it('falls back to the default and rejects unknown modes with a fix', () => {
    expect(cacheModeFrom({}, 'replay_or_live')).toBe('replay_or_live');
    expect(() => cacheModeFrom({ REMIT_CACHE_MODE: 'sometimes' }, 'live')).toThrow(/not valid/);
  });
});

describe('FileStore', () => {
  it('records cassettes to disk and replays them in a fresh process', async () => {
    const dir = tmp();
    await new CachedJev(
      new FakeJev({ reverse: { U7: { behavior_change: 0.8 } } }),
      new FileStore(dir),
      'record',
    ).ask(META, { change: 'x' }, Q);
    const replay = new CachedJev(null, new FileStore(dir), 'replay', 'jev-1.13.0');
    expect((await replay.ask(META, { change: 'x' }, Q)).answers.behavior_change.noul).toBe(0.8);
    const shard = readdirSync(join(dir, 'jev'))[0] as string;
    const file = readdirSync(join(dir, 'jev', shard))[0] as string;
    const cassette = JSON.parse(readFileSync(join(dir, 'jev', shard, file), 'utf8'));
    expect(cassette.request).toMatchObject({
      provider: 'jev',
      model: 'jev-1.13.0',
      questionSet: 'qs-0.1.0',
      state: { change: 'x' },
    });
    expect(file).toBe(`${cassette.key}.json`);
    expect(JSON.stringify(cassette)).not.toMatch(/authorization|api[-_]?key|bearer/i);
  });

  it('stores only the key and response in content-free mode (production)', async () => {
    const dir = tmp();
    const store = new FileStore(dir, { contentFree: true });
    await store.put('jev', {
      key: 'k'.repeat(64),
      request: { state: 'secret code' },
      response: { ok: 1 },
      recordedAt: 'now',
    });
    const got = await store.get('jev', 'k'.repeat(64));
    expect(got).toEqual({ key: 'k'.repeat(64), response: { ok: 1 }, recordedAt: 'now' });
  });

  it('returns null on a miss and explains unreadable cassettes', async () => {
    const dir = tmp();
    const store = new FileStore(dir);
    expect(await store.get('jev', 'ab'.repeat(32))).toBeNull();
    await store.put('jev', { key: 'cd'.repeat(32), response: 1, recordedAt: 'now' });
    writeFileSync(join(dir, 'jev', 'cd', `${'cd'.repeat(32)}.json`), '{broken');
    await expect(store.get('jev', 'cd'.repeat(32))).rejects.toThrow(/unreadable/);
  });

  it('computes keys that ignore object key order', () => {
    expect(cacheKey({ a: 1, b: { c: 2, d: 3 } })).toBe(cacheKey({ b: { d: 3, c: 2 }, a: 1 }));
    expect(cacheKey({ a: 1 })).not.toBe(cacheKey({ a: 2 }));
  });
});
