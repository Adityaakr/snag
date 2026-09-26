/**
 * `.remit.yml` (BUILD_PROMPT 10.5). Every field has the spec default, so an empty file is a valid config.
 * Keys beyond 10.5 are recorded in DECISIONS.md (D15).
 */
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';

const probability = z.number().min(0).max(1);

const Price = z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() }).strict();

export const ConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    mode: z.enum(['comment_only', 'rework', 'gate']).default('comment_only'),
    languages: z
      .array(z.enum(['typescript', 'javascript', 'python', 'rust']))
      .default(['typescript', 'javascript', 'python', 'rust']),
    ignore_paths: z.array(z.string()).default([]),
    draft_prs: z.enum(['review', 'skip']).default('review'),
    extraction: z
      .object({
        mode: z.enum(['auto', 'llm', 'tasklist_only']).default('auto'),
        provider: z.enum(['anthropic', 'openai_compatible']).default('anthropic'),
        model: z.string().min(1).default('claude-opus-5-5'),
        effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
      })
      .strict()
      .default({ mode: 'auto', provider: 'anthropic', model: 'claude-opus-5-5' }),
    baseline: z
      .object({ model: z.string().min(1).default('claude-opus-5-5') })
      .strict()
      .default({ model: 'claude-opus-5-5' }),
    llm_prices: z.record(z.string(), Price).default({
      'claude-opus-5-5': { input: 4, output: 20 },
      'claude-opus-5': { input: 5, output: 25 },
      'claude-sonnet-5': { input: 2, output: 10 },
    }),
    jev: z
      .object({
        /**
         * Who answers the typed questions: TypeSafe's Jev (or a server speaking its protocol at REMIT_JEV_BASE_URL),
         * or a generative LLM through the extraction provider's credentials (DECISIONS D34).
         */
        engine: z.enum(['typesafe', 'llm']).default('typesafe'),
        /** The LLM for engine `llm`; defaults to `extraction.model`. */
        llm_model: z.string().min(1).optional(),
        model: z.string().min(1).default('jev-1.13.0'),
        max_state_tokens: z.number().int().positive().max(32_000).default(24_000),
        concurrency: z.number().int().min(1).max(64).default(8),
        price_per_million_input_usd: z.number().nonnegative().default(0.042),
      })
      .strict()
      .default({
        engine: 'typesafe',
        model: 'jev-1.13.0',
        max_state_tokens: 24_000,
        concurrency: 8,
        price_per_million_input_usd: 0.042,
      }),
    thresholds: z
      .object({
        full: probability.default(0.6),
        partial: probability.default(0.5),
        missing: probability.default(0.7),
        missing_send_back: probability.default(0.85),
        contradicted: probability.default(0.7),
        ambiguous: probability.default(0.6),
        checkable: probability.default(0.35),
        preexisting: probability.default(0.7),
        serves: probability.default(0.55),
        plumbing: probability.default(0.6),
        behavior: probability.default(0.6),
        loosens: probability.default(0.7),
        min_confidence: probability.default(0.5),
      })
      .strict()
      .prefault({}),
    gate: z
      .object({
        threshold: probability.default(0.9),
        min_labeled_findings: z.number().int().nonnegative().default(200),
        min_precision: probability.default(0.85),
      })
      .strict()
      .prefault({}),
    surfaces: z
      .object({
        sticky_comment: z.boolean().default(true),
        check_run: z.boolean().default(true),
        inline_comments: z.boolean().default(false),
        labels: z.boolean().default(false),
      })
      .strict()
      .prefault({}),
    issue_checklist: z.enum(['off', 'on_label', 'on_assign']).default('off'),
    issue_checklist_label: z.string().min(1).default('agent-ready'),
    rework: z
      .object({ mention: z.string().default('') })
      .strict()
      .prefault({}),
    budgets: z
      .object({
        max_usd_per_review: z.number().positive().default(0.5),
        max_units: z.number().int().positive().default(400),
        max_repo_mb: z.number().positive().default(200),
      })
      .strict()
      .prefault({}),
    retention: z
      .object({
        retain_payloads: z.boolean().default(false),
        retention_days: z.number().int().positive().default(14),
        delete_on_uninstall: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
    eval: z
      .object({
        cost_false_p0: z.number().nonnegative().default(3),
        cost_missed_problem: z.number().nonnegative().default(2),
        cost_false_p1: z.number().nonnegative().default(1),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type RemitConfig = z.infer<typeof ConfigSchema>;
export type Thresholds = RemitConfig['thresholds'];

export interface ConfigResult {
  config: RemitConfig;
  /** Human-readable problems; when non-empty, `config` is the defaults (BUILD_PROMPT 10.2). */
  errors: string[];
}

/** The defaults, as parsed from an empty file. */
export function defaultConfig(): RemitConfig {
  return ConfigSchema.parse({});
}

/** Parses `.remit.yml` text. Invalid files return the defaults plus errors instead of throwing. */
export function parseConfig(text: string): ConfigResult {
  let raw: unknown;
  try {
    raw = parseYaml(text) ?? {};
  } catch (e) {
    const msg = e instanceof YAMLParseError ? e.message.split('\n')[0] : String(e);
    return { config: defaultConfig(), errors: [`.remit.yml is not valid YAML: ${msg}`] };
  }
  const r = ConfigSchema.safeParse(raw);
  if (r.success) return { config: r.data, errors: [] };
  return {
    config: defaultConfig(),
    errors: r.error.issues.map((i) => `.remit.yml ${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
