/**
 * Prometheus metrics (BUILD_PROMPT 10.4, M9): reviews, latency (a histogram), provider calls, tokens and cost,
 * findings, feedback, webhooks and cancelled jobs, in the plain text exposition format.
 */
import type { Finding } from '@remit/core';
import type { CallRecord } from '@remit/providers';

type Labels = Record<string, string>;

export const LATENCY_BUCKETS = [1, 2.5, 5, 10, 20, 30, 60, 120, 300];

const HELP: Record<string, [type: 'counter' | 'histogram', help: string]> = {
  remit_webhooks_total: ['counter', 'Webhook deliveries by event and result.'],
  remit_reviews_total: ['counter', 'Reviews by status.'],
  remit_review_seconds: ['histogram', 'Review wall time in seconds.'],
  remit_review_cost_usd_sum: ['counter', 'Total provider cost of reviews in USD.'],
  remit_findings_total: ['counter', 'Findings by priority.'],
  remit_feedback_total: ['counter', 'Feedback labels by label and source.'],
  remit_provider_calls_total: ['counter', 'Provider calls by provider and kind.'],
  remit_provider_tokens_total: ['counter', 'Provider tokens by provider and direction.'],
  remit_provider_cost_usd_total: ['counter', 'Provider cost in USD by provider.'],
  remit_jobs_cancelled_total: ['counter', 'Jobs cancelled because a newer push superseded them.'],
  remit_budget_skips_total: ['counter', 'Reviews skipped because the installation reached its daily budget.'],
  remit_circuit_open_total: ['counter', 'Provider calls refused by an open circuit breaker.'],
  remit_reviews_delayed_total: [
    'counter',
    'PR events delayed because the installation passed its hourly review rate.',
  ],
};

export class Metrics {
  private readonly counters = new Map<string, number>();

  inc(name: string, labels: Labels = {}, by = 1): void {
    const key = `${name}${format(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    for (const le of LATENCY_BUCKETS)
      if (value <= le) this.inc(`${name}_bucket`, { ...labels, le: String(le) });
    this.inc(`${name}_bucket`, { ...labels, le: '+Inf' });
    this.inc(`${name}_sum`, labels, value);
    this.inc(`${name}_count`, labels);
  }

  observeReview(status: string, seconds: number, costUsd: number, findings: readonly Finding[]): void {
    this.inc('remit_reviews_total', { status });
    this.observe('remit_review_seconds', seconds);
    this.inc('remit_review_cost_usd_sum', {}, costUsd);
    for (const f of findings) this.inc('remit_findings_total', { priority: f.priority });
  }

  observeCalls(calls: readonly CallRecord[]): void {
    for (const c of calls) {
      this.inc('remit_provider_calls_total', { provider: c.provider, kind: c.kind });
      this.inc('remit_provider_tokens_total', { provider: c.provider, direction: 'input' }, c.inputTokens);
      if (c.outputTokens)
        this.inc(
          'remit_provider_tokens_total',
          { provider: c.provider, direction: 'output' },
          c.outputTokens,
        );
      this.inc('remit_provider_cost_usd_total', { provider: c.provider }, c.costUsd);
    }
  }

  render(): string {
    const lines: string[] = [];
    // Histogram series (_bucket, _sum, _count) belong to one family; other names are their own family.
    const family = (key: string) => {
      const base = key.split('{')[0] as string;
      const stripped = base.replace(/_(bucket|sum|count)$/, '');
      return HELP[stripped]?.[0] === 'histogram' ? stripped : base;
    };
    const names = [...new Set([...this.counters.keys()].map(family))].sort();
    for (const name of names) {
      const [type, help] = HELP[name] ?? ['counter', name];
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      for (const [k, v] of [...this.counters.entries()].sort())
        if (family(k) === name) lines.push(`${k} ${v}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

function format(labels: Labels): string {
  const entries = Object.entries(labels);
  if (!entries.length) return '';
  return `{${entries.map(([k, v]) => `${k}="${v.replace(/["\\\n]/g, '_')}"`).join(',')}}`;
}
