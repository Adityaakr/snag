export interface Report {
  date: string;
  rows: string[][];
}

export function exportReport(report: Report): string {
  return JSON.stringify(report.rows);
}

export function buildCsv(report: Report, header: string[]): string {
  const lines = [header.join(','), ...report.rows.map((r) => r.join(','))];
  return lines.join('\n');
}

export function downloadCsv(report: Report, header: string[]): Blob {
  return new Blob([buildCsv(report, header)], { type: 'text/csv' });
}
