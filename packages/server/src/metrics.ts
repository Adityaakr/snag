/** Prometheus metrics (BUILD_PROMPT 10.4 `/metrics`): plain text exposition, no client library. */
import type { Finding } from '@remit/core';

type Labels = Record<string, string>;

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly help: Record<string, string> = {
    remit_webhooks_total: 'Webhook deliveries by event and result.',
    remit_reviews_total: 'Reviews by status.',
    remit_review_seconds_sum: 'Total review wall time in seconds.',
    remit_review_seconds_count: 'Reviews timed.',
    remit_review_cost_usd_sum: 'Total provider cost of reviews in USD.',
    remit_findings_total: 'Findings by priority.',
    remit_jobs_cancelled_total: 'Jobs cancelled because a newer push superseded them.',
  };

  inc(name: string, labels: Labels = {}, by = 1): void {
    const key = `${name}${format(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  observeReview(status: string, seconds: number, costUsd: number, findings: readonly Finding[]): void {
    this.inc('remit_reviews_total', { status });
    this.inc('remit_review_seconds_sum', {}, seconds);
    this.inc('remit_review_seconds_count');
    this.inc('remit_review_cost_usd_sum', {}, costUsd);
    for (const f of findings) this.inc('remit_findings_total', { priority: f.priority });
  }

  render(): string {
    const lines: string[] = [];
    const names = [...new Set([...this.counters.keys()].map((k) => k.split('{')[0] as string))].sort();
    for (const name of names) {
      lines.push(`# HELP ${name} ${this.help[name] ?? name}`, `# TYPE ${name} counter`);
      for (const [k, v] of [...this.counters.entries()].sort())
        if (k.split('{')[0] === name) lines.push(`${k} ${v}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

function format(labels: Labels): string {
  const entries = Object.entries(labels);
  if (!entries.length) return '';
  return `{${entries.map(([k, v]) => `${k}="${v.replace(/["\\\n]/g, '_')}"`).join(',')}}`;
}
