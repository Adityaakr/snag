import { exportCsv } from '../exporter';

export function onDownload(rows: string[][]): string {
  return exportCsv(rows);
}
