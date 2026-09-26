import { describe, expect, it, vi } from 'vitest';
import { clampPageSize, listAll, type Page, PaginationError, type Transport } from './client.js';

function pages(...list: Page[]): Transport {
  let i = 0;
  return async () => list[i++] ?? { items: [], next_cursor: null };
}

describe('listAll', () => {
  it('follows next_cursor across pages', async () => {
    const transport = pages(
      { items: [{ id: 'a' }, { id: 'b' }], next_cursor: 'c1' },
      { items: [{ id: 'c' }], next_cursor: null },
    );
    const items = await listAll(transport, '/items');
    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('clamps the page size to 1..100', () => {
    expect(clampPageSize(500)).toBe(100);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(25)).toBe(25);
  });

  it('sends the page size as the limit parameter', async () => {
    const transport = vi.fn<Transport>(async () => ({ items: [], next_cursor: null }));
    await listAll(transport, '/items', { pageSize: 20 });
    await listAll(transport, '/items');
    expect(transport.mock.calls.map((call) => call[0])).toEqual(['/items?limit=20', '/items?limit=50']);
  });

  it('stops at the default page limit', async () => {
    const transport = vi.fn<Transport>(async () => ({ items: [{ id: 'x' }], next_cursor: 'more' }));
    await expect(listAll(transport, '/items')).rejects.toThrow(PaginationError);
    expect(transport).toHaveBeenCalledTimes(10);
  });

  it('says how many pages it read', async () => {
    const transport = vi.fn<Transport>(async () => ({ items: [], next_cursor: 'more' }));
    await expect(listAll(transport, '/items', { maxPages: 3 })).rejects.toThrow('stopped after 3 pages');
  });

  it('returns an item seen on two pages once', async () => {
    const transport = pages(
      { items: [{ id: 'a' }, { id: 'b' }], next_cursor: 'c1' },
      { items: [{ id: 'b' }, { id: 'c' }], next_cursor: null },
    );
    const items = await listAll(transport, '/items');
    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});
