import { FLAG_DEFAULTS } from './config.js';
import type { FlagRule } from './flags.js';

export function parseRules(text: string): FlagRule[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new TypeError(`${FLAG_DEFAULTS.source} must hold a JSON array of rules`);
  }
  return parsed as FlagRule[];
}

export function refreshIntervalMs(): number {
  return FLAG_DEFAULTS.refreshSeconds * 1000;
}
