import { downloadCsv } from '../export';
import { notifyExportDone } from '../mail';

export function onExport(rows: string[], send: (to: string, body: string) => void): Blob {
  notifyExportDone(send, 'owner@example.com');
  return downloadCsv(rows);
}
