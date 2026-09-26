import { describe, expect, it } from 'vitest';
import { CostTracker } from '../common/budget.js';
import { BudgetExceededError, ProviderError } from '../common/errors.js';
import { type Clock, RateLimiter } from '../common/limits.js';
import { canonicalJson, MemoryStore, scrub } from '../cache/store.js';
import { toAnswers } from './answers.js';
import { CachedJev } from './cached.js';
import { FakeJev } from './fake.js';
import { classifyJevError, LiveJev } from './live.js';
import { choice, noul, score } from './types.js';
import { validateAnswers } from './validate.js';

const META = { kind: 'forward', questionSet: 'qs-0.1.0', targetId: 'R1', reviewId: 'rv_test' } as const;
const QUESTIONS = {
  covered: noul('Does `change` implement `requirement.text`?', { true: 'yes', false: 'no' }),
  evidence: choice('Which entry?', { U1: 'entry U1', none: 'no entry' }),
  coverage: score('How much?', ['none', 'touched', 'most', 'full']),
};
const GOOD = {
  covered: { type: 'noul', noul: 0.8 },
  evidence: { type: 'choice', choice: 'U1', confidence: 0.7, probabilities: { U1: 0.85, none: 0.15 } },
  coverage: {
    type: 'score',
    score: 2.5,
    confidence: 0.6,
    legend: {},
    probabilities: { '0': 0.05, '1': 0.05, '2': 0.25, '3': 0.65 },
  },
};

interface Scripted {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** A fetch that serves queued responses and records requests (headers included, to prove scrubbing). */
function scriptedFetch(responses: Scripted[], opts: { delayMs?: number } = {}) {
  const requests: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  let active = 0;
  let maxActive = 0;
  const fetch = async (url: string, init?: RequestInit) => {
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      requests.push({
        url,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body)),
      });
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      const next = responses.length > 1 ? responses.shift() : responses[0];
      if (!next) throw new Error('no scripted response');
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'content-type': 'application/json', ...next.headers },
      });
    } finally {
      active--;
    }
  };
  return {
    fetch,
    requests,
    get maxActive() {
      return maxActive;
    },
  };
}

const ok = (inputTokens = 1000): Scripted => ({
  status: 200,
  body: { answers: GOOD, model: 'jev-1.13.0', usage: { input_tokens: inputTokens, output_tokens: 20 } },
});
const noWaitClock: Clock = { now: () => 0, sleep: async () => {} };
const unlimited = () => new RateLimiter(1e9, 1e12, noWaitClock);

function live(
  fetch: ReturnType<typeof scriptedFetch>['fetch'],
  extra: Partial<ConstructorParameters<typeof LiveJev>[0]> = {},
) {
  const sleeps: number[] = [];
  const logs: { level: string; obj: Record<string, unknown> }[] = [];
  const jev = new LiveJev({
    apiKey: 'test-key-not-real',
    model: 'jev-1.13.0',
    pricePerMillionUsd: 0.042,
    fetch,
    limiter: unlimited(),
    retry: { sleep: async (ms) => void sleeps.push(ms), random: () => 0.5 },
    logger: {
      debug: (obj) => logs.push({ level: 'debug', obj: obj as Record<string, unknown> }),
      info: (obj) => logs.push({ level: 'info', obj: obj as Record<string, unknown> }),
      warn: (obj) => logs.push({ level: 'warn', obj: obj as Record<string, unknown> }),
    },
    ...extra,
  });
  return { jev, sleeps, logs };
}

describe('LiveJev', () => {
  it('sends one request with the pinned model, SDK retries off, and returns validated answers', async () => {
    const f = scriptedFetch([ok()]);
    const { jev } = live(f.fetch);
    const res = await jev.ask(META, { requirement: { text: 'x' } }, QUESTIONS);
    expect(res.answers.evidence.choice).toBe('U1');
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect((f.requests[0]?.body as { model?: string } | undefined)?.model).toBe('jev-1.13.0');
  });

  it('logs the answering model and accounts cost as input tokens times price', async () => {
    const costs = new CostTracker(1);
    const f = scriptedFetch([ok(1_000_000)]);
    const { jev, logs } = live(f.fetch, { costs });
    const res = await jev.ask(META, 'state', QUESTIONS);
    expect(res.costUsd).toBeCloseTo(0.042, 10);
    expect(costs.usage).toMatchObject({ jevInputTokens: 1_000_000, calls: 1 });
    expect(costs.usage.costUsd).toBeCloseTo(0.042, 10);
    expect(logs.find((l) => l.level === 'info')?.obj).toMatchObject({
      model: 'jev-1.13.0',
      kind: 'forward',
      target: 'R1',
      reviewId: 'rv_test',
    });
  });

  it('backs off on 429 honoring retry-after, then succeeds', async () => {
    const f = scriptedFetch([
      { status: 429, body: { error: 'slow down' }, headers: { 'retry-after': '2' } },
      ok(),
    ]);
    const { jev, sleeps, logs } = live(f.fetch);
    await jev.ask(META, 'state', QUESTIONS);
    expect(f.requests).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
    expect(logs.some((l) => l.level === 'warn' && l.obj.error === 'rate_limited')).toBe(true);
  });

  it('backs off exponentially on 529 and gives up after 5 attempts', async () => {
    const f = scriptedFetch([{ status: 529, body: { error: 'overloaded' } }]);
    const { jev, sleeps } = live(f.fetch);
    await expect(jev.ask(META, 'state', QUESTIONS)).rejects.toMatchObject({
      kind: 'overloaded',
      retryable: true,
    });
    expect(f.requests).toHaveLength(5);
    // random() = 0.5 -> delay = 0.75 * min(cap, 500 * 2^(n-1))
    expect(sleeps).toEqual([375, 750, 1500, 3000]);
  });

  it('shrinks and retries on a 400 token overflow, then fails after 3 shrinks', async () => {
    const f = scriptedFetch([{ status: 400, body: { error: 'max_tokens_exceeded' } }, ok()]);
    const { jev } = live(f.fetch);
    const shrinkCalls: number[] = [];
    await jev.ask(META, { big: 'x'.repeat(100) }, QUESTIONS, {
      shrink: (n) => {
        shrinkCalls.push(n);
        return { state: { big: 'x' }, questions: QUESTIONS };
      },
    });
    expect(shrinkCalls).toEqual([1]);
    expect((f.requests[1]?.body as { state?: { big?: string } } | undefined)?.state?.big).toBe('x');

    const always = scriptedFetch([
      { status: 422, body: { detail: 'state plus questions exceed 64k tokens' } },
    ]);
    const { jev: j2 } = live(always.fetch);
    await expect(
      j2.ask(META, 'state', QUESTIONS, { shrink: () => ({ state: 's', questions: QUESTIONS }) }),
    ).rejects.toMatchObject({ kind: 'overflow' });
    expect(always.requests).toHaveLength(4);
  });

  it('shrinks before sending when the estimate is over the state budget', async () => {
    const f = scriptedFetch([ok()]);
    const { jev } = live(f.fetch, { maxStateTokens: 100 });
    await jev.ask(META, { candidates: 'y'.repeat(600) }, QUESTIONS, {
      shrink: () => ({ state: { candidates: 'y' }, questions: QUESTIONS }),
    });
    expect(f.requests).toHaveLength(1);
    expect(JSON.stringify(f.requests[0]?.body)).not.toContain('yyyy');
    const { jev: noShrink } = live(scriptedFetch([ok()]).fetch, { maxStateTokens: 100 });
    await expect(noShrink.ask(META, 'z'.repeat(600), QUESTIONS)).rejects.toMatchObject({ kind: 'overflow' });
  });

  it('shrinks before sending when state plus questions exceed the whole-request budget', async () => {
    const f = scriptedFetch([ok()]);
    const { jev } = live(f.fetch, { maxRequestTokens: 300 });
    const long = { ...QUESTIONS, extra: noul('q'.repeat(900)) };
    const shrinks: number[] = [];
    await jev.ask(META, 'small state', long, {
      shrink: (n) => {
        shrinks.push(n);
        return { state: 'small state', questions: QUESTIONS };
      },
    });
    expect(shrinks).toEqual([1]);
    expect(Object.keys((f.requests[0]?.body as { questions?: object } | undefined)?.questions ?? {})).toEqual(
      ['covered', 'evidence', 'coverage'],
    );
  });

  it('retries once on an invalid answer, then fails', async () => {
    const bad = {
      status: 200,
      body: {
        answers: { ...GOOD, evidence: { ...GOOD.evidence, choice: 'U9' } },
        model: 'jev-1.13.0',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    };
    const f = scriptedFetch([bad, ok()]);
    const { jev } = live(f.fetch);
    await jev.ask(META, 's', QUESTIONS);
    expect(f.requests).toHaveLength(2);
    const always = scriptedFetch([bad]);
    await expect(live(always.fetch).jev.ask(META, 's', QUESTIONS)).rejects.toMatchObject({
      kind: 'validation',
    });
    expect(always.requests).toHaveLength(2);
  });

  it('limits concurrency', async () => {
    const f = scriptedFetch([ok()], { delayMs: 5 });
    const { jev } = live(f.fetch, { concurrency: 3 });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => jev.ask({ ...META, targetId: `R${i}` }, 's', QUESTIONS)),
    );
    expect(f.requests).toHaveLength(10);
    expect(f.maxActive).toBe(3);
  });

  it('stops before a call that would pass the budget', async () => {
    const costs = new CostTracker(0.00001);
    costs.addJev(0, 0.00001);
    const f = scriptedFetch([ok()]);
    await expect(live(f.fetch, { costs }).jev.ask(META, 's', QUESTIONS)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(f.requests).toHaveLength(0);
  });

  it('explains a missing key and a rejected key', async () => {
    const prev = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      const jev = new LiveJev({ model: 'jev-1.13.0', pricePerMillionUsd: 0.042, limiter: unlimited() });
      await expect(jev.ask(META, 's', QUESTIONS)).rejects.toMatchObject({
        kind: 'config',
        fix: expect.stringMatching(/--offline/),
      });
    } finally {
      if (prev !== undefined) process.env.TYPESAFE_API_KEY = prev;
    }
    const f = scriptedFetch([{ status: 401, body: { error: 'bad key' } }]);
    await expect(live(f.fetch).jev.ask(META, 's', QUESTIONS)).rejects.toMatchObject({
      kind: 'auth',
      retryable: false,
    });
    expect(f.requests).toHaveLength(1);
  });

  it('classifies other failures', () => {
    expect(classifyJevError(new Error('socket hang up'))).toMatchObject({
      kind: 'connection',
      retryable: true,
    });
    const pe = new ProviderError('jev', 'budget', 'x');
    expect(classifyJevError(pe)).toBe(pe);
  });
});

describe('validateAnswers', () => {
  it.each([
    [
      'a missing question',
      { covered: GOOD.covered, evidence: GOOD.evidence },
      /missing answer for question "coverage"/,
    ],
    [
      'a choice outside the keys',
      { ...GOOD, evidence: { ...GOOD.evidence, choice: 'U2' } },
      /not one of U1, none/,
    ],
    [
      'probabilities that do not sum to 1',
      { ...GOOD, evidence: { ...GOOD.evidence, probabilities: { U1: 0.5, none: 0.2 } } },
      /sum to 0.7000/,
    ],
    ['a noul out of range', { ...GOOD, covered: { type: 'noul', noul: 1.5 } }, /invalid answer/],
    [
      'a score level out of range',
      { ...GOOD, coverage: { ...GOOD.coverage, probabilities: { '0': 0.5, '7': 0.5 } } },
      /unknown levels 7/,
    ],
    ['a wrong answer type', { ...GOOD, covered: GOOD.evidence }, /expected a noul answer/],
  ])('rejects %s', (_n, answers, message) => {
    expect(() => validateAnswers(QUESTIONS, answers)).toThrow(message);
  });

  it('accepts probabilities within 1e-3 of 1', () => {
    expect(() =>
      validateAnswers(QUESTIONS, {
        ...GOOD,
        evidence: { ...GOOD.evidence, probabilities: { U1: 0.8505, none: 0.15 } },
      }),
    ).not.toThrow();
    expect(() => validateAnswers(QUESTIONS, null)).toThrow(/no answers object/);
  });
});

describe('FakeJev', () => {
  const fake = () =>
    new FakeJev(
      {
        forward: {
          R1: { covered: 0.9, evidence: 'U1', coverage: { levels: [0.1, 0.1, 0.2, 0.6] } },
          'R1#2': { covered: 0.2, evidence: 'none', coverage: { levels: [0.7, 0.1, 0.1, 0.1] } },
        },
      },
      'jev-1.13.0',
      'golden-1',
    );

  it('answers from the script and records the state it saw', async () => {
    const jev = fake();
    const res = await jev.ask(META, { secret: 'judge view' }, QUESTIONS);
    expect(res.answers.covered.noul).toBe(0.9);
    expect(res.answers.evidence.probabilities).toEqual({ U1: 0.9, none: 0.1 });
    expect(res.answers.coverage.score).toBeCloseTo(2.3);
    expect(jev.statesFor('forward')).toEqual([{ secret: 'judge view' }]);
  });

  it('serves `#n` scripts for repeated calls (the widen pass)', async () => {
    const jev = fake();
    await jev.ask(META, 's', QUESTIONS);
    expect((await jev.ask(META, 's', QUESTIONS)).answers.evidence.choice).toBe('none');
  });

  it('throws on unscripted calls and questions', async () => {
    await expect(fake().ask({ ...META, targetId: 'R9' }, 's', QUESTIONS)).rejects.toThrow(
      /no script for forward R9/,
    );
    await expect(fake().ask(META, 's', { ...QUESTIONS, extra: noul('x') })).rejects.toThrow(
      /no answer for forward R1 question "extra"/,
    );
  });

  it('rejects script shapes that do not fit the question', async () => {
    const jev = new FakeJev({
      forward: { R1: { covered: 'yes', evidence: 'U1', coverage: { levels: [1, 0, 0, 0] } } },
    });
    await expect(jev.ask(META, 's', QUESTIONS)).rejects.toThrow(/Noul answers are numbers/);
  });
});

describe('CachedJev (record and replay)', () => {
  it('records in record mode and replays without calling the provider', async () => {
    const store = new MemoryStore();
    const f = scriptedFetch([ok()]);
    const recorder = new CachedJev(live(f.fetch).jev, store, 'record');
    await recorder.ask(META, { a: 1, b: 2 }, QUESTIONS);
    const replayer = new CachedJev(null, store, 'replay', 'jev-1.13.0');
    // Key order does not matter: requests are canonicalized.
    const res = await replayer.ask(META, { b: 2, a: 1 }, QUESTIONS);
    expect(res).toMatchObject({ cached: true, costUsd: 0, model: 'jev-1.13.0' });
    expect(f.requests).toHaveLength(1);
  });

  it('fails on a miss in replay mode and fills the cache in replay_or_live', async () => {
    const store = new MemoryStore();
    await expect(
      new CachedJev(null, store, 'replay', 'jev-1.13.0').ask(META, 's', QUESTIONS),
    ).rejects.toMatchObject({ kind: 'cache_miss' });
    const f = scriptedFetch([ok()]);
    const rol = new CachedJev(live(f.fetch).jev, store, 'replay_or_live');
    await rol.ask(META, 's', QUESTIONS);
    await rol.ask(META, 's', QUESTIONS);
    expect(f.requests).toHaveLength(1);
    expect([rol.hits, rol.misses]).toEqual([1, 1]);
  });

  it('bypasses the cache in live mode', async () => {
    const store = new MemoryStore();
    const f = scriptedFetch([ok()]);
    const c = new CachedJev(live(f.fetch).jev, store, 'live');
    await c.ask(META, 's', QUESTIONS);
    await c.ask(META, 's', QUESTIONS);
    expect(f.requests).toHaveLength(2);
    expect(store.items.size).toBe(0);
  });

  it('keys include the question set, so a wording bump misses', async () => {
    const store = new MemoryStore();
    const f = scriptedFetch([ok()]);
    const c = new CachedJev(live(f.fetch).jev, store, 'replay_or_live');
    await c.ask(META, 's', QUESTIONS);
    await c.ask({ ...META, questionSet: 'qs-0.2.0' }, 's', QUESTIONS);
    expect(f.requests).toHaveLength(2);
  });

  it('never stores auth headers, though the live request carried one', async () => {
    const store = new MemoryStore();
    const f = scriptedFetch([ok()]);
    await new CachedJev(live(f.fetch).jev, store, 'record').ask(META, 's', QUESTIONS);
    expect(f.requests[0]?.headers.authorization).toBe('Bearer test-key-not-real');
    const text = JSON.stringify([...store.items.values()]);
    expect(text).not.toMatch(/authorization|Bearer|test-key-not-real/i);
  });

  it('needs a model without an inner provider', () => {
    expect(() => new CachedJev(null, new MemoryStore(), 'replay')).toThrow(/needs a model/);
  });
});

describe('helpers', () => {
  it('canonicalJson sorts keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: undefined }] })).toBe('{"a":[{"d":1}],"b":1}');
  });

  it('scrub removes secret-looking keys at any depth', () => {
    expect(scrub({ headers: { Authorization: 'x', accept: 'y' }, list: [{ api_key: 'k', v: 1 }] })).toEqual({
      headers: { accept: 'y' },
      list: [{ v: 1 }],
    });
  });

  it('toAnswers maps SDK answers to the Answer contract', () => {
    expect(toAnswers('forward.v0', GOOD as never)).toEqual([
      { call: 'forward.v0', question: 'covered', type: 'noul', value: 0.8 },
      {
        call: 'forward.v0',
        question: 'evidence',
        type: 'choice',
        value: 'U1',
        probabilities: { U1: 0.85, none: 0.15 },
        confidence: 0.7,
      },
      {
        call: 'forward.v0',
        question: 'coverage',
        type: 'score',
        value: 2.5,
        probabilities: GOOD.coverage.probabilities,
        confidence: 0.6,
      },
    ]);
  });
});
