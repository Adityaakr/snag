/**
 * Slash commands (BUILD_PROMPT 10.2): accepted only from users with write or triage permission (or the issue author
 * for `confirm`); bots and the App's own comments are ignored.
 */
import { BRAND, explainMarkdown, sanitize } from '@remit/core';

export type SlashCommand =
  | { name: 'review' }
  | { name: 'agree'; ids: string[] }
  | { name: 'disagree'; ids: string[]; reason?: string }
  | { name: 'explain'; id: string }
  | { name: 'confirm' }
  | { name: 'help' }
  | { name: 'unknown'; text: string };

const FINDING_ID = /^F-[A-Z0-9.]+(-[a-z_]+)?$/;

/** The first line of a comment that starts with `/remit`, parsed; null when there is none. */
export function parseSlash(body: string): SlashCommand | null {
  const line = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${BRAND.slashCommand} `) || l === BRAND.slashCommand);
  if (!line) return null;
  const [, cmd = 'help', ...rest] = line.split(/\s+/);
  switch (cmd) {
    case 'review':
      return { name: 'review' };
    case 'help':
      return { name: 'help' };
    case 'confirm':
      return { name: 'confirm' };
    case 'explain':
      return rest[0] && FINDING_ID.test(rest[0])
        ? { name: 'explain', id: rest[0] }
        : { name: 'unknown', text: line };
    case 'agree': {
      const ids = rest.filter((x) => FINDING_ID.test(x));
      return ids.length ? { name: 'agree', ids } : { name: 'unknown', text: line };
    }
    case 'disagree': {
      const [id, ...reason] = rest;
      if (!id || !FINDING_ID.test(id)) return { name: 'unknown', text: line };
      const text = reason.join(' ').trim();
      return { name: 'disagree', ids: [id], ...(text ? { reason: text.slice(0, 500) } : {}) };
    }
    default:
      return { name: 'unknown', text: line };
  }
}

export const HELP = [
  `### ${BRAND.name} commands`,
  '',
  `- \`${BRAND.slashCommand} review\` runs the review again.`,
  `- \`${BRAND.slashCommand} agree <finding-id...>\` and \`${BRAND.slashCommand} disagree <finding-id> [reason]\` record whether a finding was right.`,
  `- \`${BRAND.slashCommand} explain <finding-id>\` shows the raw answers, thresholds and evidence behind a finding.`,
  `- \`${BRAND.slashCommand} confirm\` (on an issue) confirms ${BRAND.name}'s checklist for it.`,
  `- \`${BRAND.slashCommand} help\` shows this list.`,
  '',
  'Only people with write or triage access can run commands.',
].join('\n');

export const WRITE_ROLES = new Set(['admin', 'maintain', 'write', 'triage']);

export function isBotLogin(login: string, type?: string): boolean {
  return type === 'Bot' || login.endsWith('[bot]');
}

export { explainMarkdown, sanitize };
