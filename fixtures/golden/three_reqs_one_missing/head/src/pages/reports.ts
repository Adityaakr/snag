import { downloadCsv, type Report } from '../reports/export';

export function onExportClick(report: Report): Blob {
  return downloadCsv(report, ['name', 'value']);
}
