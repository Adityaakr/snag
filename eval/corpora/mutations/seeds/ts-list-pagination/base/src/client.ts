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

export async function listAll(transport: Transport, path: string): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  do {
    const page = await transport(path + toQueryString({ cursor }), requestHeaders());
    items.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return items;
}
