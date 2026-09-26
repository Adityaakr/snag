import { BRAND, type CommentRole } from '@remit/core';

const MAINTAINER = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** Role of a comment author (BUILD_PROMPT 6.1): the issue opener is `author`, OWNER/MEMBER/COLLABORATOR `maintainer`. */
export function commentRole(
  login: string,
  association: string | undefined,
  issueAuthor: string,
): CommentRole {
  if (login.toLowerCase() === issueAuthor.toLowerCase()) return 'author';
  if (association && MAINTAINER.has(association)) return 'maintainer';
  return 'other';
}

/** True for bot accounts and for Remit's own comments, which never feed extraction. */
export function isBotComment(login: string, userType: string | undefined, body: string): boolean {
  return (
    userType === 'Bot' ||
    /\[bot\]$/i.test(login) ||
    body.includes(`<!-- ${BRAND.commentMarker}`) ||
    body.includes(`<!-- ${BRAND.slug}:`)
  );
}
