import { INVOICE_DEFAULTS } from './config.js';

export interface Line {
  quantity: number;
  unitPrice: number;
}

export function invoiceTotal(lines: Line[]): number {
  let subtotal = 0;
  for (const line of lines) {
    subtotal += line.quantity * line.unitPrice;
  }
  return subtotal * (1 + INVOICE_DEFAULTS.taxRate);
}

export function dueDate(issued: Date): Date {
  const due = new Date(issued.getTime());
  due.setUTCDate(due.getUTCDate() + INVOICE_DEFAULTS.dueDays);
  return due;
}
