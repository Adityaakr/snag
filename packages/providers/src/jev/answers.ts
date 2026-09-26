import type { Answer } from '@remit/core';
import type { Questions } from '@typesafe-ai/sdk';
import type { JevAnswers } from './types.js';

/** Converts provider answers to the `Answer` contract (BUILD_PROMPT 5) for storage and explanation. */
export function toAnswers<Q extends Questions>(call: string, answers: JevAnswers<Q>): Answer[] {
  return Object.entries(
    answers as Record<
      string,
      {
        type: string;
        noul?: number;
        choice?: string;
        score?: number;
        probabilities?: Record<string, number>;
        confidence?: number;
      }
    >,
  ).map(([question, a]) => {
    if (a.type === 'noul') return { call, question, type: 'noul', value: a.noul as number };
    if (a.type === 'choice') {
      return {
        call,
        question,
        type: 'choice',
        value: a.choice as string,
        probabilities: { ...a.probabilities },
        confidence: a.confidence as number,
      };
    }
    return {
      call,
      question,
      type: 'score',
      value: a.score as number,
      probabilities: { ...a.probabilities },
      confidence: a.confidence as number,
    };
  });
}
