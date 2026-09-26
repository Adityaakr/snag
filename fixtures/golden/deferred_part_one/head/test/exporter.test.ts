import { expect, it } from 'vitest';
import { exportCsv } from '../src/exporter';

it('exports csv', () => {
  expect(exportCsv([['a', 'b']])).toBe('a,b');
});
