export function exportData(rows: string[][]): string {
  return JSON.stringify(rows);
}

export function exportCsv(rows: string[][]): string {
  return rows.map((r) => r.join(',')).join('\n');
}
