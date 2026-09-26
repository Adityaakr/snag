import { expect, it } from 'vitest';
import { discount } from '../src/discount';

it('discounts large orders', () => {
  expect(discount(200)).toBe(180);
});
