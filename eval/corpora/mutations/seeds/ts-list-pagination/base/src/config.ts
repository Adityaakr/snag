export const CLIENT_DEFAULTS = {
  userAgent: 'acme-client/1.4.0',
  timeoutMs: 10000,
};

export function requestHeaders(): Record<string, string> {
  return {
    'User-Agent': CLIENT_DEFAULTS.userAgent,
    'X-Timeout-Ms': String(CLIENT_DEFAULTS.timeoutMs),
  };
}
