import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CostTracker } from '../common/budget.js';
import { MemoryStore } from '../cache/store.js';
import { AnthropicLlm, acceptsTemperature, classifyAnthropicError } from './anthropic.js';
import { CachedLlm } from './cached.js';
import { FakeLlm } from './fake.js';
import { OpenAiCompatibleLlm } from './openai.js';
import { parseStructured } from './repair.js';

const Schema = z.object({ requirements: z.array(z.object({ id: z.string(), quote: z.string() })) });
const GOOD = { requirements: [{ id: 'R1', quote: 'include a header row' }] };
const OPTS = {
  schemaName: 'record_requirements',
  system: 'You extract requirements.',
  promptVersion: 'xp-0.1.0',
  kind: 'extract',
  targetId: 'acme/r#12',
};
const MSGS = [{ role: 'user' as const, content: '<issue>...</issue>' }];
const PRICE = { inputPerMillionUsd: 4, outputPerMillionUsd: 20 };

interface Reply {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

function scriptedFetch(replies: Reply[]) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> | null }[] =
    [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    });
    const r = replies.length > 1 ? replies.shift() : replies[0];
    if (!r) throw new Error('no reply');
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  }) as typeof globalThis.fetch;
  return { fetch: fakeFetch, requests };
}

const message = (text: string, extra: Record<string, unknown> = {}) => ({
  body: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 500 },
    ...extra,
  },
});

function anthropic(replies: Reply[], extra: Partial<ConstructorParameters<typeof AnthropicLlm>[0]> = {}) {
  const f = scriptedFetch(replies);
  const llm = new AnthropicLlm({
    model: 'claude-opus-5-5',
    price: PRICE,
    apiKey: 'test-key-not-real',
    fetch: f.fetch,
    retry: { sleep: async () => {} },
    ...extra,
  });
  return { llm, requests: f.requests };
}

describe('AnthropicLlm', () => {
  it('uses native structured output, no tools, no temperature on Opus 5.5, and returns validated data', async () => {
    const { llm, requests } = anthropic([message(JSON.stringify(GOOD))]);
    const res = await llm.structured(Schema, MSGS, OPTS);
    expect(res).toMatchObject({
      data: GOOD,
      repairs: 0,
      model: 'claude-opus-5-5',
      usage: { inputTokens: 1000, outputTokens: 500 },
    });
    const body = requests[0]?.body ?? {};
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'You extract requirements.',
      output_config: { format: { type: 'json_schema' } },
    });
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
    expect(body).not.toHaveProperty('temperature');
  });

  it('sends temperature 0 to models that accept it, and effort when configured', async () => {
    const { llm, requests } = anthropic([message(JSON.stringify(GOOD))], {
      model: 'claude-haiku-4-5',
      effort: 'low',
    });
    await llm.structured(Schema, MSGS, OPTS);
    expect(requests[0]?.body).toMatchObject({ temperature: 0, output_config: { effort: 'low' } });
    expect(acceptsTemperature('claude-opus-5-5')).toBe(false);
    expect(acceptsTemperature('claude-sonnet-4-6')).toBe(true);
  });

  it('makes one repair turn that includes the validation errors', async () => {
    const { llm, requests } = anthropic([
      message('{"requirements":[{"id":"R1"}]}'),
      message(JSON.stringify(GOOD)),
    ]);
    const res = await llm.structured(Schema, MSGS, OPTS);
    expect(res.repairs).toBe(1);
    expect(res.usage).toEqual({ inputTokens: 2000, outputTokens: 1000 });
    const second = requests[1]?.body?.messages as { role: string; content: string }[];
    expect(second).toHaveLength(3);
    expect(second[2]?.content).toMatch(/requirements\.0\.quote/);
  });

  it('fails after a second invalid output', async () => {
    const { llm } = anthropic([message('not json')]);
    await expect(llm.structured(Schema, MSGS, OPTS)).rejects.toMatchObject({ kind: 'validation' });
  });

  it('accounts cost with input and output prices', async () => {
    const costs = new CostTracker(10);
    const { llm } = anthropic([message(JSON.stringify(GOOD))], { costs });
    const res = await llm.structured(Schema, MSGS, OPTS);
    expect(res.costUsd).toBeCloseTo((1000 * 4 + 500 * 20) / 1e6, 10);
    expect(costs.usage).toMatchObject({ llmInputTokens: 1000, llmOutputTokens: 500, calls: 1 });
  });

  it('retries 429 and 529, and treats refusals and truncation as errors', async () => {
    const { llm, requests } = anthropic([
      {
        status: 429,
        body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } },
        headers: { 'retry-after': '1' },
      },
      { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } } },
      message(JSON.stringify(GOOD)),
    ]);
    await llm.structured(Schema, MSGS, OPTS);
    expect(requests).toHaveLength(3);
    await expect(
      anthropic([
        message('', {
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' },
        }),
      ]).llm.structured(Schema, MSGS, OPTS),
    ).rejects.toThrow(/declined the request \(cyber\)/);
    await expect(
      anthropic([message('{"req', { stop_reason: 'max_tokens' })]).llm.structured(Schema, MSGS, OPTS),
    ).rejects.toThrow(/max_tokens/);
  });

  it('maps auth and not-found errors with fixes, and explains a missing key', async () => {
    await expect(
      anthropic([
        { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'no' } } },
      ]).llm.structured(Schema, MSGS, OPTS),
    ).rejects.toMatchObject({ kind: 'auth' });
    await expect(
      anthropic([
        { status: 404, body: { type: 'error', error: { type: 'not_found_error', message: 'model' } } },
      ]).llm.structured(Schema, MSGS, OPTS),
    ).rejects.toMatchObject({ kind: 'config', fix: expect.stringMatching(/remit doctor/) });
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(
        new AnthropicLlm({ model: 'm', price: PRICE }).structured(Schema, MSGS, OPTS),
      ).rejects.toMatchObject({ kind: 'config', fix: expect.stringMatching(/--offline/) });
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
    expect(classifyAnthropicError(new Error('x'))).toMatchObject({ kind: 'connection' });
  });

  it('lists models through the Models API', async () => {
    const { llm, requests } = anthropic([
      {
        body: {
          data: [
            {
              id: 'claude-opus-5-5',
              type: 'model',
              display_name: 'Claude Opus 5.5',
              created_at: '2026-09-01T00:00:00Z',
            },
            {
              id: 'claude-sonnet-5',
              type: 'model',
              display_name: 'Claude Sonnet 5',
              created_at: '2026-06-01T00:00:00Z',
            },
          ],
          has_more: false,
          first_id: 'claude-opus-5-5',
          last_id: 'claude-sonnet-5',
        },
      },
    ]);
    expect(await llm.listModels()).toEqual(['claude-opus-5-5', 'claude-sonnet-5']);
    expect(requests[0]?.url).toMatch(/\/v1\/models/);
  });
});

describe('OpenAiCompatibleLlm', () => {
  const completion = (content: string) => ({
    body: {
      id: 'c1',
      object: 'chat.completion',
      created: 1,
      model: 'local-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    },
  });

  it('uses a JSON Schema response format with temperature 0 and repairs once', async () => {
    const f = scriptedFetch([completion('{"requirements": 3}'), completion(JSON.stringify(GOOD))]);
    const llm = new OpenAiCompatibleLlm({
      model: 'local-model',
      price: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
      apiKey: 'k-not-real',
      baseURL: 'http://localhost:9999/v1',
      fetch: f.fetch,
      retry: { sleep: async () => {} },
    });
    const res = await llm.structured(Schema, MSGS, OPTS);
    expect(res).toMatchObject({ data: GOOD, repairs: 1, model: 'local-model' });
    expect(f.requests[0]?.body).toMatchObject({
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: { name: 'record_requirements' } },
    });
    expect((f.requests[0]?.body?.messages as { role: string }[] | undefined)?.[0]?.role).toBe('system');
  });

  it('needs both key and base URL', async () => {
    const llm = new OpenAiCompatibleLlm({ model: 'm', price: PRICE });
    await expect(llm.structured(Schema, MSGS, OPTS)).rejects.toMatchObject({ kind: 'config' });
  });
});

describe('FakeLlm and CachedLlm', () => {
  it('FakeLlm serves scripted turns and records prompts', async () => {
    const fake = new FakeLlm({ 'extract:acme/r#12': [{ requirements: 'bad' }, GOOD] });
    const res = await fake.structured(Schema, MSGS, OPTS);
    expect(res.repairs).toBe(1);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]?.messages[0]?.content).toBe('<issue>...</issue>');
    await expect(fake.structured(Schema, MSGS, { ...OPTS, targetId: 'nope' })).rejects.toThrow(/no script/);
  });

  it('CachedLlm records then replays, and misses when the prompt version changes', async () => {
    const store = new MemoryStore();
    const fake = new FakeLlm({ 'extract:acme/r#12': [GOOD] });
    await new CachedLlm(fake, store, 'record').structured(Schema, MSGS, OPTS);
    const replay = new CachedLlm(new FakeLlm({}), store, 'replay');
    expect(await replay.structured(Schema, MSGS, OPTS)).toMatchObject({
      data: GOOD,
      cached: true,
      costUsd: 0,
    });
    await expect(
      replay.structured(Schema, MSGS, { ...OPTS, promptVersion: 'xp-0.2.0' }),
    ).rejects.toMatchObject({ kind: 'cache_miss' });
    const rol = new CachedLlm(fake, store, 'replay_or_live');
    await rol.structured(Schema, MSGS, { ...OPTS, promptVersion: 'xp-0.2.0' });
    expect(store.items.size).toBe(2);
    const live = new CachedLlm(fake, store, 'live');
    await live.structured(Schema, MSGS, OPTS);
    expect(store.items.size).toBe(2);
  });

  it('never stores the API key or headers in LLM cassettes', async () => {
    const store = new MemoryStore();
    const { llm, requests } = anthropic([message(JSON.stringify(GOOD))]);
    await new CachedLlm(llm, store, 'record').structured(Schema, MSGS, OPTS);
    expect(requests[0]?.headers['x-api-key']).toBe('test-key-not-real');
    expect(JSON.stringify([...store.items.values()])).not.toMatch(/test-key-not-real|x-api-key/i);
  });

  it('parseStructured strips code fences', () => {
    expect(parseStructured(Schema, `\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\``)).toEqual({
      ok: true,
      data: GOOD,
    });
  });
});
