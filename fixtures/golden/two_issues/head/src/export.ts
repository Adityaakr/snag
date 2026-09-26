export function exportRows(rows: string[]): string {
  return rows.join('\n');
}

export function downloadCsv(rows: string[]): Blob {
  return new Blob([exportRows(rows)], { type: 'text/csv' });
}
