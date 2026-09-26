import { describe, expect, it } from 'vitest';
import { buildCsv, downloadCsv } from '../src/reports/export';

const report = { date: '2026-09-01', rows: [['a', '1']] };

describe('csv export', () => {
  it('downloads a csv blob', () => {
    expect(downloadCsv(report, ['name', 'value']).type).toBe('text/csv');
  });

  it('includes a header row', () => {
    expect(buildCsv(report, ['name', 'value']).split('\n')[0]).toBe('name,value');
  });
});
