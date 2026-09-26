import { expect, it } from 'vitest';
import { renderInvoice } from '../src/invoice';

it('shows a total with tax', () => {
  expect(renderInvoice([100])).toContain('Total: 120');
});
