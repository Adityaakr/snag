/**
 * Structured logs (BUILD_PROMPT 9.8, M9): pino JSON with redact paths for credentials, and a `reviewId` on every
 * line a review writes (through child loggers).
 */
import { pino, type Logger } from 'pino';

export const REDACT_PATHS = [
  'authorization',
  'cookie',
  '*.cookie',
  'headers.cookie',
  'headers["set-cookie"]',
  'headers["x-api-key"]',
  '*.headers.authorization',
  '*.headers.cookie',
  '*.headers["x-api-key"]',
  '*.*.token',
  '*.*.apiKey',
  '*.*.privateKey',
  '*.authorization',
  'headers.authorization',
  'headers["x-hub-signature-256"]',
  'token',
  '*.token',
  'privateKey',
  '*.privateKey',
  'webhookSecret',
  '*.webhookSecret',
  'clientSecret',
  '*.clientSecret',
  'apiKey',
  '*.apiKey',
  // Any environment object that reaches a log line is redacted whole.
  'env.*',
  '*.env.*',
  '*.*.env.*',
];

export type { Logger };

export function createLogger(
  opts: { role?: string; level?: string; destination?: NodeJS.WritableStream } = {},
): Logger {
  return pino(
    {
      level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
      base: { service: 'remit', ...(opts.role ? { role: opts.role } : {}) },
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    opts.destination ?? process.stderr,
  );
}

/** A logger that drops everything (tests and embedding). */
export const silent: Logger = pino({ level: 'silent' });
