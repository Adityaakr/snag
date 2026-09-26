/** The dashboard's API client: same-origin JSON with the session's CSRF token on mutations. */
export declare class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string);
}
export declare const setCsrf: (token: string) => void;
export declare function api<T>(
  path: string,
  init?: {
    method?: string;
    body?: unknown;
  },
): Promise<T>;
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
  createdAt: string;
}
export interface QueueItem {
  reviewId: string;
  repo: string;
  pr: number;
  quote?: string;
  finding: {
    id: string;
    type: string;
    priority: string;
    confidence: number;
    locations: {
      file: string;
      lines: [number, number];
    }[];
    reasons: string[];
  };
}
//# sourceMappingURL=api.d.ts.map
