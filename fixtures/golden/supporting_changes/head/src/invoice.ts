import { withTax } from './tax';

export function renderInvoice(lines: number[]): string {
  const net = lines.reduce((a, b) => a + b, 0);
  const total = withTax(net, 0.2);
  return `${lines.join(',')}\nTotal: ${total.gross}`;
}
