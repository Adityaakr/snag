/**
 * The Postgres store (BUILD_PROMPT 10.4): the App's `Store` and `DeliveryStore` on Drizzle, plus the queries the
 * dashboard and the corpus C export need. Every query is parameterized through Drizzle (9.11).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUESTION_SET_VERSION, type ReviewResult } from '@remit/core';
import type { ReviewInput } from '@remit/pipeline';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { DeliveryStore } from '../deliveries.js';
import type { ChecklistRecord, FeedbackRecord, ReviewRecord, Store } from '../store.js';
import type { Db } from './client.js';
import { redactResult } from './redact.js';
import * as t from './schema.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);

export interface ReviewRow {
  id: string;
  repo: string;
  prNumber: number;
  headSha: string;
  status: string;
  mode: string;
  hasP0: boolean;
  costUsd: number;
  latencyMs: number;
  createdAt: Date;
  installationId: number;
}

export interface ReviewFilter {
  installationIds: number[];
  repo?: string;
  status?: string;
  hasP0?: boolean;
  since?: Date;
  limit?: number;
}

export class DbStore implements Store, DeliveryStore {
  constructor(private readonly db: Db) {}

  // ------------------------------------------------------------------------------------------ deliveries
  async claim(id: string): Promise<boolean> {
    const rows = await this.db
      .insert(t.deliveries)
      .values({ deliveryId: id })
      .onConflictDoNothing()
      .returning();
    return rows.length > 0;
  }
  async release(id: string): Promise<void> {
    await this.db.delete(t.deliveries).where(eq(t.deliveries.deliveryId, id));
  }
  /** Deliveries older than `days` are forgotten (GitHub redelivers only recent ones). */
  async pruneDeliveries(days: number, now = new Date()): Promise<void> {
    await this.db
      .delete(t.deliveries)
      .where(lt(t.deliveries.receivedAt, new Date(now.getTime() - days * 86_400_000)));
  }

  // ---------------------------------------------------------------------------------------- repositories
  private async repositoryId(fullName: string, installationId?: number): Promise<number> {
    const found = await this.db.select().from(t.repositories).where(eq(t.repositories.fullName, fullName));
    if (found[0]) return found[0].id;
    if (installationId === undefined) throw new Error(`unknown repository ${fullName}`);
    await this.db
      .insert(t.installations)
      .values({ id: installationId, accountLogin: fullName.split('/')[0] ?? 'unknown' })
      .onConflictDoNothing();
    const [row] = await this.db
      .insert(t.repositories)
      .values({ installationId, fullName })
      .onConflictDoNothing()
      .returning();
    if (row) return row.id;
    return this.repositoryId(fullName);
  }

  // --------------------------------------------------------------------------------------------- reviews
  async saveReview(r: ReviewRecord): Promise<void> {
    const repositoryId = await this.repositoryId(r.repo, r.installationId);
    const res = r.result;
    const retain = r.retention?.retainPayloads ?? false;
    await this.db.transaction(async (tx) => {
      await tx.insert(t.reviews).values({
        id: r.id,
        repositoryId,
        prNumber: r.pr,
        headSha: r.headSha,
        baseSha: res.input.baseSha,
        issueRefs: res.input.issues,
        linkStrength: res.input.linkStrength,
        status: 'done',
        mode: res.summary.mode,
        questionSet: res.versions.questionSet,
        extractionPrompt: res.versions.extractionPrompt,
        jevModel: res.versions.jevModel,
        llmModel: res.versions.llmModel ?? null,
        calibrationId: res.versions.calibration ?? null,
        costUsd: res.usage.costUsd,
        latencyMs: res.usage.latencyMs,
        warnings: res.warnings,
        result: redactResult(res),
        hasP0: res.findings.some((f) => f.priority === 'P0'),
        createdAt: new Date(r.createdAt),
        completedAt: new Date(r.createdAt),
      });
      if (res.requirements.length)
        await tx.insert(t.requirements).values(
          res.requirements.map((q) => {
            const v = res.requirementVerdicts.find((x) => x.requirementId === q.id);
            return {
              reviewId: r.id,
              rid: q.id,
              issueRef: `${q.issue.owner}/${q.issue.repo}#${q.issue.number}`,
              issueContentHash:
                r.input?.issues.find(
                  (i) =>
                    i.ref.number === q.issue.number &&
                    i.ref.repo === q.issue.repo &&
                    i.ref.owner === q.issue.owner,
                )?.contentHash ?? '',
              textHash: hash(q.text),
              kind: q.kind,
              explicitness: q.explicitness,
              priority: q.priority,
              ambiguous: v?.status === 'uncertain' && v.reasons.some((x) => x.template.includes('ambig')),
              checkable: q.checkableInCode,
              confirmed: q.confirmed ?? false,
              text: retain ? q.text : null,
              quote: retain ? q.quote : null,
            };
          }),
        );
      if (res.units.length)
        await tx.insert(t.units).values(
          res.units.map((u) => ({
            reviewId: r.id,
            uid: u.id,
            file: u.file,
            symbol: u.symbol?.name ?? null,
            kind: u.kind,
            contentHash: u.contentHash,
            lineRanges: u.lines.new.map((l) => [l[0], l[1]] as [number, number]),
          })),
        );
      const facts = res.units.flatMap((u) =>
        u.facts.map((f) => ({
          reviewId: r.id,
          unitUid: u.id,
          kind: f.kind,
          severity: f.severity,
          line: f.line ?? null,
          detail: retain ? f.detail : f.kind,
        })),
      );
      if (facts.length) await tx.insert(t.facts).values(facts);
      if (res.findings.length)
        await tx.insert(t.findings).values(
          res.findings.map((f) => ({
            reviewId: r.id,
            fid: f.id,
            contentKey: f.contentKey,
            type: f.type,
            targetId: f.targetId,
            status: res.requirementVerdicts.find((v) => v.requirementId === f.targetId)?.status ?? null,
            priority: f.priority,
            route: f.route,
            confidence: f.confidence,
            answers:
              res.requirementVerdicts.find((v) => v.requirementId === f.targetId)?.answers ??
              res.unitVerdicts.find((v) => v.unitId === f.targetId)?.answers ??
              [],
            reasons: f.reasons.map((x) => (retain ? x : { template: x.template })),
            locations: f.locations,
          })),
        );
      if (r.apiCalls?.length)
        await tx.insert(t.apiCalls).values(r.apiCalls.map((c) => ({ reviewId: r.id, ...c })));
      if (r.config)
        await tx
          .update(t.repositories)
          .set({ config: r.config, configHash: hash(JSON.stringify(r.config)) })
          .where(eq(t.repositories.id, repositoryId));
      if (retain) {
        const expiresAt = new Date(
          new Date(r.createdAt).getTime() + (r.retention?.retentionDays ?? 14) * 86_400_000,
        );
        await tx
          .insert(t.payloads)
          .values([
            { reviewId: r.id, kind: 'result', content: res, expiresAt },
            ...(r.input ? [{ reviewId: r.id, kind: 'input', content: r.input, expiresAt }] : []),
          ]);
      }
    });
  }

  private async toRecord(
    row: typeof t.reviews.$inferSelect,
    repo: string,
    installationId: number,
  ): Promise<ReviewRecord> {
    const payload = await this.db
      .select()
      .from(t.payloads)
      .where(
        and(
          eq(t.payloads.reviewId, row.id),
          eq(t.payloads.kind, 'result'),
          sql`${t.payloads.expiresAt} > now()`,
        ),
      );
    return {
      id: row.id,
      installationId,
      repo,
      pr: row.prNumber,
      headSha: row.headSha,
      result: (payload[0]?.content ?? row.result) as ReviewResult,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async latestReview(repo: string, pr: number): Promise<ReviewRecord | null> {
    const rows = await this.db
      .select({ review: t.reviews, installationId: t.repositories.installationId })
      .from(t.reviews)
      .innerJoin(t.repositories, eq(t.reviews.repositoryId, t.repositories.id))
      .where(and(eq(t.repositories.fullName, repo), eq(t.reviews.prNumber, pr)))
      .orderBy(desc(t.reviews.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? this.toRecord(row.review, repo, row.installationId) : null;
  }

  async getReview(id: string): Promise<(ReviewRecord & { installationId: number }) | null> {
    const rows = await this.db
      .select({
        review: t.reviews,
        repo: t.repositories.fullName,
        installationId: t.repositories.installationId,
      })
      .from(t.reviews)
      .innerJoin(t.repositories, eq(t.reviews.repositoryId, t.repositories.id))
      .where(eq(t.reviews.id, id));
    const row = rows[0];
    return row ? this.toRecord(row.review, row.repo, row.installationId) : null;
  }

  async listReviews(f: ReviewFilter): Promise<ReviewRow[]> {
    if (!f.installationIds.length) return [];
    const where = [inArray(t.repositories.installationId, f.installationIds)];
    if (f.repo) where.push(eq(t.repositories.fullName, f.repo));
    if (f.status) where.push(eq(t.reviews.status, f.status));
    if (f.hasP0 !== undefined) where.push(eq(t.reviews.hasP0, f.hasP0));
    if (f.since) where.push(sql`${t.reviews.createdAt} >= ${f.since}`);
    const rows = await this.db
      .select({
        id: t.reviews.id,
        repo: t.repositories.fullName,
        prNumber: t.reviews.prNumber,
        headSha: t.reviews.headSha,
        status: t.reviews.status,
        mode: t.reviews.mode,
        hasP0: t.reviews.hasP0,
        costUsd: t.reviews.costUsd,
        latencyMs: t.reviews.latencyMs,
        createdAt: t.reviews.createdAt,
        installationId: t.repositories.installationId,
      })
      .from(t.reviews)
      .innerJoin(t.repositories, eq(t.reviews.repositoryId, t.repositories.id))
      .where(and(...where))
      .orderBy(desc(t.reviews.createdAt))
      .limit(Math.min(f.limit ?? 100, 500));
    return rows;
  }

  // ------------------------------------------------------------------------------------------ checklists
  async getChecklist(repo: string, issue: number): Promise<ChecklistRecord | null> {
    const rows = await this.db
      .select({ c: t.confirmedChecklists })
      .from(t.confirmedChecklists)
      .innerJoin(t.repositories, eq(t.confirmedChecklists.repositoryId, t.repositories.id))
      .where(and(eq(t.repositories.fullName, repo), eq(t.confirmedChecklists.issueNumber, issue)));
    const c = rows[0]?.c;
    if (!c) return null;
    return {
      repo,
      issue,
      contentHash: c.issueContentHash,
      requirements: c.requirements as ChecklistRecord['requirements'],
      ...(c.confirmedBy ? { confirmedBy: c.confirmedBy } : {}),
      ...(c.confirmedAt ? { confirmedAt: c.confirmedAt.toISOString() } : {}),
    };
  }
  async saveChecklist(c: ChecklistRecord): Promise<void> {
    const repositoryId = await this.repositoryId(c.repo, (await this.installationOf(c.repo)) ?? 0);
    const values = {
      repositoryId,
      issueNumber: c.issue,
      issueContentHash: c.contentHash,
      requirements: c.requirements,
      confirmedBy: c.confirmedBy ?? null,
      confirmedAt: c.confirmedAt ? new Date(c.confirmedAt) : null,
    };
    await this.db
      .insert(t.confirmedChecklists)
      .values(values)
      .onConflictDoUpdate({
        target: [t.confirmedChecklists.repositoryId, t.confirmedChecklists.issueNumber],
        set: values,
      });
  }
  async deleteChecklist(repo: string, issue: number): Promise<void> {
    const found = await this.db.select().from(t.repositories).where(eq(t.repositories.fullName, repo));
    if (!found[0]) return;
    await this.db
      .delete(t.confirmedChecklists)
      .where(
        and(
          eq(t.confirmedChecklists.repositoryId, found[0].id),
          eq(t.confirmedChecklists.issueNumber, issue),
        ),
      );
  }

  // -------------------------------------------------------------------------------------------- feedback
  async addFeedback(f: FeedbackRecord): Promise<void> {
    await this.db.insert(t.feedback).values({
      findingId: f.findingId,
      contentKey: f.contentKey,
      githubLogin: f.login,
      label: f.label,
      reason: f.reason ?? null,
      source: f.source,
      repo: f.repo,
      prNumber: f.pr,
      createdAt: new Date(f.createdAt),
    });
  }
  async feedback(repo: string, pr: number): Promise<FeedbackRecord[]> {
    const rows = await this.db
      .select()
      .from(t.feedback)
      .where(and(eq(t.feedback.repo, repo), eq(t.feedback.prNumber, pr)));
    return rows.map((r) => ({
      repo: r.repo,
      pr: r.prNumber,
      findingId: r.findingId,
      contentKey: r.contentKey,
      login: r.githubLogin,
      label: r.label as FeedbackRecord['label'],
      ...(r.reason ? { reason: r.reason } : {}),
      source: r.source as FeedbackRecord['source'],
      createdAt: r.createdAt.toISOString(),
    }));
  }
  /** Feedback agreement by finding type, strong and weak labels apart (10.4 metrics page). */
  async agreementByType(installationIds: number[]) {
    if (!installationIds.length) return [];
    return this.db
      .select({
        type: t.findings.type,
        label: t.feedback.label,
        n: sql<number>`count(distinct ${t.feedback.id})::int`,
      })
      .from(t.feedback)
      .innerJoin(t.findings, eq(t.findings.contentKey, t.feedback.contentKey))
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.repositories, eq(t.reviews.repositoryId, t.repositories.id))
      .where(inArray(t.repositories.installationId, installationIds))
      .groupBy(t.findings.type, t.feedback.label);
  }

  // --------------------------------------------------------------------------------------- installations
  async addInstallation(id: number, account: string, repos: string[]): Promise<void> {
    await this.db
      .insert(t.installations)
      .values({ id, accountLogin: account })
      .onConflictDoUpdate({ target: t.installations.id, set: { accountLogin: account } });
    await this.setRepositories(id, repos, []);
  }
  async setRepositories(id: number, added: string[], removed: string[]): Promise<void> {
    await this.db.insert(t.installations).values({ id, accountLogin: 'unknown' }).onConflictDoNothing();
    for (const fullName of added)
      await this.db
        .insert(t.repositories)
        .values({ installationId: id, fullName })
        .onConflictDoUpdate({ target: t.repositories.fullName, set: { installationId: id } });
    if (removed.length)
      await this.db
        .delete(t.repositories)
        .where(and(eq(t.repositories.installationId, id), inArray(t.repositories.fullName, removed)));
  }
  async deleteInstallation(id: number): Promise<void> {
    const repos = await this.db.select().from(t.repositories).where(eq(t.repositories.installationId, id));
    const names = repos.map((r) => r.fullName);
    await this.db.transaction(async (tx) => {
      if (names.length) await tx.delete(t.feedback).where(inArray(t.feedback.repo, names));
      // Reviews, units, findings, facts, payloads and checklists cascade from repositories.
      await tx.delete(t.installations).where(eq(t.installations.id, id));
    });
  }
  async installationOf(repo: string): Promise<number | null> {
    const rows = await this.db.select().from(t.repositories).where(eq(t.repositories.fullName, repo));
    return rows[0]?.installationId ?? null;
  }
  async spendToday(installationId: number, now = new Date()): Promise<number> {
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${t.reviews.costUsd}), 0)::float` })
      .from(t.reviews)
      .innerJoin(t.repositories, eq(t.reviews.repositoryId, t.repositories.id))
      .where(
        and(eq(t.repositories.installationId, installationId), sql`${t.reviews.createdAt} >= ${midnight}`),
      );
    return Number(rows[0]?.total ?? 0);
  }
  async installations() {
    return this.db.select().from(t.installations);
  }
  async repositoriesOf(installationIds: number[]) {
    if (!installationIds.length) return [];
    return this.db
      .select()
      .from(t.repositories)
      .where(inArray(t.repositories.installationId, installationIds));
  }

  // -------------------------------------------------------------------------------- payloads and export
  /** Retention: deletes expired payloads and wipes text columns of their reviews (the cleanup job). */
  async cleanup(now = new Date()): Promise<{ payloads: number }> {
    const expired = await this.db
      .delete(t.payloads)
      .where(lt(t.payloads.expiresAt, now))
      .returning({ reviewId: t.payloads.reviewId });
    const ids = [...new Set(expired.map((e) => e.reviewId))];
    if (ids.length) {
      await this.db
        .update(t.requirements)
        .set({ text: null, quote: null })
        .where(inArray(t.requirements.reviewId, ids));
      await this.db
        .update(t.facts)
        .set({ detail: sql`${t.facts.kind}` })
        .where(inArray(t.facts.reviewId, ids));
      await this.db
        .update(t.findings)
        .set({
          reasons: sql`coalesce((select jsonb_agg(jsonb_build_object('template', r->>'template')) from jsonb_array_elements(${t.findings.reasons}) r), '[]'::jsonb)`,
        })
        .where(inArray(t.findings.reviewId, ids));
    }
    return { payloads: expired.length };
  }

  /** Reviews with a retained input payload and at least one feedback label: the source of corpus C. */
  async exportable(installationIds?: number[]) {
    const rows = await this.db
      .select({
        review: t.reviews,
        repo: t.repositories.fullName,
        installationId: t.repositories.installationId,
        input: t.payloads.content,
      })
      .from(t.reviews)
      .innerJoin(t.repositories, eq(t.reviews.repositoryId, t.repositories.id))
      .innerJoin(
        t.payloads,
        and(
          eq(t.payloads.reviewId, t.reviews.id),
          eq(t.payloads.kind, 'input'),
          sql`${t.payloads.expiresAt} > now()`,
        ),
      )
      .where(installationIds?.length ? inArray(t.repositories.installationId, installationIds) : sql`true`)
      .orderBy(desc(t.reviews.createdAt));
    const out: { review: ReviewRecord; input: ReviewInput; feedback: FeedbackRecord[] }[] = [];
    for (const row of rows) {
      const fb = await this.feedback(row.repo, row.review.prNumber);
      if (!fb.length) continue;
      out.push({
        review: await this.toRecord(row.review, row.repo, row.installationId),
        input: row.input as ReviewInput,
        feedback: fb,
      });
    }
    return out;
  }

  async saveEvalRun(r: typeof t.evalRuns.$inferInsert): Promise<void> {
    await this.db.insert(t.evalRuns).values(r).onConflictDoNothing();
  }
  async evalRuns() {
    return this.db.select().from(t.evalRuns).orderBy(desc(t.evalRuns.createdAt)).limit(200);
  }

  /**
   * Nightly recalibration from strong human labels (the `recalibrate` job): measured agreement per finding type and
   * P0 precision, stored in `calibrations` as method `feedback`. Probability maps still come from `remit calibrate`.
   */
  async recalibrateFromFeedback(
    jevModel: string,
    questionSet: string,
  ): Promise<{ n: number; p0Precision: number | null }> {
    const rows = await this.db
      .select({
        priority: t.findings.priority,
        label: t.feedback.label,
        n: sql<number>`count(distinct ${t.feedback.id})::int`,
      })
      .from(t.feedback)
      .innerJoin(t.findings, eq(t.findings.contentKey, t.feedback.contentKey))
      .where(inArray(t.feedback.label, ['agree', 'disagree']))
      .groupBy(t.findings.priority, t.feedback.label);
    const count = (priority: string | null, label: string) =>
      rows
        .filter((r) => (priority === null || r.priority === priority) && r.label === label)
        .reduce((s, r) => s + r.n, 0);
    const agree = count('P0', 'agree');
    const disagree = count('P0', 'disagree');
    const n = count(null, 'agree') + count(null, 'disagree');
    const p0Precision = agree + disagree ? agree / (agree + disagree) : null;
    await this.db
      .update(t.calibrations)
      .set({ active: false })
      .where(and(eq(t.calibrations.method, 'feedback'), eq(t.calibrations.jevModel, jevModel)));
    await this.db.insert(t.calibrations).values({
      jevModel,
      questionSet,
      questionKey: 'finding.p0',
      method: 'feedback',
      params: { agree, disagree, p0Precision },
      n,
      active: true,
    });
    return { n, p0Precision };
  }

  async apiCallsFor(reviewId: string) {
    return this.db.select().from(t.apiCalls).where(eq(t.apiCalls.reviewId, reviewId));
  }

  /** Imports eval runs from report directories (`eval/reports/<run>/metrics.json`); stored runs are skipped. */
  async importEvalRuns(reportsDir: string): Promise<number> {
    if (!existsSync(reportsDir)) return 0;
    let added = 0;
    for (const name of readdirSync(reportsDir)) {
      const file = join(reportsDir, name, 'metrics.json');
      if (!existsSync(file)) continue;
      let parsed: {
        info: { corpus: string; split: string; gitSha: string; startedAt: string };
        metrics: { ops?: { costTotal?: number } };
      };
      try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        // A partial or foreign directory is skipped; the dashboard shows the runs that parsed.
        continue;
      }
      const rows = await this.db
        .insert(t.evalRuns)
        .values({
          id: name,
          corpus: parsed.info.corpus,
          split: parsed.info.split,
          gitSha: parsed.info.gitSha,
          questionSet: QUESTION_SET_VERSION,
          metrics: parsed.metrics,
          reportPath: join(reportsDir, name, 'report.md'),
          costUsd: parsed.metrics.ops?.costTotal ?? 0,
          createdAt: new Date(parsed.info.startedAt),
        })
        .onConflictDoNothing()
        .returning();
      added += rows.length;
    }
    return added;
  }
}
