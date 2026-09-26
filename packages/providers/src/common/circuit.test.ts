import { describe, expect, it } from 'vitest';
import { FakeJev } from '../jev/fake.js';
import { FakeLlm } from '../llm/fake.js';
import { BreakerJev, BreakerLlm, CircuitBreaker, processBreaker } from './circuit.js';
import { ProviderError } from './errors.js';

const down = () => Promise.reject(new ProviderError('jev', 'overloaded', 'overloaded (529)'));
const fatal = () => Promise.reject(new ProviderError('jev', 'bad_request', 'bad request (400)'));

describe('CircuitBreaker', () => {
  it('opens after consecutive retryable failures, fails fast, then half-opens after the cooldown', async () => {
    let now = 0;
    const events: string[] = [];
    const b = new CircuitBreaker('jev', {
      failures: 3,
      cooldownMs: 1000,
      now: () => now,
      onOpen: () => events.push('open'),
      onReject: () => events.push('reject'),
    });
    for (let i = 0; i < 3; i++) await expect(b.run(down)).rejects.toThrow('529');
    expect(b.state).toBe('open');
    let called = false;
    await expect(
      b.run(async () => {
        called = true;
      }),
    ).rejects.toThrow(/circuit open/);
    expect(called).toBe(false);
    now = 1500;
    await expect(b.run(down)).rejects.toThrow('529');
    expect(b.state).toBe('open');
    now = 3000;
    expect(await b.run(async () => 'ok')).toBe('ok');
    expect(b.state).toBe('closed');
    expect(events).toEqual(['open', 'reject', 'open']);
  });

  it('ignores fatal errors and resets on success', async () => {
    const b = new CircuitBreaker('jev', { failures: 2 });
    await expect(b.run(fatal)).rejects.toThrow('400');
    await expect(b.run(fatal)).rejects.toThrow('400');
    expect(b.state).toBe('closed');
    await expect(b.run(down)).rejects.toThrow();
    await b.run(async () => 1);
    await expect(b.run(down)).rejects.toThrow();
    expect(b.state).toBe('closed');
    expect(processBreaker('x-provider')).toBe(processBreaker('x-provider'));
  });

  it('wraps Jev and LLM providers', async () => {
    const b = new CircuitBreaker('jev', { failures: 1, cooldownMs: 60_000 });
    const jev = new BreakerJev(new FakeJev({}), b);
    expect(jev.model).toBe('jev-1.13.0');
    await expect(
      jev.ask({ kind: 'forward', targetId: 'R1', questionSet: 'qs', reviewId: 'r' }, {}, {}),
    ).rejects.toThrow(/no script/);
    const llm = new BreakerLlm(new FakeLlm({ 'call:': ['{}'] }), new CircuitBreaker('anthropic'));
    expect([llm.provider, llm.model]).toEqual(['fake', 'claude-opus-5-5']);
    const { z } = await import('zod');
    expect(
      (await llm.structured(z.object({}), [], { schemaName: 's', system: '', promptVersion: 'v' })).data,
    ).toEqual({});
  });
});
