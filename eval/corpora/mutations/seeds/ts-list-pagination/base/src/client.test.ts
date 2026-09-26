import { describe, expect, it } from 'vitest';
import { listAll, type Page, type Transport } from './client.js';

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
});
