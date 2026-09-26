/** SARIF 2.1.0 output for unit and fact findings (BUILD_PROMPT 6.10). */
import { BRAND } from '../brand.js';
import type { Finding, ReviewResult } from '../contracts/index.js';

const LEVEL: Record<Finding['priority'], 'error' | 'warning' | 'note'> = {
  P0: 'error',
  P1: 'warning',
  P2: 'note',
};

export function renderSarif(r: ReviewResult): object {
  const findings = r.findings.filter(
    (f) => f.type === 'unit' || f.type === 'fact' || f.type === 'test_integrity',
  );
  const ruleIdOf = (f: Finding) => {
    if (f.type === 'fact') {
      const fact = r.units.flatMap((u) => u.facts).find((x) => `F-${x.id}` === f.id);
      return `${BRAND.slug}/fact/${fact?.kind ?? 'unknown'}`;
    }
    return `${BRAND.slug}/${f.type}/${f.reasons[0]?.template ?? 'finding'}`;
  };
  const rules = [...new Set(findings.map(ruleIdOf))].sort().map((id) => ({
    id,
    name: id.split('/').slice(1).join('.'),
    shortDescription: { text: id.split('/').slice(1).join(' ').replace(/[._]/g, ' ') },
  }));
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: BRAND.name, version: r.product.version, rules } },
        results: findings.map((f) => ({
          ruleId: ruleIdOf(f),
          level: LEVEL[f.priority],
          message: { text: f.reasons.map((x) => x.text).join(' ') || f.id },
          locations: f.locations.map((l) => ({
            physicalLocation: {
              artifactLocation: { uri: l.file },
              region: { startLine: Math.max(1, l.lines[0]), endLine: Math.max(1, l.lines[1], l.lines[0]) },
            },
          })),
          partialFingerprints: { [`${BRAND.slug}ContentKey/v1`]: f.contentKey },
          properties: { findingId: f.id, route: f.route, priority: f.priority, confidence: f.confidence },
        })),
      },
    ],
  };
}

/** The full ReviewResult as JSON. */
export function renderJson(r: ReviewResult): string {
  return `${JSON.stringify(r, null, 2)}\n`;
}
