import type { Question, Questions } from '@typesafe-ai/sdk';
import { z } from 'zod';
import { ProviderError } from '../common/errors.js';

const probs = z.record(z.string(), z.number().min(0).max(1));

const NoulAnswer = z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) });
const ChoiceAnswer = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: probs,
});
const ScoreAnswer = z.object({
  type: z.literal('score'),
  score: z.number(),
  confidence: z.number().min(0).max(1),
  probabilities: probs,
  legend: z.unknown().optional(),
});

const EPS = 1e-3;

function checkSum(p: Record<string, number>, where: string): void {
  const sum = Object.values(p).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > EPS) throw new Error(`${where}: probabilities sum to ${sum.toFixed(4)}, not 1`);
}

function checkOne(id: string, q: Question, raw: unknown): void {
  if (q.type === 'noul') {
    NoulAnswer.parse(raw);
    return;
  }
  if (q.type === 'choice') {
    const a = ChoiceAnswer.parse(raw);
    const keys = Object.keys(q.criteria);
    if (!keys.includes(a.choice))
      throw new Error(`${id}: choice "${a.choice}" is not one of ${keys.join(', ')}`);
    const extra = Object.keys(a.probabilities).filter((k) => !keys.includes(k));
    if (extra.length) throw new Error(`${id}: probabilities for unknown options ${extra.join(', ')}`);
    checkSum(a.probabilities, id);
    return;
  }
  const a = ScoreAnswer.parse(raw);
  const levels = q.criteria.length;
  if (a.score < 0 || a.score > levels - 1)
    throw new Error(`${id}: score ${a.score} outside 0..${levels - 1}`);
  const bad = Object.keys(a.probabilities).filter((k) => !/^\d+$/.test(k) || Number(k) >= levels);
  if (bad.length) throw new Error(`${id}: probabilities for unknown levels ${bad.join(', ')}`);
  checkSum(a.probabilities, id);
}

/** Validates answers against the questions asked (BUILD_PROMPT 7.3). Throws a `validation` ProviderError. */
export function validateAnswers(questions: Questions, answers: unknown): void {
  if (!answers || typeof answers !== 'object')
    throw new ProviderError('jev', 'validation', 'response has no answers object');
  const got = answers as Record<string, unknown>;
  try {
    for (const [id, q] of Object.entries(questions)) {
      if (!(id in got)) throw new Error(`missing answer for question "${id}"`);
      if ((got[id] as { type?: string } | undefined)?.type !== q.type)
        throw new Error(`${id}: expected a ${q.type} answer`);
      checkOne(id, q, got[id]);
    }
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : (e as Error).message;
    throw new ProviderError('jev', 'validation', `invalid answer: ${msg}`);
  }
}
