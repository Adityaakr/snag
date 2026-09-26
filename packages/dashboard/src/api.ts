/** The dashboard's API client: same-origin JSON with the session's CSRF token on mutations. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let csrf = '';
export const setCsrf = (token: string) => {
  csrf = token;
};

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.method && init.method !== 'GET' ? { 'x-csrf-token': csrf } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) throw new ApiError(res.status, `${res.status}`);
  return (await res.json()) as T;
}

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
    locations: { file: string; lines: [number, number] }[];
    reasons: string[];
  };
}
