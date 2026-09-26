export interface Report {
  date: string;
  rows: string[][];
}

export function exportReport(report: Report): string {
  return JSON.stringify(report.rows);
}
