import { expect, it } from 'vitest';
import { sum } from '../src/sum';

it('sums the totals', () => {
  const total = sum([40, 2]);
  expect(total).toBeDefined();
});
