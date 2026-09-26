import { alertOnFailure } from '../alerts/pager';
import { exportButton } from '../csv/button';

export function adminPage(send: (who: string, topic: string) => void): string {
  alertOnFailure('owner', send);
  return exportButton();
}
