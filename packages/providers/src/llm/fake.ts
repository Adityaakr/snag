import type { z } from 'zod';
import { ProviderError } from '../common/errors.js';
import { withRepair } from './repair.js';
import type { LlmMessage, LlmProvider, LlmResult, StructuredOptions } from './types.js';

/**
 * Scripted LLM for tests (BUILD_PROMPT 8). Each script entry is a sequence of raw outputs (objects are
 * serialized) returned turn by turn, so repair behavior can be tested. Records every prompt it receives.
 */
export type LlmScript = Record<string, unknown[]>;

export class FakeLlm implements LlmProvider {
  readonly provider = 'fake' as const;
  readonly calls: { key: string; system: string; messages: LlmMessage[] }[] = [];
  private readonly turns = new Map<string, number>();

  constructor(
    private readonly script: LlmScript,
    readonly model = 'claude-opus-5-5',
  ) {}

  async structured<T>(
    schema: z.ZodType<T>,
    messages: LlmMessage[],
    opts: StructuredOptions,
  ): Promise<LlmResult<T>> {
    const key = `${opts.kind ?? 'call'}:${opts.targetId ?? ''}`;
    const outputs = this.script[key];
    if (!outputs) throw new ProviderError('fake', 'config', `FakeLlm has no script for ${key}`);
    const call = async (msgs: LlmMessage[]) => {
      this.calls.push({ key, system: opts.system, messages: msgs });
      const n = this.turns.get(key) ?? 0;
      this.turns.set(key, n + 1);
      const out = outputs[Math.min(n, outputs.length - 1)];
      return typeof out === 'string' ? out : JSON.stringify(out);
    };
    const { data, repairs } = await withRepair('fake', schema, messages, call);
    return {
      data,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: this.model,
      costUsd: 0,
      cached: false,
      repairs,
    };
  }
}
