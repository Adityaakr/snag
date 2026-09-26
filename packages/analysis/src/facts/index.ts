/**
 * Runs every code-fact detector over change units and assigns stable ids X1..Xn, ordered by unit then line
 * (BUILD_PROMPT 5, 6.4.2). Filtered units get no facts.
 */
import type { ChangeUnit, CodeFact } from '@remit/core';
import type { ContentSource } from '../units/build.js';
import { newDeclarations, publicApiChanged, type ReferenceIndex } from './api.js';
import { dependencyAdded } from './deps.js';
import { DETECTORS, type Detector, type DetectorContext, type FactDraft, langGroup } from './detectors.js';
import { type LineView, unitViews } from './lines.js';
import { secretLike } from './secrets.js';

export const ALL_DETECTORS: Detector[] = [...DETECTORS, dependencyAdded, publicApiChanged, secretLike];

export interface DetectFactsOptions {
  contents?: ContentSource;
  /** Needed for `new_symbol_unreferenced`; without it the fact is marked unavailable in warnings. */
  references?: ReferenceIndex;
}

export interface DetectFactsResult {
  units: ChangeUnit[];
  warnings: string[];
}

function applies(d: Detector, unit: ChangeUnit): boolean {
  if (d.languages !== 'all') {
    const g = langGroup(unit.language);
    if (!g || !d.languages.includes(g)) return false;
  }
  return d.appliesTo ? d.appliesTo(unit) : true;
}

/** Detects facts for every unit and returns new unit objects with `facts` filled. */
export async function detectFacts(
  units: readonly ChangeUnit[],
  opts: DetectFactsOptions = {},
): Promise<DetectFactsResult> {
  const warnings: string[] = [];
  const views = units.map(unitViews);
  const fileViews = new Map<string, LineView>();
  for (const v of views) {
    const fv = fileViews.get(v.unit.file) ?? { adds: [], dels: [], blocks: [] };
    fv.adds.push(...v.judge.adds);
    fv.dels.push(...v.judge.dels);
    fv.blocks.push(...v.judge.blocks);
    fileViews.set(v.unit.file, fv);
  }
  const texts = new Map<string, Promise<[string | null, string | null]>>();
  const textsFor = (u: ChangeUnit) => {
    let p = texts.get(u.file);
    if (!p) {
      p = Promise.all([
        u.changeType === 'added'
          ? Promise.resolve(null)
          : (opts.contents?.get('base', u.oldFile ?? u.file) ?? Promise.resolve(null)),
        u.changeType === 'deleted'
          ? Promise.resolve(null)
          : (opts.contents?.get('head', u.file) ?? Promise.resolve(null)),
      ]);
      texts.set(u.file, p);
    }
    return p;
  };

  const drafts: FactDraft[][] = [];
  let referencesWarned = false;
  for (const v of views) {
    const out: FactDraft[] = [];
    if (!v.unit.filtered) {
      const [baseText, headText] = await textsFor(v.unit);
      const ctx: DetectorContext = { fileView: fileViews.get(v.unit.file) as LineView, baseText, headText };
      for (const d of ALL_DETECTORS) if (applies(d, v.unit)) out.push(...d.detect(v, ctx));
      const fresh = newDeclarations(v.unit, v.judge, ctx.fileView);
      for (const decl of fresh) {
        const n = opts.references
          ? await opts.references.count(decl.name, { file: v.unit.file, line: decl.line })
          : null;
        if (n === null) {
          if (!referencesWarned)
            warnings.push('new_symbol_unreferenced is unavailable: the head tree could not be searched.');
          referencesWarned = true;
        } else if (n === 0) {
          out.push({
            kind: 'new_symbol_unreferenced',
            severity: 'warn',
            line: decl.line,
            detail: `new ${decl.kind} \`${decl.name}\` is not referenced anywhere outside tests`,
          });
        }
      }
    }
    out.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    drafts.push(out);
  }

  let next = 1;
  const result = units.map((unit, i) => {
    const facts: CodeFact[] = (drafts[i] ?? []).map((d) => ({
      id: `X${next++}`,
      kind: d.kind,
      severity: d.severity,
      unitId: unit.id,
      ...(d.line !== undefined ? { line: d.line } : {}),
      detail: d.detail,
    }));
    return { ...unit, facts };
  });
  return { units: result, warnings };
}

export type { ReferenceIndex } from './api.js';
export { GitGrepReferences } from './refs.js';
