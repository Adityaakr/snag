import { defaultConfig, type RemitConfig } from '@remit/core';
import { describe, expect, it } from 'vitest';
import { operatorPricesFromEnv, providersFromEnv, resolvePrices } from './env.js';

const withRepo = (patch: (c: RemitConfig) => void): RemitConfig => {
  const c = structuredClone(defaultConfig());
  patch(c);
  return c;
};

describe('operator prices', () => {
  const operator = operatorPricesFromEnv(defaultConfig(), {});

  it('a repository cannot lower prices below the operator floor', () => {
    const c = withRepo((c) => {
      c.llm_prices['claude-opus-5-5'] = { input: 0, output: 0 };
      c.jev.price_per_million_input_usd = 0;
    });
    const p = resolvePrices(c, operator);
    expect(p.llm).toEqual({ input: 4, output: 20 });
    expect(p.jevPerMillionUsd).toBe(0.042);
    expect(p.llmAllowed).toBe(true);
    const higher = withRepo((c) => (c.llm_prices['claude-opus-5-5'] = { input: 9, output: 30 }));
    expect(resolvePrices(higher, operator).llm).toEqual({ input: 9, output: 30 });
  });

  it('a model the operator has not priced gets no live LLM, even with a key and a repository price', () => {
    const c = withRepo((c) => {
      c.extraction.model = 'claude-new-unpriced';
      c.llm_prices['claude-new-unpriced'] = { input: 0, output: 0 };
    });
    expect(resolvePrices(c, operator).llmAllowed).toBe(false);
    const key = ['sk', 'ant', 'test'].join('-');
    const env = { ANTHROPIC_API_KEY: key, REMIT_CACHE_DIR: '/nonexistent/remit-cache' };
    const built = providersFromEnv(c, env, { operatorPrices: operator, breakers: false });
    expect(built.llm).toBeUndefined();
    expect(built.notes.join(' ')).toContain('no operator price');
    expect(providersFromEnv(c, env, { breakers: false }).llm).toBeDefined();
  });

  it('model ids that name object properties are not priced by inheritance', () => {
    for (const model of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const c = withRepo((c) => {
        c.extraction.provider = 'openai_compatible';
        c.extraction.model = model;
      });
      const p = resolvePrices(c, operator);
      expect(p.llmAllowed).toBe(false);
      expect(p.llm).toBeUndefined();
      const env = {
        OPENAI_COMPATIBLE_API_KEY: ['k', 'test'].join('-'),
        OPENAI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:1/v1',
        REMIT_CACHE_DIR: '/nonexistent/remit-cache',
      };
      expect(providersFromEnv(c, env, { operatorPrices: operator, breakers: false }).llm).toBeUndefined();
    }
    const polluted = operatorPricesFromEnv(defaultConfig(), {
      REMIT_LLM_PRICES: '{"__proto__":{"input":1,"output":1}}',
    });
    expect(Object.getPrototypeOf(polluted.llm)).toBeNull();
  });

  it('the CLI and the Action keep the repository prices', () => {
    const c = withRepo((c) => (c.jev.price_per_million_input_usd = 0.01));
    expect(resolvePrices(c, undefined).jevPerMillionUsd).toBe(0.01);
  });

  it('reads operator overrides from the environment and rejects zero or invalid prices', () => {
    const p = operatorPricesFromEnv(defaultConfig(), {
      REMIT_LLM_PRICES: JSON.stringify({ 'claude-new': { input: 3, output: 15 } }),
      REMIT_JEV_PRICE_PER_MILLION_USD: '0.05',
    });
    expect(p.llm['claude-new']).toEqual({ input: 3, output: 15 });
    expect(p.llm['claude-opus-5-5']).toEqual({ input: 4, output: 20 });
    expect(p.jevPerMillionUsd).toBe(0.05);
    expect(() =>
      operatorPricesFromEnv(defaultConfig(), { REMIT_LLM_PRICES: '{"m":{"input":0,"output":1}}' }),
    ).toThrow(/positive/);
    expect(() => operatorPricesFromEnv(defaultConfig(), { REMIT_JEV_PRICE_PER_MILLION_USD: '0' })).toThrow();
    expect(() => operatorPricesFromEnv(defaultConfig(), { REMIT_LLM_PRICES: 'not json' })).toThrow();
  });
});
