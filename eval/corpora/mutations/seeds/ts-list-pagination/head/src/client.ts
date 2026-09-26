import { requestHeaders } from './config.js';
import { toQueryString } from './query.js';

export interface Item {
  id: string;
  [key: string]: unknown;
}

export interface Page {
  items: Item[];
  next_cursor: string | null;
}

export type Transport = (url: string, headers: Record<string, string>) => Promise<Page>;

export interface ListOptions {
  pageSize?: number;
  maxPages?: number;
}

export class PaginationError extends Error {
  constructor(readonly pages: number) {
    super(`stopped after ${pages} pages`);
    this.name = 'PaginationError';
  }
}

export function clampPageSize(size: number): number {
  if (size > 100) return 100;
  if (size < 1) return 1;
  return Math.floor(size);
}

export function uniqueById(items: Item[]): Item[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export async function listAll(transport: Transport, path: string, opts: ListOptions = {}): Promise<Item[]> {
  const limit = clampPageSize(opts.pageSize ?? 50);
  const maxPages = opts.maxPages ?? 10;
  const items: Item[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    if (pages >= maxPages) {
      throw new PaginationError(pages);
    }
    const page = await transport(path + toQueryString({ cursor, limit }), requestHeaders());
    items.push(...page.items);
    cursor = page.next_cursor ?? undefined;
    pages++;
  } while (cursor);
  return uniqueById(items);
}
