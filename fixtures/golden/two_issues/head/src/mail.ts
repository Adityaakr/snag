export function notifyExportDone(send: (to: string, body: string) => void, owner: string): void {
  send(owner, 'Your export is ready');
}
