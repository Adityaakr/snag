/**
 * Blind requirement extraction (BUILD_PROMPT 6.2). Takes issue snapshots only; the PR never reaches the prompt.
 * Modes: `auto` (task list + LLM for the rest), `llm` (LLM only), `tasklist_only` (no LLM). A confirmed checklist
 * for the issue's content hash replaces extraction. Each requirement then gets `issue.v0` signals.
 */
import {
  anchorQuote,
  buildExtractionMessage,
  checkOutput,
  coveredByTaskList,
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SYSTEM_PROMPT,
  type ExtractedRequirement,
  ExtractionOutputSchema,
  finalizeRequirements,
  type AnchoredDraft,
  type IssueSnapshot,
  ISSUE_CALL,
  issueQuestions,
  issueState,
  type OpenQuestion,
  QUESTION_SET_VERSION,
  type RemitConfig,
  type Requirement,
  taskListRequirements,
} from '@remit/core';
import {
  type JevProvider,
  type LlmMessage,
  type LlmProvider,
  ProviderError,
  repairMessages,
  toAnswers,
} from '@remit/providers';
import type { Answer } from '@remit/core';

export interface ExtractionDeps {
  llm?: LlmProvider;
  jev?: JevProvider;
  config: RemitConfig;
  reviewId: string;
  /** Returns a confirmed checklist for this issue content hash, if one exists (BUILD_PROMPT 10.2). */
  confirmed?: (issue: IssueSnapshot) => Promise<Requirement[] | null> | Requirement[] | null;
}

export interface ExtractionResult {
  requirements: Requirement[];
  openQuestions: (OpenQuestion & { issueIndex: number })[];
  /** Raw `issue.v0` answers by requirement id. */
  issueAnswers: Record<string, Answer[]>;
  warnings: string[];
  llmModel?: string;
}

const targetOf = (issue: IssueSnapshot) => `${issue.ref.owner}/${issue.ref.repo}#${issue.ref.number}`;

async function llmExtract(
  issue: IssueSnapshot,
  index: number,
  llm: LlmProvider,
  reviewId: string,
  warnings: string[],
) {
  const messages: LlmMessage[] = [{ role: 'user', content: buildExtractionMessage(issue) }];
  const opts = {
    schemaName: 'record_requirements',
    system: EXTRACTION_SYSTEM_PROMPT,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    kind: 'extract',
    targetId: targetOf(issue),
    reviewId,
  };
  const first = await llm.structured(ExtractionOutputSchema, messages, opts);
  let output = first.data;
  let check = checkOutput(issue, index, output);
  if (check.errors.length) {
    // One repair call that includes the validation errors (6.2 step 2).
    const repaired = await llm.structured(
      ExtractionOutputSchema,
      repairMessages(messages, JSON.stringify(output), check.errors.join('\n')),
      opts,
    );
    output = repaired.data;
    check = checkOutput(issue, index, output);
  }
  for (const u of check.unanchored)
    warnings.push(
      `${targetOf(issue)}: dropped requirement "${u.text.slice(0, 80)}": its quote is not in the issue.`,
    );
  return { anchored: check.anchored, openQuestions: output.openQuestions, model: first.model };
}

function anchorDrafts(issue: IssueSnapshot, index: number, drafts: ExtractedRequirement[]): AnchoredDraft[] {
  return drafts.flatMap((draft) => {
    const anchor = anchorQuote(issue, draft.quote, draft.source);
    return anchor ? [{ issueIndex: index, draft, anchor }] : [];
  });
}

/** Extracts requirements for the linked issues, in the order given (callers sort issues by number). */
export async function extractRequirements(
  issues: IssueSnapshot[],
  deps: ExtractionDeps,
): Promise<ExtractionResult> {
  const warnings: string[] = [];
  const anchored: AnchoredDraft[] = [];
  const questions: (OpenQuestion & { issueIndex: number })[] = [];
  const confirmedQuotes = new Set<string>();
  let llmModel: string | undefined;
  const mode = deps.config.extraction.mode;

  for (const [index, issue] of issues.entries()) {
    const confirmed = deps.confirmed ? await deps.confirmed(issue) : null;
    if (confirmed?.length) {
      const drafts = confirmed.map((r, i): ExtractedRequirement => ({ ...r, id: `C${i + 1}` }));
      for (const d of drafts) confirmedQuotes.add(`${index}|${d.quote}`);
      anchored.push(...anchorDrafts(issue, index, drafts));
      continue;
    }
    const tasks = mode === 'llm' ? [] : taskListRequirements(issue);
    anchored.push(...anchorDrafts(issue, index, tasks));
    if (mode === 'tasklist_only') {
      if (!tasks.length)
        warnings.push(`${targetOf(issue)}: extraction.mode is tasklist_only but the issue has no task list.`);
      continue;
    }
    if (!deps.llm) {
      if (mode === 'auto' && tasks.length) {
        warnings.push(`${targetOf(issue)}: no LLM is configured; using the task list only.`);
        continue;
      }
      throw new ProviderError(
        'llm',
        'config',
        'no LLM is configured for requirement extraction',
        'Set ANTHROPIC_API_KEY, or use extraction.mode: tasklist_only.',
      );
    }
    try {
      const r = await llmExtract(issue, index, deps.llm, deps.reviewId, warnings);
      llmModel = r.model;
      anchored.push(...r.anchored.filter((a) => !coveredByTaskList(a.draft.quote, tasks)));
      questions.push(...r.openQuestions.map((q) => ({ ...q, issueIndex: index })));
    } catch (e) {
      if (tasks.length && e instanceof ProviderError) {
        warnings.push(`${targetOf(issue)}: LLM extraction failed (${e.message}); using the task list only.`);
        continue;
      }
      throw e;
    }
  }

  const final = finalizeRequirements(issues, anchored, questions);
  warnings.push(...final.warnings);
  for (const r of final.requirements) {
    const index = issues.findIndex(
      (i) => i.ref.number === r.issue.number && i.ref.repo === r.issue.repo && i.ref.owner === r.issue.owner,
    );
    if (confirmedQuotes.has(`${index}|${r.quote}`)) r.confirmed = true;
  }

  // issue.v0 per active requirement: ambiguity and checkability (6.2 "After extraction").
  const issueAnswers: Record<string, Answer[]> = {};
  if (deps.jev) {
    const jev = deps.jev;
    const t = deps.config.thresholds;
    await Promise.all(
      final.requirements
        .filter((r) => !r.supersededBy)
        .map(async (r) => {
          const issue = issues.find(
            (i) =>
              i.ref.number === r.issue.number && i.ref.repo === r.issue.repo && i.ref.owner === r.issue.owner,
          ) as IssueSnapshot;
          try {
            const res = await jev.ask(
              { kind: 'issue', questionSet: QUESTION_SET_VERSION, targetId: r.id, reviewId: deps.reviewId },
              issueState(issue, r),
              issueQuestions(),
            );
            const ambiguous = res.answers.ambiguous.noul;
            const checkable = res.answers.checkable_in_code.noul;
            r.signals = { ambiguous, checkable };
            // Refine checkableInCode unless the answer is in the 0.4 to 0.6 "no answer" band (7.5 rule 10).
            if (checkable < 0.4 || checkable > 0.6) r.checkableInCode = checkable >= t.checkable;
            issueAnswers[r.id] = toAnswers(ISSUE_CALL, res.answers);
          } catch (e) {
            if (!(e instanceof ProviderError)) throw e;
            warnings.push(`${r.id}: issue.v0 failed (${e.message}); ambiguity and checkability are unknown.`);
          }
        }),
    );
  }
  return {
    requirements: final.requirements,
    openQuestions: final.openQuestions,
    issueAnswers,
    warnings,
    ...(llmModel ? { llmModel } : {}),
  };
}
