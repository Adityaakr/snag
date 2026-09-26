/**
 * The Jev provider contract (BUILD_PROMPT 7.3). Questions use the TypeSafe SDK shapes; answers are validated.
 */
import type { EntryType, NoulResponse, Question, Questions, ResultFor } from '@typesafe-ai/sdk';

export type {
  ChoiceQuestion,
  EntryType,
  JsonValue,
  NoulQuestion,
  Question,
  Questions,
  ScoreQuestion,
} from '@typesafe-ai/sdk';
export { choice, noul, score } from '@typesafe-ai/sdk';

export type CallKind = 'issue' | 'forward' | 'tests' | 'reverse' | 'preexisting' | 'claims' | 'rerank';

export interface CallMeta {
  kind: CallKind;
  questionSet: string;
  targetId: string;
  reviewId: string;
}

export type JevAnswers<Q extends Questions> = { readonly [K in keyof Q]: ResultFor<Q[K]> };

export interface JevResult<Q extends Questions> {
  answers: JevAnswers<Q>;
  /** The model that answered, as reported by the API (for example `jev-1.13.0`). */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  /** True when the answer came from the record-and-replay cache. */
  cached: boolean;
}

/** A smaller request to retry with after an overflow; null when nothing more can be trimmed. */
export type Shrink = (attempt: number) => { state: EntryType; questions: Questions } | null;

export interface AskOptions {
  signal?: AbortSignal;
  /** Called on token overflow (pre-flight or HTTP 400/422): trim context, then drop candidates. */
  shrink?: Shrink;
}

export interface JevProvider {
  readonly model: string;
  ask<Q extends Questions>(
    meta: CallMeta,
    state: EntryType,
    questions: Q,
    opts?: AskOptions,
  ): Promise<JevResult<Q>>;
}

export type AnyAnswer = ResultFor<Question> | NoulResponse;
