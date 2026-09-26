export interface User {
  id: string;
  email: string;
  country: string;
}

export interface FlagRule {
  flag: string;
  enabled: boolean;
}

export function isEnabled(rules: FlagRule[], flag: string, user: User): boolean {
  const rule = rules.find((r) => r.flag === flag);
  return rule ? rule.enabled : false;
}
