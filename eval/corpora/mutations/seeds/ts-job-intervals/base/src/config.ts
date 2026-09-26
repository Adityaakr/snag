export const DEFAULTS = {
  maxRetries: 3,
  timeoutMs: 5000,
  queueName: 'default',
};

export function jobDefaults() {
  return { retries: DEFAULTS.maxRetries, timeoutMs: DEFAULTS.timeoutMs, queue: DEFAULTS.queueName };
}
