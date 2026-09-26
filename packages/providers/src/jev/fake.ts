/**
 * Scripted Jev for tests and golden scenarios (BUILD_PROMPT 7.3). Answers come from a script keyed by
 * (call kind, target id, question id). Unscripted calls throw; there are no silent defaults. Every state is
 * recorded so tests can assert blindness and comment stripping.
 */
import type { EntryType, Questions } from '@typesafe-ai/sdk';
import { ProviderError } from '../common/errors.js';
import type { AskOptions, CallKind, CallMeta, JevAnswers, JevProvider, JevResult } from './types.js';
import { validateAnswers } from './validate.js';

/** Shorthand answers: a number for Noul, a key or `{ choice, probabilities }` for Choice, level probabilities for Score. */
export type ScriptedAnswer =
  | number
  | string
  | { choice: string; probabilities?: Record<string, number>; confidence?: number }
  | { levels: number[]; confidence?: number };

/** kind -> target id (optionally `R2#2` for the second call) -> question id -> answer. */
export type JevScript = Partial<Record<CallKind, Record<string, Record<string, ScriptedAnswer>>>>;

export interface RecordedCall {
  meta: CallMeta;
  state: EntryType;
  questions: Questions;
}

function expand(id: string, q: Questions[string], a: ScriptedAnswer): unknown {
  if (q.type === 'noul') {
    if (typeof a !== 'number') throw new Error(`${id}: Noul answers are numbers`);
    return { type: 'noul', noul: a };
  }
  if (q.type === 'choice') {
    const keys = Object.keys(q.criteria);
    const spec =
      typeof a === 'string'
        ? { choice: a }
        : (a as { choice: string; probabilities?: Record<string, number>; confidence?: number });
    if (typeof spec !== 'object' || !('choice' in spec))
      throw new Error(`${id}: Choice answers are a key or { choice }`);
    let probabilities = spec.probabilities;
    if (!probabilities) {
      // Put 0.9 on the chosen key and spread the rest evenly.
      const rest = keys.length > 1 ? 0.1 / (keys.length - 1) : 0;
      probabilities = Object.fromEntries(
        keys.map((k) => [k, k === spec.choice ? (keys.length > 1 ? 0.9 : 1) : rest]),
      );
    } else {
      probabilities = Object.fromEntries(keys.map((k) => [k, probabilities?.[k] ?? 0]));
    }
    return {
      type: 'choice',
      choice: spec.choice,
      probabilities,
      confidence: spec.confidence ?? Math.max(...Object.values(probabilities)),
    };
  }
  if (typeof a !== 'object' || !('levels' in a))
    throw new Error(`${id}: Score answers are { levels: [...] }`);
  const probabilities = Object.fromEntries(a.levels.map((p, i) => [String(i), p]));
  const score = a.levels.reduce((s, p, i) => s + p * i, 0);
  return {
    type: 'score',
    score,
    probabilities,
    legend: {},
    confidence: a.confidence ?? Math.max(...a.levels),
  };
}

export class FakeJev implements JevProvider {
  readonly calls: RecordedCall[] = [];
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly script: JevScript,
    readonly model = 'jev-1.13.0',
    readonly scenario = 'default',
  ) {}

  async ask<Q extends Questions>(
    meta: CallMeta,
    state: EntryType,
    questions: Q,
    _opts?: AskOptions,
  ): Promise<JevResult<Q>> {
    this.calls.push({ meta, state: structuredClone(state), questions });
    const key = `${meta.kind}:${meta.targetId}`;
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    const byTarget = this.script[meta.kind];
    const scripted = byTarget?.[`${meta.targetId}#${n}`] ?? byTarget?.[meta.targetId];
    if (!scripted) {
      throw new ProviderError(
        'jev',
        'config',
        `FakeJev (${this.scenario}) has no script for ${meta.kind} ${meta.targetId} (call ${n})`,
      );
    }
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(questions)) {
      const a = scripted[id];
      if (a === undefined)
        throw new ProviderError(
          'jev',
          'config',
          `FakeJev (${this.scenario}) has no answer for ${meta.kind} ${meta.targetId} question "${id}"`,
        );
      answers[id] = expand(id, q, a);
    }
    validateAnswers(questions, answers);
    return {
      answers: answers as JevAnswers<Q>,
      model: this.model,
      usage: { inputTokens: 0, outputTokens: 0 },
      costUsd: 0,
      cached: false,
    };
  }

  /** States sent for one call kind, for blindness and comment-stripping assertions. */
  statesFor(kind: CallKind): EntryType[] {
    return this.calls.filter((c) => c.meta.kind === kind).map((c) => c.state);
  }
}
