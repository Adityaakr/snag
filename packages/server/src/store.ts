/**
 * What the App remembers (BUILD_PROMPT 10.2, 10.4): reviews, confirmed and pending issue checklists, feedback labels
 * and installations. In memory for M7; the Postgres tables replace this in M8 behind the same interface.
 */
import type { RemitConfig, Requirement, ReviewResult } from '@remit/core';
import type { CallRecord } from '@remit/providers';
import type { ReviewInput } from '@remit/pipeline';

export interface ReviewRecord {
  id: string;
  installationId: number;
  repo: string;
  pr: number;
  headSha: string;
  result: ReviewResult;
  createdAt: string;
  /** The review input (issue snapshots and diff), stored only when payloads are retained. */
  input?: ReviewInput;
  retention?: { retainPayloads: boolean; retentionDays: number };
  /** Per-call provider usage (the `api_calls` table), without content. */
  apiCalls?: CallRecord[];
  /** The effective repository config used for this review. */
  config?: RemitConfig;
}

export interface ChecklistRecord {
  repo: string;
  issue: number;
  contentHash: string;
  requirements: Requirement[];
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface FeedbackRecord {
  repo: string;
  pr: number;
  findingId: string;
  contentKey: string;
  login: string;
  label: 'agree' | 'disagree' | 'weak_agree' | 'weak_disagree';
  reason?: string;
  source: 'slash' | 'dashboard' | 'implicit';
  createdAt: string;
}

export interface Store {
  saveReview(r: ReviewRecord): Promise<void>;
  latestReview(repo: string, pr: number): Promise<ReviewRecord | null>;
  /** The checklist posted for an issue, confirmed or not. */
  getChecklist(repo: string, issue: number): Promise<ChecklistRecord | null>;
  saveChecklist(c: ChecklistRecord): Promise<void>;
  deleteChecklist(repo: string, issue: number): Promise<void>;
  addFeedback(f: FeedbackRecord): Promise<void>;
  feedback(repo: string, pr: number): Promise<FeedbackRecord[]>;
  addInstallation(id: number, account: string, repos: string[]): Promise<void>;
  setRepositories(id: number, added: string[], removed: string[]): Promise<void>;
  /** Uninstall: deletes everything stored for the installation (delete_on_uninstall). */
  deleteInstallation(id: number): Promise<void>;
  installationOf(repo: string): Promise<number | null>;
}

export class MemoryStore implements Store {
  readonly reviews: ReviewRecord[] = [];
  readonly checklists = new Map<string, ChecklistRecord>();
  readonly feedbackRows: FeedbackRecord[] = [];
  readonly installations = new Map<number, { account: string; repos: Set<string> }>();

  async saveReview(r: ReviewRecord) {
    this.reviews.push(r);
  }
  async latestReview(repo: string, pr: number) {
    return [...this.reviews].reverse().find((r) => r.repo === repo && r.pr === pr) ?? null;
  }
  async getChecklist(repo: string, issue: number) {
    return this.checklists.get(`${repo}#${issue}`) ?? null;
  }
  async saveChecklist(c: ChecklistRecord) {
    this.checklists.set(`${c.repo}#${c.issue}`, c);
  }
  async deleteChecklist(repo: string, issue: number) {
    this.checklists.delete(`${repo}#${issue}`);
  }
  async addFeedback(f: FeedbackRecord) {
    this.feedbackRows.push(f);
  }
  async feedback(repo: string, pr: number) {
    return this.feedbackRows.filter((f) => f.repo === repo && f.pr === pr);
  }
  async addInstallation(id: number, account: string, repos: string[]) {
    this.installations.set(id, { account, repos: new Set(repos) });
  }
  async setRepositories(id: number, added: string[], removed: string[]) {
    const inst = this.installations.get(id) ?? { account: 'unknown', repos: new Set<string>() };
    for (const r of added) inst.repos.add(r);
    for (const r of removed) inst.repos.delete(r);
    this.installations.set(id, inst);
  }
  async deleteInstallation(id: number) {
    const repos = this.installations.get(id)?.repos ?? new Set<string>();
    this.installations.delete(id);
    const owned = (repo: string) => repos.has(repo);
    for (let i = this.reviews.length - 1; i >= 0; i--) {
      const r = this.reviews[i] as ReviewRecord;
      if (r.installationId === id || owned(r.repo)) this.reviews.splice(i, 1);
    }
    for (const [k, c] of this.checklists) if (owned(c.repo)) this.checklists.delete(k);
    for (let i = this.feedbackRows.length - 1; i >= 0; i--)
      if (owned((this.feedbackRows[i] as FeedbackRecord).repo)) this.feedbackRows.splice(i, 1);
  }
  async installationOf(repo: string) {
    for (const [id, inst] of this.installations) if (inst.repos.has(repo)) return id;
    return null;
  }
}
