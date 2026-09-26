/**
 * A heuristic stand-in for Jev used only when no keys exist (BUILD_PROMPT M6: "Without keys: the report is
 * generated from fakes and clearly marked not a real measurement"). It answers from lexical overlap and code
 * facts, never from item labels, so its numbers are a plumbing check and a weak baseline, not a result.
 */
import type { CallMeta, EntryType, JevAnswers, JevProvider, JevResult, Questions } from '@remit/providers';
import { validateAnswers } from '@remit/providers';

const tokens = (s: string) =>
  new Set((s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => !STOP.has(t)));
const STOP = new Set(
  'the and for with that this from must should will are not when have has any all into its can use'.split(
    ' ',
  ),
);

function overlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n / ta.size;
}

const noul = (p: number) => ({ type: 'noul', noul: p });
function choice(keys: string[], pick: string, p: number) {
  const rest = keys.length > 1 ? (1 - p) / (keys.length - 1) : 0;
  const probabilities = Object.fromEntries(
    keys.map((k) => [k, k === pick ? (keys.length > 1 ? p : 1) : rest]),
  );
  return {
    type: 'choice',
    choice: pick,
    confidence: Math.max(...Object.values(probabilities)),
    probabilities,
  };
}
function score(levels: number[]) {
  return {
    type: 'score',
    score: levels.reduce((s, p, i) => s + p * i, 0),
    confidence: Math.max(...levels),
    legend: {},
    probabilities: Object.fromEntries(levels.map((p, i) => [String(i), p])),
  };
}

export class SimulatedJev implements JevProvider {
  readonly model = 'simulated-jev';
  calls = 0;

  async ask<Q extends Questions>(meta: CallMeta, state: EntryType, questions: Q): Promise<JevResult<Q>> {
    this.calls++;
    const s = (state ?? {}) as Record<string, unknown>;
    const req = (s.requirement ?? {}) as { text?: string; quote?: string };
    const reqText = `${req.text ?? ''} ${req.quote ?? ''}`;
    const answers: Record<string, unknown> = {};
    const keysOf = (id: string) =>
      Object.keys((questions[id] as { criteria: Record<string, unknown> }).criteria);
    const best = (items: { id: string; text: string }[], text: string) => {
      let top = { id: 'none', o: 0 };
      for (const it of items) {
        const o = overlap(text, it.text);
        if (o > top.o) top = { id: it.id, o };
      }
      return top;
    };
    for (const [id, q] of Object.entries(questions)) {
      if (meta.kind === 'issue') answers[id] = noul(id === 'ambiguous' ? 0.3 : 0.85);
      else if (meta.kind === 'forward') {
        const cands = (
          (s.candidates ?? []) as { id: string; change: string; file: string; symbol: string }[]
        ).map((c) => ({
          id: c.id,
          text: `${c.file} ${c.symbol} ${c.change
            .split('\n')
            .filter((l) => l.startsWith('+'))
            .join(' ')}`,
        }));
        const top = best(cands, reqText);
        if (id === 'coverage')
          answers[id] = score(
            top.o > 0.5
              ? [0.05, 0.05, 0.2, 0.7]
              : top.o > 0.25
                ? [0.1, 0.2, 0.5, 0.2]
                : [0.72, 0.18, 0.05, 0.05],
          );
        else if (id === 'conflict') answers[id] = noul(0.1);
        else answers[id] = choice(keysOf(id), top.o > 0.25 ? top.id : 'none', 0.8);
      } else if (meta.kind === 'tests') {
        const tests = ((s.tests ?? []) as { id: string; titles: string[]; change: string }[]).map((t) => ({
          id: t.id,
          text: `${t.titles.join(' ')} ${t.change}`,
        }));
        const top = best(tests, reqText);
        if (id === 'asserts_as_stated') answers[id] = noul(top.o > 0.3 ? 0.7 : 0.2);
        else if (id === 'test_evidence')
          answers[id] = choice(keysOf(id), top.o > 0.3 ? top.id : 'none', 0.75);
        else answers[id] = noul(id.endsWith('_checked') ? 0.5 : 0.1);
      } else if (meta.kind === 'reverse') {
        const change = (s.change ?? {}) as { file: string; symbol: string; kind: string; change: string };
        const reqs = ((s.requirements ?? []) as { id: string; text: string }[]).map((r) => ({
          id: r.id,
          text: r.text,
        }));
        const added = change.change
          .split('\n')
          .filter((l) => l.startsWith('+') || l.startsWith('-'))
          .join(' ');
        const top = best(reqs, `${change.file} ${change.symbol} ${added}`);
        if (id === 'serves') answers[id] = choice(keysOf(id), top.o > 0.2 ? top.id : 'none', 0.7);
        else if (id === 'plumbing') answers[id] = noul(0.2);
        else if (id === 'behavior_change') answers[id] = noul(change.kind === 'docs' ? 0.1 : 0.65);
        else if (id === 'loosens_test')
          answers[id] = noul(
            /toBeDefined|toBeTruthy|is_ok\(\)|\.skip|#\[ignore\]|pytest\.mark\.skip|approx/.test(added)
              ? 0.8
              : 0.1,
          );
        else answers[id] = noul(0.6);
      } else if (meta.kind === 'claims') {
        const sentence = String(s.sentence ?? '');
        const reqs = ((s.requirements ?? []) as { id: string; text: string }[]).map((r) => ({
          id: r.id,
          text: r.text,
        }));
        if (id === 'claims_done')
          answers[id] = noul(/\b(done|implement|adds?|all)\b/i.test(sentence) ? 0.8 : 0.2);
        else if (id === 'claims_deferred')
          answers[id] = noul(/\b(later|follow-?up|part 1|todo|not yet)\b/i.test(sentence) ? 0.8 : 0.1);
        else {
          const top = best(reqs, sentence);
          answers[id] = choice(keysOf(id), top.o > 0.3 ? top.id : 'none', 0.7);
        }
      } else if (meta.kind === 'preexisting') answers[id] = noul(0.2);
      else if (meta.kind === 'rerank')
        answers[id] = noul(
          Math.min(0.95, overlap(reqText, (q as { instructions: string }).instructions) + 0.05),
        );
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
}
