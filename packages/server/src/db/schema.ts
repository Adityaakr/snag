/**
 * The Postgres schema (BUILD_PROMPT 10.4), with Drizzle. Only verdicts, answers, hashes, paths and line ranges are
 * stored by default (9.9): text columns and payloads are filled only when `retain_payloads` is on, with a TTL.
 * `reviews.result` holds the review result with issue text, reasons and fact details removed (D31).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const installations = pgTable('installations', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').notNull().default('Organization'),
  createdAt: created(),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
});

export const repositories = pgTable(
  'repositories',
  {
    id: serial('id').primaryKey(),
    installationId: bigint('installation_id', { mode: 'number' })
      .notNull()
      .references(() => installations.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    configHash: text('config_hash'),
    /** The effective config at the last review (for the settings page). */
    config: jsonb('config'),
  },
  (t) => [uniqueIndex('repositories_full_name').on(t.fullName)],
);

export const deliveries = pgTable('deliveries', {
  deliveryId: text('delivery_id').primaryKey(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reviews = pgTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    headSha: text('head_sha').notNull(),
    baseSha: text('base_sha').notNull(),
    issueRefs: jsonb('issue_refs').notNull().$type<{ owner: string; repo: string; number: number }[]>(),
    linkStrength: text('link_strength').notNull(),
    status: text('status').notNull(),
    mode: text('mode').notNull(),
    questionSet: text('question_set').notNull(),
    extractionPrompt: text('extraction_prompt').notNull(),
    jevModel: text('jev_model').notNull(),
    llmModel: text('llm_model'),
    calibrationId: text('calibration_id'),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    warnings: jsonb('warnings').notNull().$type<string[]>().default(sql`'[]'::jsonb`),
    /** The review result without issue text, reasons or fact details (D31). */
    result: jsonb('result').notNull(),
    hasP0: boolean('has_p0').notNull().default(false),
    createdAt: created(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('reviews_repo_pr').on(t.repositoryId, t.prNumber), index('reviews_created').on(t.createdAt)],
);

export const requirements = pgTable('requirements', {
  id: serial('id').primaryKey(),
  reviewId: text('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  rid: text('rid').notNull(),
  issueRef: text('issue_ref').notNull(),
  issueContentHash: text('issue_content_hash').notNull(),
  textHash: text('text_hash').notNull(),
  kind: text('kind').notNull(),
  explicitness: text('explicitness').notNull(),
  priority: text('priority').notNull(),
  ambiguous: boolean('ambiguous').notNull().default(false),
  checkable: boolean('checkable').notNull().default(true),
  confirmed: boolean('confirmed').notNull().default(false),
  /** Only when retaining payloads. */
  text: text('text'),
  quote: text('quote'),
});

export const units = pgTable('units', {
  id: serial('id').primaryKey(),
  reviewId: text('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  uid: text('uid').notNull(),
  file: text('file').notNull(),
  symbol: text('symbol'),
  kind: text('kind').notNull(),
  contentHash: text('content_hash').notNull(),
  lineRanges: jsonb('line_ranges').notNull().$type<[number, number][]>(),
});

export const findings = pgTable(
  'findings',
  {
    id: serial('id').primaryKey(),
    reviewId: text('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    fid: text('fid').notNull(),
    contentKey: text('content_key').notNull(),
    type: text('type').notNull(),
    targetId: text('target_id').notNull(),
    status: text('status'),
    priority: text('priority').notNull(),
    route: text('route').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    answers: jsonb('answers').notNull(),
    /** Reason templates (and text only when retaining payloads). */
    reasons: jsonb('reasons').notNull(),
    locations: jsonb('locations').notNull().$type<{ file: string; lines: [number, number] }[]>(),
  },
  (t) => [index('findings_review').on(t.reviewId), index('findings_content_key').on(t.contentKey)],
);

export const facts = pgTable('facts', {
  id: serial('id').primaryKey(),
  reviewId: text('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  unitUid: text('unit_uid').notNull(),
  kind: text('kind').notNull(),
  severity: text('severity').notNull(),
  line: integer('line'),
  detail: text('detail').notNull(),
});

export const feedback = pgTable(
  'feedback',
  {
    id: serial('id').primaryKey(),
    findingId: text('finding_id').notNull(),
    contentKey: text('content_key').notNull(),
    githubLogin: text('github_login').notNull(),
    label: text('label').notNull(),
    reason: text('reason'),
    source: text('source').notNull(),
    repo: text('repo').notNull(),
    prNumber: integer('pr_number').notNull(),
    createdAt: created(),
  },
  (t) => [index('feedback_content_key').on(t.contentKey), index('feedback_repo_pr').on(t.repo, t.prNumber)],
);

export const confirmedChecklists = pgTable(
  'confirmed_checklists',
  {
    id: serial('id').primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    issueNumber: integer('issue_number').notNull(),
    issueContentHash: text('issue_content_hash').notNull(),
    requirements: jsonb('requirements').notNull(),
    confirmedBy: text('confirmed_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('checklists_repo_issue').on(t.repositoryId, t.issueNumber)],
);

export const calibrations = pgTable('calibrations', {
  id: serial('id').primaryKey(),
  jevModel: text('jev_model').notNull(),
  questionSet: text('question_set').notNull(),
  questionKey: text('question_key').notNull(),
  method: text('method').notNull(),
  params: jsonb('params').notNull(),
  n: integer('n').notNull(),
  eceBefore: doublePrecision('ece_before'),
  eceAfter: doublePrecision('ece_after'),
  active: boolean('active').notNull().default(false),
  createdAt: created(),
});

export const evalRuns = pgTable('eval_runs', {
  id: text('id').primaryKey(),
  corpus: text('corpus').notNull(),
  split: text('split').notNull(),
  gitSha: text('git_sha').notNull(),
  questionSet: text('question_set').notNull(),
  metrics: jsonb('metrics').notNull(),
  reportPath: text('report_path'),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  createdAt: created(),
});

export const apiCalls = pgTable('api_calls', {
  id: serial('id').primaryKey(),
  reviewId: text('review_id').references(() => reviews.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  kind: text('kind').notNull(),
  requestHash: text('request_hash').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  latencyMs: integer('latency_ms').notNull().default(0),
  status: text('status').notNull(),
  createdAt: created(),
});

export const payloads = pgTable('payloads', {
  id: serial('id').primaryKey(),
  reviewId: text('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  content: jsonb('content').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
