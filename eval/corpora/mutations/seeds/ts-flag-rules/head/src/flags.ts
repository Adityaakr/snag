export interface User {
  id: string;
  email: string;
  country: string;
}

export interface FlagRule {
  flag: string;
  enabled: boolean;
  countries?: string[];
  domains?: string[];
  percent?: number;
  startsAt?: string;
  allowUsers?: string[];
}

export function matchesTargets(rule: FlagRule, user: User): boolean {
  if (rule.countries && !rule.countries.includes(user.country)) return false;
  if (rule.domains && !rule.domains.includes(user.email.slice(user.email.indexOf('@') + 1).toLowerCase())) return false;
  return true;
}

export function bucketOf(flag: string, userId: string): number {
  let hash = 2166136261;
  for (const ch of `${flag}:${userId}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 100;
}

function inRollout(rule: FlagRule, flag: string, user: User): boolean {
  if (rule.percent === undefined) return true;
  return bucketOf(flag, user.id) < rule.percent;
}

export function isEnabled(rules: FlagRule[], flag: string, user: User, now: Date = new Date()): boolean {
  const rule = rules.find((r) => r.flag === flag);
  if (!rule || !rule.enabled) return false;
  if (rule.allowUsers?.includes(user.id)) return true;
  if (rule.startsAt && now.getTime() < Date.parse(rule.startsAt)) return false;
  if (!matchesTargets(rule, user)) return false;
  if (!inRollout(rule, flag, user)) return false;
  return true;
}
