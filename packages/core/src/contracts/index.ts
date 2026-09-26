/**
 * Data contracts (BUILD_PROMPT section 5). Field names are binding; new fields need a DECISIONS.md entry.
 * Every schema is zod; types are inferred from the schemas so code and contract cannot drift.
 */
import { z } from 'zod';
import { BRAND } from '../brand.js';

const lineRange = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
const reason = z.object({ template: z.string(), text: z.string() });
const probability = z.number().min(0).max(1);

export const IssueRefSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
});
export type IssueRef = z.infer<typeof IssueRefSchema>;

export const CommentRoleSchema = z.enum(['author', 'maintainer', 'other']);
export type CommentRole = z.infer<typeof CommentRoleSchema>;

/** Deliberately has no PR fields. Extraction may only ever receive this type. */
export const IssueSnapshotSchema = z
  .object({
    ref: IssueRefSchema,
    title: z.string(),
    body: z.string(),
    author: z.string(),
    state: z.enum(['open', 'closed']),
    comments: z.array(
      z.object({
        id: z.string(),
        author: z.string(),
        role: CommentRoleSchema,
        createdAt: z.string(),
        body: z.string(),
      }),
    ),
    contentHash: z.string(),
  })
  .strict();
export type IssueSnapshot = z.infer<typeof IssueSnapshotSchema>;

export const RequirementKindSchema = z.enum([
  'behavior',
  'constraint',
  'non_goal',
  'test',
  'docs',
  'config',
  'migration',
  'performance',
  'security',
  'ux',
]);
export type RequirementKind = z.infer<typeof RequirementKindSchema>;

export const RequirementSourceSchema = z.object({
  kind: z.enum(['title', 'body', 'comment', 'tasklist']),
  commentId: z.string().optional(),
});

export const ExampleSchema = z.object({ input: z.string(), expected: z.string(), quote: z.string() });
export type Example = z.infer<typeof ExampleSchema>;

export const RequirementSchema = z.object({
  id: z.string().regex(/^(I\d+\.)?R\d+$/),
  issue: IssueRefSchema,
  text: z.string().min(1),
  quote: z.string().min(1),
  source: RequirementSourceSchema,
  kind: RequirementKindSchema,
  explicitness: z.enum(['explicit', 'implied']),
  priority: z.enum(['must', 'should', 'could']),
  examples: z.array(ExampleSchema),
  checkableInCode: z.boolean(),
  signals: z.object({ ambiguous: probability, checkable: probability }).optional(),
  openQuestion: z.object({ readings: z.array(z.string()).max(2) }).optional(),
  supersededBy: z.string().optional(),
  confirmed: z.boolean().optional(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const CODE_FACT_KINDS = [
  'assertion_removed',
  'assertion_weakened',
  'expected_value_changed',
  'test_skipped',
  'test_focused',
  'test_deleted',
  'snapshot_updated',
  'tolerance_widened',
  'retry_or_timeout_added',
  'suppression_added',
  'catch_broadened',
  'threshold_lowered',
  'ci_changed',
  'dependency_added',
  'public_api_changed',
  'new_symbol_unreferenced',
  'secret_like',
] as const;
export const CodeFactKindSchema = z.enum(CODE_FACT_KINDS);
export type CodeFactKind = z.infer<typeof CodeFactKindSchema>;

export const SeveritySchema = z.enum(['info', 'warn', 'high']);
export type Severity = z.infer<typeof SeveritySchema>;

export const CodeFactSchema = z.object({
  id: z.string().regex(/^X\d+$/),
  kind: CodeFactKindSchema,
  severity: SeveritySchema,
  unitId: z.string(),
  line: z.number().int().nonnegative().optional(),
  detail: z.string(),
});
export type CodeFact = z.infer<typeof CodeFactSchema>;

export const LanguageSchema = z.enum(['ts', 'tsx', 'js', 'py', 'rs', 'other']);
export type Language = z.infer<typeof LanguageSchema>;

export const UnitKindSchema = z.enum([
  'source',
  'test',
  'config',
  'docs',
  'ci',
  'build',
  'migration',
  'generated',
  'lockfile',
  'vendored',
  'binary',
  'asset',
]);
export type UnitKind = z.infer<typeof UnitKindSchema>;

export const FilterReasonSchema = z.enum(['lockfile', 'generated', 'formatting_only', 'vendored', 'binary']);
export type FilterReason = z.infer<typeof FilterReasonSchema>;

export const SymbolKindSchema = z.enum(['function', 'method', 'class', 'module', 'block', 'test']);
export type SymbolKind = z.infer<typeof SymbolKindSchema>;

export const ChangeUnitSchema = z.object({
  id: z.string().regex(/^U\d+$/),
  file: z.string(),
  oldFile: z.string().optional(),
  language: LanguageSchema,
  kind: UnitKindSchema,
  changeType: z.enum(['added', 'modified', 'deleted', 'renamed']),
  symbol: z
    .object({
      name: z.string(),
      kind: SymbolKindSchema,
      startLine: z.number().int(),
      endLine: z.number().int(),
    })
    .optional(),
  lines: z.object({ new: z.array(lineRange), old: z.array(lineRange) }),
  patch: z.string(),
  judgeView: z.string(),
  before: z.string().optional(),
  after: z.string().optional(),
  testTitles: z.array(z.string()).optional(),
  contentHash: z.string(),
  tokenEstimate: z.number().int().nonnegative(),
  filtered: FilterReasonSchema.optional(),
  facts: z.array(CodeFactSchema),
});
export type ChangeUnit = z.infer<typeof ChangeUnitSchema>;

export const AnswerSchema = z.object({
  call: z.string(),
  question: z.string(),
  type: z.enum(['choice', 'score', 'noul']),
  value: z.union([z.string(), z.number()]),
  probabilities: z.record(z.string(), probability).optional(),
  confidence: probability.optional(),
  calibratedValue: probability.optional(),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const EvidenceSchema = z.object({
  unitId: z.string(),
  file: z.string(),
  lines: z.array(lineRange),
  probability,
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const REQUIREMENT_STATUSES = [
  'done',
  'partial',
  'missing',
  'contradicted',
  'interpretation_mismatch',
  'uncertain',
  'preexisting',
  'deferred',
  'not_checkable',
] as const;
export const RequirementStatusSchema = z.enum(REQUIREMENT_STATUSES);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

export const RequirementVerdictSchema = z.object({
  requirementId: z.string(),
  status: RequirementStatusSchema,
  confidence: probability,
  calibrated: z.boolean(),
  tested: z.enum(['as_stated', 'differently', 'untested', 'unknown']),
  evidence: z.array(EvidenceSchema),
  testEvidence: z.array(EvidenceSchema),
  answers: z.array(AnswerSchema),
  claimMismatch: z.object({ sentence: z.string() }).optional(),
  reasons: z.array(reason),
});
export type RequirementVerdict = z.infer<typeof RequirementVerdictSchema>;

export const UNIT_ROLES = [
  'implements',
  'supporting',
  'unexplained_behavioral',
  'unexplained_benign',
  'ignored',
  'uncertain',
] as const;
export const UnitRoleSchema = z.enum(UNIT_ROLES);
export type UnitRole = z.infer<typeof UnitRoleSchema>;

export const UnitVerdictSchema = z.object({
  unitId: z.string(),
  role: UnitRoleSchema,
  servesRequirementId: z.string().optional(),
  testIntegrity: z.object({ loosened: z.number().nonnegative(), factIds: z.array(z.string()) }).optional(),
  answers: z.array(AnswerSchema),
  reasons: z.array(reason),
});
export type UnitVerdict = z.infer<typeof UnitVerdictSchema>;

export const PrioritySchema = z.enum(['P0', 'P1', 'P2']);
export type Priority = z.infer<typeof PrioritySchema>;
export const RouteSchema = z.enum(['send_back', 'ask_author', 'reviewer_attention', 'none']);
export type Route = z.infer<typeof RouteSchema>;

export const FindingSchema = z.object({
  id: z.string().regex(/^F-[A-Z0-9.]+(-[a-z_]+)?$/),
  type: z.enum(['requirement', 'unit', 'test_integrity', 'fact', 'ambiguity']),
  targetId: z.string(),
  priority: PrioritySchema,
  route: RouteSchema,
  confidence: probability,
  locations: z.array(z.object({ file: z.string(), lines: lineRange })),
  reasons: z.array(reason),
  contentKey: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ReviewModeSchema = z.enum(['comment_only', 'rework', 'gate']);
export type ReviewMode = z.infer<typeof ReviewModeSchema>;

export const ReviewResultSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  product: z.object({ name: z.string(), version: z.string() }),
  input: z.object({
    mode: z.enum(['github', 'local']),
    repo: z.string().optional(),
    pr: z.number().int().positive().optional(),
    baseSha: z.string(),
    headSha: z.string(),
    issues: z.array(IssueRefSchema),
    linkStrength: z.enum(['closing', 'weak', 'none']),
  }),
  versions: z.object({
    questionSet: z.string().regex(/^qs-\d+\.\d+\.\d+$/),
    extractionPrompt: z.string().regex(/^xp-\d+\.\d+\.\d+$/),
    jevModel: z.string(),
    llmModel: z.string().optional(),
    calibration: z.string().optional(),
  }),
  requirements: z.array(RequirementSchema),
  units: z.array(ChangeUnitSchema),
  requirementVerdicts: z.array(RequirementVerdictSchema),
  unitVerdicts: z.array(UnitVerdictSchema),
  claims: z.array(
    z.object({
      sentence: z.string(),
      requirementId: z.string().optional(),
      claimsDone: probability,
      claimsDeferred: probability,
    }),
  ),
  findings: z.array(FindingSchema),
  summary: z.object({
    counts: z.record(z.string(), z.number().int().nonnegative()),
    mode: ReviewModeSchema,
    gateDecision: z.enum(['pass', 'fail', 'refused']).optional(),
  }),
  usage: z.object({
    jevInputTokens: z.number().int().nonnegative(),
    llmInputTokens: z.number().int().nonnegative(),
    llmOutputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    latencyMs: z.number().nonnegative(),
    calls: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string()),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/** Every exported contract, keyed by the file name used under schemas/. */
export const CONTRACTS = {
  IssueRef: IssueRefSchema,
  IssueSnapshot: IssueSnapshotSchema,
  Requirement: RequirementSchema,
  CodeFact: CodeFactSchema,
  ChangeUnit: ChangeUnitSchema,
  Answer: AnswerSchema,
  Evidence: EvidenceSchema,
  RequirementVerdict: RequirementVerdictSchema,
  UnitVerdict: UnitVerdictSchema,
  Finding: FindingSchema,
  ReviewResult: ReviewResultSchema,
} as const;

/** Returns the JSON Schema (draft 2020-12) for every contract. */
export function exportJsonSchemas(): Record<keyof typeof CONTRACTS, unknown> {
  const out = {} as Record<keyof typeof CONTRACTS, unknown>;
  for (const [name, schema] of Object.entries(CONTRACTS) as [keyof typeof CONTRACTS, z.ZodType][]) {
    out[name] = {
      $id: `urn:${BRAND.slug}:schema:${name}`,
      ...z.toJSONSchema(schema, { target: 'draft-2020-12' }),
    };
  }
  return out;
}

export const SCHEMA_VERSION = '1.0.0' as const;
