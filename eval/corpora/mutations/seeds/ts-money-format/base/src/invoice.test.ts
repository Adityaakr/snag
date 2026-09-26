import { describe, expect, it } from 'vitest';
import { dueDate, invoiceTotal } from './invoice.js';

describe('invoice', () => {
  it('adds tax to the subtotal', () => {
    expect(invoiceTotal([{ quantity: 2, unitPrice: 50 }])).toBe(125);
  });

  it('is due thirty days after issue', () => {
    expect(dueDate(new Date('2026-01-01T00:00:00Z')).toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
});
