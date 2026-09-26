// Unit tests never touch the network (BUILD_PROMPT 12). Outbound connections to
// non-local hosts throw unless a test installs msw or a fake, or the live suite
// sets REMIT_ALLOW_NETWORK=1.
import net from 'node:net';

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '']);

export class NetworkBlockedError extends Error {
  constructor(target: string) {
    super(`Network access is blocked in unit tests (tried ${target}). Use msw or a fake provider.`);
    this.name = 'NetworkBlockedError';
  }
}

if (process.env.REMIT_ALLOW_NETWORK !== '1') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!LOCAL.has(url.hostname)) throw new NetworkBlockedError(url.href);
    return originalFetch(input, init);
  }) as typeof fetch;

  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patchedConnect(this: net.Socket, ...args: unknown[]) {
    // net.connect passes a normalized [options, callback] array; socket.connect may get options or (port, host).
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const host =
      typeof first === 'object' && first !== null && 'host' in first
        ? String((first as { host?: unknown }).host ?? '')
        : typeof args[1] === 'string'
          ? args[1]
          : '';
    const isPipe = typeof first === 'object' && first !== null && 'path' in first;
    if (!isPipe && !LOCAL.has(host)) throw new NetworkBlockedError(host);
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
}
