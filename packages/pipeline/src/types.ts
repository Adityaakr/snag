import type { IssueRef, IssueSnapshot } from '@remit/core';

/** Everything one review starts from (BUILD_PROMPT 4.1). Stages read only the fields they are allowed to. */
export interface ReviewInput {
  mode: 'github' | 'local';
  repo?: string;
  prNumber?: number;
  baseSha: string;
  headSha: string;
  linkStrength: 'closing' | 'weak' | 'none';
  issueRefs: IssueRef[];
  /** Issue snapshots: the only input requirement extraction ever sees. */
  issues: IssueSnapshot[];
  /** The agent's story. Read only by the claims check, after the blind pass (BUILD_PROMPT 2.4, 6.8). */
  pr: { title: string; body: string; author?: string };
  diffText: string;
}
