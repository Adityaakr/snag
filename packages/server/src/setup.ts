/**
 * `/setup`: GitHub's App Manifest flow (BUILD_PROMPT 10.2). The page pre-fills the manifest (name from BRAND, webhook
 * URL from PUBLIC_URL, the 10.2 permissions and events), the callback exchanges the code, stores the credentials
 * encrypted (or shows them once), and links to the install page.
 */
import { BRAND } from '@remit/core';

export const PERMISSIONS = {
  pull_requests: 'write',
  checks: 'write',
  contents: 'read',
  metadata: 'read',
  issues: 'write',
} as const;
/** The read-only variant (no issue checklist, no labels) documented in docs/github-app.md. */
export const READ_ONLY_PERMISSIONS = { ...PERMISSIONS, issues: 'read' } as const;
export const EVENTS = ['pull_request', 'issues', 'issue_comment', 'check_run'] as const;

export function manifest(publicUrl: string, readOnly = false) {
  const base = publicUrl.replace(/\/+$/, '');
  return {
    name: BRAND.name,
    url: base,
    hook_attributes: { url: `${base}/webhooks`, active: true },
    redirect_url: `${base}/setup/callback`,
    public: false,
    default_permissions: readOnly ? READ_ONLY_PERMISSIONS : PERMISSIONS,
    default_events: [...EVENTS],
  };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:44rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#1f2328}button{font:inherit;padding:.5rem 1rem;border-radius:6px;border:1px solid #1f2328;background:#1f2328;color:#fff;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #0969da;outline-offset:2px}pre{background:#f6f8fa;padding:1rem;overflow:auto;white-space:pre-wrap}</style></head><body>${body}</body></html>`;
}

export function setupPage(publicUrl: string, state: string, org?: string, readOnly = false): string {
  const target = org
    ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${state}`
    : `https://github.com/settings/apps/new?state=${state}`;
  const json = JSON.stringify(manifest(publicUrl, readOnly));
  return page(
    `Set up ${BRAND.name}`,
    `<h1>Set up ${esc(BRAND.name)}</h1><p>This creates a private GitHub App named ${esc(BRAND.name)} that sends webhooks to <code>${esc(publicUrl)}/webhooks</code>. ${readOnly ? 'This is the read-only variant: no issue checklist and no labels.' : 'Issues write is used only for the issue checklist and labels.'}</p><form action="${esc(target)}" method="post"><input type="hidden" name="manifest" value="${esc(json)}"><button type="submit">Create the GitHub App</button></form>`,
  );
}

export function setupDonePage(
  htmlUrl: string,
  stored: boolean,
  shown?: { appId: string; webhookSecret: string; privateKey: string },
): string {
  const install = `${htmlUrl.replace(/\/+$/, '')}/installations/new`;
  const secrets = shown
    ? `<p>SECRETS_ENCRYPTION_KEY is not set, so the credentials are shown once. Put them in the server environment now; they are not stored.</p><pre>GITHUB_APP_ID=${esc(shown.appId)}\nGITHUB_WEBHOOK_SECRET=${esc(shown.webhookSecret)}\nGITHUB_APP_PRIVATE_KEY="${esc(shown.privateKey)}"</pre>`
    : '';
  return page(
    `${BRAND.name} is set up`,
    `<h1>${esc(BRAND.name)} is set up</h1>${stored ? '<p>The app credentials are stored encrypted with SECRETS_ENCRYPTION_KEY.</p>' : ''}${secrets}<p><a href="${esc(install)}">Install ${esc(BRAND.name)} on your repositories</a></p>`,
  );
}

export function errorPage(message: string): string {
  return page(
    `${BRAND.name} setup failed`,
    `<h1>Setup failed</h1><p>${esc(message)}</p><p><a href="/setup">Start again</a></p>`,
  );
}
