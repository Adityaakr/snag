/**
 * OracleJev: answers Remit's typed questions from a mutation item's ground-truth labels and its seed's annotations,
 * and records a supervised training example for every question whose answer the labels decide (DECISIONS D35).
 *
 * It exists to fine-tune a local verdict engine (Laya) on exactly the states the pipeline builds. Answers steer the
 * pipeline down the branches the labels imply (widening, preexisting checks), so the recorded states are the ones a
 * good engine would see. Questions the labels do not decide get a neutral flow answer and no training target.
 *
 * Only dev-split items may be used: the builder refuses seeds whose `split` is not `dev` (the frozen test seeds live
 * in `seeds/` too, outside guard:split).
 */
import type { CallMeta, EntryType, JevAnswers, JevProvider, JevResult, Questions } from '@remit/providers';
import { validateAnswers } from '@remit/providers';
import { adjudicationFor, EXCLUDED_TEST_REFS } from './adjudications.js';
import type { EvalItem } from './item.js';
import type { Seed } from './mutations/seed.js';

type Question = Questions[string];

/** A training target: P(yes) for Noul, a distribution over option keys for Choice and Score. */
export type Target = { noul: number } | { probabilities: Record<string, number> };

export interface TrainingRecord {
  itemId: string;
  seedId: string;
  operator: string;
  call: CallMeta['kind'];
  targetId: string;
  qid: string;
  question: Question;
  state: EntryType;
  target: Target;
  /**
   * For forward and tests calls: the candidate ids that implement (forward) or test (tests) the requirement, per the
   * seed. The trainer removes them to build counterfactual "missing" twins.
   */
  support?: string[];
}

interface UnitLike {
  id?: string;
  file?: string;
  symbol?: string;
  /** Test units in `tests.v0` states carry their describe/it titles instead of a symbol. */
  titles?: string[];
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** A unit matches a seed ref when the files are equal and, if the ref names a symbol, the symbols agree. */
export function refMatches(unit: UnitLike, ref: { file: string; symbol?: string | undefined }): boolean {
  if (norm(unit.file) !== norm(ref.file)) return false;
  if (!ref.symbol) return true;
  const b = norm(ref.symbol);
  const names = [unit.symbol, ...(unit.titles ?? [])].map(norm).filter(Boolean);
  // Exact names only: substring matching let `get` match `get_bool` and `parse` match `parse_errors_name_the_input`.
  return names.some((a) => a === b);
}

const noulAnswer = (p: number) => ({ type: 'noul', noul: p });

function distAnswer(type: 'choice' | 'score', keys: string[], probs: Record<string, number>) {
  const sum = keys.reduce((s, k) => s + (probs[k] ?? 0), 0) || 1;
  const probabilities = Object.fromEntries(keys.map((k) => [k, (probs[k] ?? 0) / sum]));
  const top = keys.reduce((b, k) => ((probabilities[k] ?? 0) > (probabilities[b] ?? 0) ? k : b));
  const confidence = Math.max(...Object.values(probabilities));
  return type === 'choice'
    ? { type, choice: top, probabilities, confidence }
    : {
        type,
        score: keys.reduce((s, k) => s + Number(k) * (probabilities[k] ?? 0), 0),
        probabilities,
        confidence,
      };
}

function keysOf(q: Question): string[] {
  if (q.type === 'choice') return Object.keys(q.criteria);
  if (q.type === 'score') return q.criteria.map((_, i) => String(i));
  return [];
}

const oneHot = (key: string) => ({ [key]: 1 });
const spread = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, 1 / keys.length]));

export class OracleJev implements JevProvider {
  readonly model = 'oracle';
  readonly records: TrainingRecord[] = [];

  constructor(
    private readonly item: EvalItem,
    private readonly seed: Seed,
  ) {
    if (seed.split !== 'dev')
      throw new Error(`OracleJev refuses seed ${seed.id}: split ${seed.split ?? 'unset'}`);
  }

  private label(reqId: string): string | undefined {
    return this.item.labels.requirements[reqId];
  }

  private seedReq(reqId: string) {
    const req = this.seed.requirements.find((r) => r.id === reqId);
    if (!req) return undefined;
    // Drop test refs the audit found do not assert this requirement.
    const excluded = EXCLUDED_TEST_REFS.filter((x) => x.seedId === this.seed.id && x.requirement === reqId);
    return excluded.length
      ? { ...req, tests: req.tests.filter((t) => !excluded.some((x) => norm(x.symbol) === norm(t.symbol))) }
      : req;
  }

  /** The requirement ids whose implementing or test refs match the unit. */
  private servedBy(unit: UnitLike): string[] {
    return this.seed.requirements
      .filter((r) => [...r.implementing, ...r.tests].some((ref) => refMatches(unit, ref)))
      .map((r) => r.id);
  }

  private unitLabel(unit: UnitLike) {
    return this.item.labels.units.find((u) => refMatches(unit, { file: u.file, symbol: u.symbol }));
  }

  private isMutatedTest(unit: UnitLike): boolean {
    const op = this.item.operator;
    if (op !== 'weaken_assertion' && op !== 'skip_test') return false;
    return refMatches(unit, this.seed.unrelatedTest);
  }

  /** Candidate ids implementing (forward) or testing (tests) the call's requirement, when the seed names any. */
  private support(meta: CallMeta, state: Record<string, unknown>): string[] | undefined {
    const req = this.seedReq(meta.targetId);
    if (!req) return undefined;
    if (meta.kind === 'forward')
      return ((state.candidates ?? []) as UnitLike[])
        .filter((c) => c.id && req.implementing.some((ref) => refMatches(c, ref)))
        .map((c) => c.id as string);
    if (meta.kind === 'tests')
      return ((state.tests ?? []) as UnitLike[])
        .filter((t) => t.id && req.tests.some((ref) => refMatches(t, ref)))
        .map((t) => t.id as string);
    return undefined;
  }

  /** Target for one question, or null when the labels do not decide it. */
  private target(meta: CallMeta, qid: string, q: Question, state: Record<string, unknown>): Target | null {
    const op = this.item.operator ?? 'clean';
    const keys = keysOf(q);
    if (meta.kind === 'forward') {
      const L = this.label(meta.targetId);
      const req = this.seedReq(meta.targetId);
      const unwired = op === 'unwire' && this.item.target === meta.targetId;
      if (qid === 'coverage') {
        if (unwired || L === 'contradicted') return null;
        const level = { done: '3', partial: '2', missing: '0' }[L ?? ''];
        return level && keys.includes(level) ? { probabilities: oneHot(level) } : null;
      }
      if (qid === 'conflict') {
        // A removed case or a skipped call site can produce the opposite outcome for some inputs, so "conflict" is
        // genuinely ambiguous for the targeted requirement of partial and unwire items: no label (audit).
        const targeted = this.item.target === meta.targetId;
        if (targeted && (op === 'partial_requirement' || op === 'unwire')) return null;
        if (L === 'contradicted') return { noul: 1 };
        return L === 'done' || L === 'partial' || L === 'missing' ? { noul: 0 } : null;
      }
      if (qid === 'evidence') {
        if (L === 'missing') return keys.includes('none') ? { probabilities: oneHot('none') } : null;
        const cands = (state.candidates ?? []) as UnitLike[];
        const hits = cands
          .filter((c) => c.id && req?.implementing.some((ref) => refMatches(c, ref)))
          .map((c) => c.id as string)
          .filter((id) => keys.includes(id));
        return hits.length && L !== undefined ? { probabilities: spread(hits) } : null;
      }
      return null;
    }
    if (meta.kind === 'tests') {
      const L = this.label(meta.targetId);
      const req = this.seedReq(meta.targetId);
      const tests = ((state.tests ?? []) as UnitLike[]).filter(
        (t) => t.id && req?.tests.some((ref) => refMatches(t, ref)),
      );
      if (op === 'unwire' && this.item.target === meta.targetId) return null;
      if (qid === 'asserts_as_stated') {
        if (L === 'done' && tests.length) return { noul: 1 };
        if (L === 'missing' || L === 'contradicted') return { noul: 0 };
        return null;
      }
      if (qid === 'asserts_differently') {
        if (L === 'contradicted') return { noul: 1 };
        return L === 'done' || L === 'missing' ? { noul: 0 } : null;
      }
      if (qid === 'test_evidence') {
        if (L === 'missing') return keys.includes('none') ? { probabilities: oneHot('none') } : null;
        const ids = tests.map((t) => t.id as string).filter((id) => keys.includes(id));
        return L === 'done' && ids.length ? { probabilities: spread(ids) } : null;
      }
      return null;
    }
    if (meta.kind === 'reverse') {
      const change = (state.change ?? {}) as UnitLike;
      const role =
        this.unitLabel(change)?.role ?? this.seed.incidental?.find((r) => refMatches(change, r))?.role;
      const served = this.servedBy(change).filter((r) => keys.includes(r));
      const mutatedTest = this.isMutatedTest(change);
      const injected = role === 'unexplained_behavioral' || role === 'unexplained_benign';
      if (qid === 'serves') {
        if (injected || mutatedTest || role === 'supporting')
          return keys.includes('none') ? { probabilities: oneHot('none') } : null;
        // A unit that serves two requirements is split between them; the flow answer picks the first.
        return served.length ? { probabilities: spread(served) } : null;
      }
      if (qid === 'behavior_change') {
        if (role === 'unexplained_behavioral') return { noul: 1 };
        if (role === 'unexplained_benign') return { noul: 0 };
        return null;
      }
      if (qid === 'runtime_setting') return role === 'unexplained_behavioral' ? { noul: 1 } : null;
      if (qid === 'loosens_test') {
        if (mutatedTest && op === 'weaken_assertion') return { noul: 1 };
        if (mutatedTest && op === 'skip_test') return { noul: 1 };
        return served.length ? { noul: 0 } : null;
      }
      if (qid === 'plumbing') return role === 'supporting' ? { noul: 1 } : injected ? { noul: 0 } : null;
      return null;
    }
    if (meta.kind === 'claims' && op === 'claim_all_done') {
      const words = (t: string) => new Set(norm(t).match(/[a-z0-9]{3,}/g) ?? []);
      const sent = words(String(state.sentence ?? ''));
      const overlap = (t: string) => {
        const w = words(t);
        let n = 0;
        for (const x of w) if (sent.has(x)) n++;
        return w.size ? n / w.size : 0;
      };
      const about = this.seed.requirements.find((r) => overlap(r.text) >= 0.8);
      if (!about) return null;
      if (qid === 'claims_done') return { noul: 1 };
      if (qid === 'claims_deferred') return { noul: 0 };
      if (qid === 'about') return keys.includes(about.id) ? { probabilities: oneHot(about.id) } : null;
    }
    return null;
  }

  /** The answer the pipeline sees: the target when there is one, otherwise a neutral default for the flow. */
  private flow(meta: CallMeta, qid: string, q: Question): unknown {
    const keys = keysOf(q);
    if (q.type === 'noul') {
      const defaults: Record<string, number> = {
        ambiguous: 0.1,
        checkable_in_code: 0.95,
        already_implemented: 0.05,
        claims_done: 0.1,
        claims_deferred: 0.02,
      };
      return noulAnswer(defaults[qid] ?? 0.2);
    }
    if (q.type === 'score') {
      const L = meta.kind === 'forward' ? this.label(meta.targetId) : undefined;
      const level = L === 'missing' ? '0' : L === 'partial' ? '2' : '3';
      return distAnswer('score', keys, oneHot(keys.includes(level) ? level : (keys.at(-1) as string)));
    }
    return distAnswer('choice', keys, oneHot(keys.includes('none') ? 'none' : (keys[0] as string)));
  }

  async ask<Q extends Questions>(meta: CallMeta, state: EntryType, questions: Q): Promise<JevResult<Q>> {
    const s = (state ?? {}) as Record<string, unknown>;
    const answers: Record<string, unknown> = {};
    for (const [qid, q] of Object.entries(questions)) {
      let t = this.target(meta, qid, q, s);
      const flowTarget = t;
      if (t && (meta.kind === 'forward' || meta.kind === 'tests')) {
        const adj = adjudicationFor(
          this.seed.id,
          this.item.operator ?? 'clean',
          meta.targetId,
          `${meta.kind}.${qid}`,
        );
        if (adj?.action === 'exclude') t = null;
        else if (adj?.action === 'relabel') t = { noul: adj.noul };
      }
      if (t) {
        const support = this.support(meta, s);
        this.records.push({
          ...(support ? { support } : {}),
          itemId: this.item.id,
          seedId: this.seed.id,
          operator: this.item.operator ?? 'clean',
          call: meta.kind,
          targetId: meta.targetId,
          qid,
          question: q,
          state,
          target: t,
        });
        // The flow answer follows the target; a split target is steered to its first key so thresholds pass.
        const probs = 'noul' in t ? {} : t.probabilities;
        const flowProbs = Object.keys(probs).length > 1 ? oneHot(Object.keys(probs)[0] as string) : probs;
        answers[qid] =
          'noul' in t ? noulAnswer(t.noul) : distAnswer(q.type as 'choice' | 'score', keysOf(q), flowProbs);
      } else if (flowTarget) {
        // Excluded from training, but the pipeline still follows the label-implied answer.
        answers[qid] =
          'noul' in flowTarget
            ? noulAnswer(flowTarget.noul)
            : distAnswer(q.type as 'choice' | 'score', keysOf(q), flowTarget.probabilities);
      } else answers[qid] = this.flow(meta, qid, q);
    }
    validateAnswers(questions, answers);
    return {
      answers: answers as unknown as JevAnswers<Q>,
      model: this.model,
      usage: { inputTokens: 0, outputTokens: 0 },
      costUsd: 0,
      cached: false,
    };
  }
}
