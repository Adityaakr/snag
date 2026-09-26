/**
 * One review end to end (BUILD_PROMPT 4.1, 6): blind extraction, units and facts, retrieval, forward/tests/
 * reverse calls, the claims check after the blind pass, the verdict loop (one widen round and one preexisting
 * call per requirement at most), unit rules and routing. A review is a pure function of issue snapshots, PR
 * snapshot, config and provider answers; every network call goes through the injected providers.
 */
import {
  applyRerank,
  type BaseSymbol,
  buildUnits,
  type ContentSource,
  detectFacts,
  extractSymbols,
  isParsed,
  languageOf,
  limitUnits,
  matchAny,
  parseDiff,
  type ReferenceIndex,
  Retriever,
  selectBaseCode,
  selectCandidates,
  stripComments,
  widen,
  type AttributeRule,
} from '@remit/analysis';
import {
  BRAND,
  type Calibration,
  type ChangeUnit,
  type ClaimSignal,
  calibrator,
  tunedThresholds,
  claimSentences,
  claimsQuestions,
  claimsState,
  estimateTokens,
  EXTRACTION_PROMPT_VERSION,
  FORWARD_CALL,
  type ForwardCandidate,
  type ForwardSignal,
  forwardQuestions,
  forwardState,
  PREEXISTING_CALL,
  preexistingQuestions,
  preexistingState,
  QUESTION_SET_VERSION,
  type RemitConfig,
  type Requirement,
  type RequirementContext,
  type RequirementOutcome,
  requirementState,
  REVERSE_CALL,
  type ReverseSignal,
  type ReviewResult,
  rerankBatches,
  reverseQuestions,
  reverseState,
  routeFindings,
  requirementVerdict,
  SCHEMA_VERSION,
  TESTS_CALL,
  type TestsSignal,
  testsQuestions,
  testsState,
  type UnitContext,
  unitVerdict,
} from '@remit/core';
import {
  type CallKind,
  CostTracker,
  type JevProvider,
  type LlmProvider,
  ProviderError,
  type Questions,
  toAnswers,
} from '@remit/providers';
import { type ExtractionResult, extractRequirements } from './extract.js';
import type { ReviewInput } from './types.js';

export const PRODUCT_VERSION = '0.1.0';

export interface ReviewDeps {
  jev?: JevProvider;
  llm?: LlmProvider;
  config: RemitConfig;
  reviewId: string;
  costs?: CostTracker;
  calibration?: Calibration;
  contents?: ContentSource;
  references?: ReferenceIndex;
  attributes?: AttributeRule[];
  confirmed?: Parameters<typeof extractRequirements>[1]['confirmed'];
  now?: () => number;
}

type AnyAnswers = Record<
  string,
  {
    type: string;
    noul?: number;
    choice?: string;
    score?: number;
    probabilities?: Record<string, number>;
    confidence?: number;
  }
>;

/** Converts a forward.v0 answer set to the verdict engine's signal. */
export function forwardSignal(answers: AnyAnswers): ForwardSignal {
  const cov = answers.coverage;
  const p = cov?.probabilities ?? {};
  const levels: [number, number, number, number] = [p['0'] ?? 0, p['1'] ?? 0, p['2'] ?? 0, p['3'] ?? 0];
  const ev = answers.evidence;
  return {
    levels,
    confidence: cov?.confidence ?? 0,
    conflict: answers.conflict?.noul ?? 0,
    evidence:
      ev?.choice && ev.choice !== 'none'
        ? { unitId: ev.choice, probability: ev.probabilities?.[ev.choice] ?? 0 }
        : null,
    answers: toAnswers(FORWARD_CALL, answers as never),
  };
}

export function testsSignal(answers: AnyAnswers, hasCandidates: boolean, exampleCount: number): TestsSignal {
  const ev = answers.test_evidence;
  const n = Math.min(exampleCount, 5);
  return {
    hasCandidates,
    assertsAsStated: answers.asserts_as_stated?.noul ?? 0,
    assertsDifferently: answers.asserts_differently?.noul ?? 0,
    examplesChecked: Array.from({ length: n }, (_, i) => answers[`example_${i}_checked`]?.noul ?? 0),
    examplesContradicted: Array.from(
      { length: n },
      (_, i) => answers[`example_${i}_contradicted`]?.noul ?? 0,
    ),
    evidence:
      ev?.choice && ev.choice !== 'none'
        ? { unitId: ev.choice, probability: ev.probabilities?.[ev.choice] ?? 0 }
        : null,
    answers: toAnswers(TESTS_CALL, answers as never),
  };
}

export function reverseSignal(answers: AnyAnswers): ReverseSignal {
  const serves = answers.serves;
  const probs = serves?.probabilities ?? {};
  let bestId: string | null = null;
  let best = 0;
  for (const [k, v] of Object.entries(probs)) {
    if (k !== 'none' && v > best) {
      best = v;
      bestId = k;
    }
  }
  return {
    servesTop: serves?.choice ?? 'none',
    servesRequirementProbability: best,
    servesRequirementId: bestId,
    plumbing: answers.plumbing?.noul ?? 0,
    behaviorChange: answers.behavior_change?.noul ?? 0,
    ...(answers.loosens_test ? { loosensTest: answers.loosens_test.noul ?? 0 } : {}),
    ...(answers.runtime_setting ? { runtimeSetting: answers.runtime_setting.noul ?? 0 } : {}),
    answers: toAnswers(REVERSE_CALL, answers as never),
  };
}

function candidateEntry(u: ChangeUnit, withAfter = true): ForwardCandidate {
  return {
    id: u.id,
    file: u.file,
    symbol: u.symbol?.name ?? '(file)',
    change: u.judgeView,
    ...(withAfter && u.after !== undefined ? { after: u.after } : {}),
  };
}

function neutral(input: ReviewInput, deps: ReviewDeps, warnings: string[], started: number): ReviewResult {
  return assemble(
    input,
    deps,
    {
      requirements: [],
      units: [],
      requirementVerdicts: [],
      unitVerdicts: [],
      claims: [],
      findings: [],
      summary: { counts: {}, mode: deps.config.mode },
      warnings,
    },
    started,
  );
}

function assemble(
  input: ReviewInput,
  deps: ReviewDeps,
  body: Pick<
    ReviewResult,
    | 'requirements'
    | 'units'
    | 'requirementVerdicts'
    | 'unitVerdicts'
    | 'claims'
    | 'findings'
    | 'summary'
    | 'warnings'
  >,
  started: number,
  llmModel?: string,
): ReviewResult {
  const u = deps.costs?.usage;
  const now = deps.now ?? Date.now;
  const cal = calibrator(deps.calibration, deps.config.jev.model, QUESTION_SET_VERSION);
  return {
    schemaVersion: SCHEMA_VERSION,
    product: { name: BRAND.name, version: PRODUCT_VERSION },
    input: {
      mode: input.mode,
      ...(input.repo ? { repo: input.repo } : {}),
      ...(input.prNumber ? { pr: input.prNumber } : {}),
      baseSha: input.baseSha,
      headSha: input.headSha,
      issues: input.issueRefs,
      linkStrength: input.linkStrength,
    },
    versions: {
      questionSet: QUESTION_SET_VERSION,
      extractionPrompt: EXTRACTION_PROMPT_VERSION,
      jevModel: deps.jev?.model ?? deps.config.jev.model,
      ...(llmModel ? { llmModel } : {}),
      ...(cal.calibrated && deps.calibration ? { calibration: deps.calibration.id } : {}),
    },
    ...body,
    usage: {
      jevInputTokens: u?.jevInputTokens ?? 0,
      llmInputTokens: u?.llmInputTokens ?? 0,
      llmOutputTokens: u?.llmOutputTokens ?? 0,
      costUsd: Number((u?.costUsd ?? 0).toFixed(6)),
      latencyMs: Math.max(0, now() - started),
      calls: u?.calls ?? 0,
    },
  };
}

/** Runs one review. Never throws for provider failures: they become warnings and partial results. */
export async function runReview(input: ReviewInput, deps: ReviewDeps): Promise<ReviewResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const config = deps.config;
  const t = tunedThresholds(
    config.thresholds,
    deps.calibration,
    deps.jev?.model ?? config.jev.model,
    QUESTION_SET_VERSION,
  );
  const warnings: string[] = [];
  const costs = deps.costs ?? new CostTracker(config.budgets.max_usd_per_review);
  deps = { ...deps, costs };

  if (!input.issues.length) {
    warnings.push(
      `No linked issue was found, so ${BRAND.name} cannot check intent. Link one with a closing keyword in the PR description, for example "Fixes #123" or "Closes owner/repo#123".`,
    );
    return neutral(input, deps, warnings, started);
  }

  // Stage 1: blind extraction. Only issue snapshots go in.
  let extraction: ExtractionResult;
  try {
    extraction = await extractRequirements(input.issues, {
      ...(deps.llm ? { llm: deps.llm } : {}),
      ...(deps.jev ? { jev: deps.jev } : {}),
      config,
      reviewId: deps.reviewId,
      ...(deps.confirmed ? { confirmed: deps.confirmed } : {}),
    });
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    warnings.push(`Requirement extraction failed: ${e.message}. ${e.fix ?? ''}`.trim());
    return neutral(input, deps, warnings, started);
  }
  warnings.push(...extraction.warnings);
  const requirements = extraction.requirements;
  const active = requirements.filter((r) => !r.supersededBy);

  // Stage 2: units and code facts.
  const parsed = parseDiff(input.diffText);
  const ignoredPaths = parsed.files.filter((f) =>
    matchAny((f.newPath ?? f.oldPath) as string, config.ignore_paths),
  );
  if (ignoredPaths.length)
    warnings.push(`${ignoredPaths.length} file(s) matched ignore_paths and were not reviewed.`);
  parsed.files = parsed.files.filter((f) => !ignoredPaths.includes(f));
  const built = await buildUnits(parsed, {
    ...(deps.contents ? { contents: deps.contents } : {}),
    ...(deps.attributes ? { attributes: deps.attributes } : {}),
  });
  warnings.push(...built.warnings);
  const limited = limitUnits(built.units, config.budgets.max_units);
  if (limited.warning) warnings.push(limited.warning);
  const factResult = await detectFacts(limited.units, {
    ...(deps.contents ? { contents: deps.contents } : {}),
    ...(deps.references ? { references: deps.references } : {}),
  });
  warnings.push(...factResult.warnings);
  const units = factResult.units;
  const reviewable = units.filter((u) => !u.filtered);
  const implPool = reviewable.filter((u) => u.kind !== 'test');
  const testPool = reviewable.filter((u) => u.kind === 'test');

  const jev = deps.jev;
  let budgetHit = false;
  const ask = async <Q extends Questions>(
    kind: CallKind,
    targetId: string,
    state: unknown,
    questions: Q,
    shrink?: Parameters<JevProvider['ask']>[3],
  ): Promise<AnyAnswers | undefined> => {
    if (!jev || budgetHit) return undefined;
    try {
      const res = await jev.ask(
        { kind, questionSet: QUESTION_SET_VERSION, targetId, reviewId: deps.reviewId },
        state as never,
        questions,
        shrink,
      );
      return res.answers as unknown as AnyAnswers;
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      if (e.kind === 'budget') {
        budgetHit = true;
        warnings.push(`Budget reached: ${e.message}. The result is partial.`);
      } else warnings.push(`${kind} ${targetId}: ${e.message}`);
      return undefined;
    }
  };
  if (!jev) warnings.push('No Jev provider is configured, so there are no verdicts. Set TYPESAFE_API_KEY.');

  const reqStateTokens = (r: Requirement) => estimateTokens(requirementState(r));
  const budgetFor = (r: Requirement) => config.jev.max_state_tokens - reqStateTokens(r) - 1500;
  const implRetriever = new Retriever(implPool);
  const testRetriever = new Retriever(testPool);
  const sizeOf = (u: ChangeUnit) => estimateTokens(candidateEntry(u));
  const testSize = (u: ChangeUnit) =>
    estimateTokens({ id: u.id, file: u.file, titles: u.testTitles ?? [], change: u.judgeView });

  const forwardCall = async (
    r: Requirement,
    cands: ChangeUnit[],
    label: string,
  ): Promise<ForwardSignal | undefined> => {
    if (!cands.length)
      return { levels: [1, 0, 0, 0], confidence: 1, conflict: 0, evidence: null, answers: [] };
    let current = cands.map((u) => candidateEntry(u));
    const shrink = {
      // 7.3: trim before/after context first, then drop the lowest-ranked candidate.
      shrink: (attempt: number) => {
        if (current.some((c) => c.after !== undefined)) current = current.map(({ after: _a, ...c }) => c);
        else if (current.length > 1) current = current.slice(0, -1);
        else return null;
        void attempt;
        return { state: forwardState(r, current) as never, questions: forwardQuestions(current) };
      },
    };
    const a = await ask('forward', label, forwardState(r, current), forwardQuestions(current), shrink);
    return a ? forwardSignal(a) : undefined;
  };

  /** Candidate selection for one pool (6.5 steps 3 and 4), running rerank.v0 when more than 40 units score. */
  const choose = async (
    r: Requirement,
    ranked: ReturnType<Retriever['rank']>,
    budget: number,
    size: (u: ChangeUnit) => number,
    tag: string,
  ) => {
    const sel = selectCandidates(ranked, budget, size);
    if (sel.kind !== 'rerank') return { units: sel.units, order: ranked.map((x) => x.unit) };
    const batches = rerankBatches(
      r,
      sel.pool.map((u) => ({ id: u.id, file: u.file, judgeView: u.judgeView })),
    );
    const relevance = new Map<string, number>();
    for (const [i, b] of batches.entries()) {
      const a = await ask('rerank', `${r.id}#${tag}${i + 1}`, b.state, b.questions);
      for (const [qid, ans] of Object.entries(a ?? {})) relevance.set(qid.replace(/^c_/, ''), ans.noul ?? 0);
    }
    const applied = applyRerank(sel.pool, relevance, sel.rest, budget, size);
    return { units: applied.units, order: [...applied.units, ...applied.rest] };
  };

  // Stage 3: forward, tests and reverse calls (parallel; the provider limits concurrency).
  const forwardCands = new Map<string, { used: ChangeUnit[]; ranked: ChangeUnit[] }>();
  const forward = new Map<string, ForwardSignal | undefined>();
  const tests = new Map<string, TestsSignal | undefined>();
  await Promise.all(
    active.map(async (r) => {
      const budget = budgetFor(r);
      const impl = await choose(r, implRetriever.rank(r), budget, sizeOf, 'b');
      const chosen = impl.units;
      const rankedOrder = impl.order;
      forwardCands.set(r.id, { used: chosen, ranked: rankedOrder });
      forward.set(r.id, await forwardCall(r, chosen, r.id));

      if (r.kind !== 'non_goal') {
        // Tests use the same procedure over test units only (6.5 step 6), rerank included.
        const testUnits = (await choose(r, testRetriever.rank(r), budget, testSize, 't')).units;
        if (testUnits.length || r.examples.length) {
          const entries = testUnits.map((u) => ({
            id: u.id,
            file: u.file,
            titles: u.testTitles ?? [],
            change: u.judgeView,
          }));
          const a = await ask(
            'tests',
            r.id,
            testsState(r, entries),
            testsQuestions(entries, r.examples.length),
          );
          tests.set(r.id, a ? testsSignal(a, testUnits.length > 0, r.examples.length) : undefined);
        }
      }
    }),
  );

  const reverse = new Map<string, ReverseSignal | undefined>();
  await Promise.all(
    reviewable.map(async (u) => {
      const others = reviewable
        .filter((o) => o.id !== u.id)
        .map((o) => ({ id: o.id, file: o.file, symbol: o.symbol?.name ?? '(file)' }));
      const change = {
        id: u.id,
        file: u.file,
        symbol: u.symbol?.name ?? '(file)',
        kind: u.kind,
        change: u.judgeView,
      };
      const a = await ask(
        'reverse',
        u.id,
        reverseState(active, change, others),
        reverseQuestions(active, u.kind),
      );
      reverse.set(u.id, a ? reverseSignal(a) : undefined);
    }),
  );

  // Stage 4: claims, only now that the blind pass is complete (6.8).
  const claimSignals: ClaimSignal[] = [];
  const sentences = claimSentences(input.pr.title, input.pr.body);
  await Promise.all(
    sentences.map(async (sentence, i) => {
      const a = await ask('claims', `S${i + 1}`, claimsState(sentence, active), claimsQuestions(active));
      if (!a) return;
      const about = a.about?.choice ?? 'none';
      claimSignals[i] = {
        sentence,
        claimsDone: a.claims_done?.noul ?? 0,
        claimsDeferred: a.claims_deferred?.noul ?? 0,
        about: about === 'none' ? null : about,
        aboutProbability: a.about?.probabilities?.[about] ?? 0,
      };
    }),
  );
  const claims = claimSignals.filter(Boolean);

  // Stage 5: verdicts, with at most one widen round and one preexisting call per requirement.
  const unitCtx = new Map<string, UnitContext>(
    units.map((u) => [
      u.id,
      { unit: u, ...(reverse.get(u.id) ? { reverse: reverse.get(u.id) as ReverseSignal } : {}) },
    ]),
  );
  const cal = calibrator(deps.calibration, deps.jev?.model ?? config.jev.model, QUESTION_SET_VERSION);
  let baseSymbols: BaseSymbol[] | null = null;
  const outcomes: Extract<RequirementOutcome, { kind: 'verdict' }>[] = [];
  for (const r of active) {
    const ctx: RequirementContext = {
      requirement: r,
      ...(forward.get(r.id) ? { forward: forward.get(r.id) as ForwardSignal } : {}),
      ...(tests.get(r.id) ? { tests: tests.get(r.id) as TestsSignal } : {}),
      claims,
      widened: false,
      units: unitCtx,
      thresholds: t,
      calibrator: cal,
      extraAnswers: extraction.issueAnswers[r.id] ?? [],
    };
    for (let round = 0; round < 4; round++) {
      const o = requirementVerdict(ctx);
      if (o.kind === 'verdict') {
        outcomes.push(o);
        break;
      }
      if (o.need === 'widen') {
        const c = forwardCands.get(r.id);
        const more = c ? widen(c.ranked, c.used, budgetFor(r), sizeOf) : [];
        const fresh = more.filter((u) => !(c?.used ?? []).includes(u));
        if (fresh.length) {
          const f = await forwardCall(r, more, r.id);
          if (f) ctx.forward = f;
        }
        ctx.widened = true;
      } else {
        baseSymbols ??= await collectBaseSymbols(units, requirements, deps.contents);
        const code = selectBaseCode(r, baseSymbols);
        const a = code.length
          ? await ask('preexisting', r.id, preexistingState(r, code), preexistingQuestions())
          : undefined;
        ctx.preexisting = {
          alreadyImplemented: a?.already_implemented?.noul ?? 0,
          answers: a ? toAnswers(PREEXISTING_CALL, a as never) : [],
        };
      }
    }
  }

  const unitOutcomes = units.map((u) => unitVerdict(u, reverse.get(u.id), t, cal));
  const routed = routeFindings({
    requirements,
    verdicts: outcomes,
    units,
    unitOutcomes,
    mode: config.mode,
    thresholds: t,
    gate: config.gate,
    ...(deps.calibration ? { calibration: deps.calibration } : {}),
    jevModel: deps.jev?.model ?? config.jev.model,
    questionSet: QUESTION_SET_VERSION,
  });
  warnings.push(...routed.warnings);

  return assemble(
    input,
    deps,
    {
      requirements,
      units,
      requirementVerdicts: outcomes.map((o) => o.verdict),
      unitVerdicts: unitOutcomes.map((o) => o.verdict),
      claims: claims.map((c) => ({
        sentence: c.sentence,
        ...(c.about ? { requirementId: c.about } : {}),
        claimsDone: c.claimsDone,
        claimsDeferred: c.claimsDeferred,
      })),
      findings: routed.findings,
      summary: routed.summary,
      warnings,
    },
    started,
    extraction.llmModel,
  );
}

/** Base-version symbols of touched files and of files the requirements mention, comment-stripped (6.5 step 7). */
export async function collectBaseSymbols(
  units: readonly ChangeUnit[],
  requirements: readonly Requirement[],
  contents?: ContentSource,
): Promise<BaseSymbol[]> {
  if (!contents) return [];
  const files = new Set<string>();
  for (const u of units) if (u.changeType !== 'added' && !u.filtered) files.add(u.oldFile ?? u.file);
  for (const r of requirements)
    for (const m of `${r.text} ${r.quote}`.matchAll(/[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs)\b/g))
      files.add(m[0]);
  const out: BaseSymbol[] = [];
  for (const file of files) {
    const text = await contents.get('base', file);
    if (text === null) continue;
    const lang = languageOf(file);
    if (!isParsed(lang)) continue;
    const stripped = (await stripComments(lang, text)).split('\n');
    for (const s of await extractSymbols(lang, text)) {
      if (s.depth > 1) continue;
      out.push({
        file,
        symbol: s.qualifiedName,
        code: stripped.slice(s.startLine - 1, Math.min(s.endLine, s.startLine + 119)).join('\n'),
      });
    }
  }
  return out;
}
