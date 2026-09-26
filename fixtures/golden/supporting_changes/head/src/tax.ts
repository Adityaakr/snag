import type { TaxedTotal } from './types';

export function withTax(net: number, rate: number): TaxedTotal {
  const tax = net * rate;
  return { net, tax, gross: net + tax };
}
