import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeGitHub } from '@remit/providers';
import { describe, expect, it } from 'vitest';
import { markerOf, upsertSticky, withMarker } from '@remit/providers';
import { MemoryDeliveryStore } from './deliveries.js';
import { fakeRepo } from './fake-harness.js';
import { MemoryQueue } from './queue.js';
import { reviewPullRequest } from './review-job.js';
import { decrypt, encrypt, FileSecretStore } from './secrets.js';
import { manifest, READ_ONLY_PERMISSIONS } from './setup.js';
import { isBotLogin, parseSlash } from './slash.js';
import { MemoryStore } from './store.js';
import { signBody, verifySignature } from './webhook-verify.js';

describe('webhook signatures', () => {
  it('accepts only the exact HMAC and rejects malformed headers', () => {
    const sig = signBody('s3', 'body');
    expect(verifySignature('s3', 'body', sig)).toBe(true);
    expect(verifySignature('s3', 'body!', sig)).toBe(false);
    expect(verifySignature('', 'body', sig)).toBe(false);
    expect(verifySignature('s3', 'body', undefined)).toBe(false);
    expect(verifySignature('s3', 'body', 'sha1=abc')).toBe(false);
    expect(verifySignature('s3', 'body', `sha256=${'0'.repeat(64)}`)).toBe(false);
  });
});

describe('delivery dedupe', () => {
  it('claims each id once and stays bounded', async () => {
    const d = new MemoryDeliveryStore(2);
    expect(await d.claim('a')).toBe(true);
    expect(await d.claim('a')).toBe(false);
    await d.claim('b');
    await d.claim('c');
    expect(await d.claim('a')).toBe(true);
  });
});

describe('job queue', () => {
  it('collapses a burst within the debounce window into one run of the latest job', async () => {
    const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
    const q = new MemoryQueue({
      setTimer: (fn, ms) => {
        const t = { fn, ms, cleared: false };
        timers.push(t);
        return t;
      },
      clearTimer: (t) => {
        (t as { cleared: boolean }).cleared = true;
      },
    });
    const ran: number[] = [];
    for (const n of [1, 2, 3]) q.enqueue('pr#1', async () => void ran.push(n), { debounceMs: 30_000 });
    expect(timers.map((t) => [t.ms, t.cleared])).toEqual([
      [30_000, true],
      [30_000, true],
      [30_000, false],
    ]);
    timers[2]?.fn();
    await q.idle();
    expect(ran).toEqual([3]);
  });

  it('cancels a running job when a newer one starts, and reports errors', async () => {
    const cancelled: string[] = [];
    const errors: unknown[] = [];
    const q = new MemoryQueue({ onCancel: (k) => cancelled.push(k), onError: (_k, e) => errors.push(e) });
    let firstSignal: AbortSignal | undefined;
    let release: () => void = () => {};
    q.enqueue('pr#1', (signal) => {
      firstSignal = signal;
      return new Promise<void>((r) => {
        release = r;
      });
    });
    await new Promise((r) => setTimeout(r, 5));
    q.enqueue('pr#1', async () => {
      throw new Error('boom');
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(firstSignal?.aborted).toBe(true);
    expect(cancelled).toEqual(['pr#1']);
    release();
    await q.idle();
    expect(errors.map((e) => (e as Error).message)).toEqual(['boom']);
    await q.idle();
  });

  it('marks a superseded review cancelled at the next step', async () => {
    const repo = fakeRepo('three_reqs_one_missing');
    const controller = new AbortController();
    const gh = repo.gh;
    const original = gh.createCheckRun.bind(gh);
    gh.createCheckRun = async (...args) => {
      const r = await original(...args);
      controller.abort();
      return r;
    };
    const out = await reviewPullRequest(
      gh,
      1,
      repo.pr,
      { providers: repo.providers, store: new MemoryStore() },
      controller.signal,
    );
    expect(out).toEqual({ status: 'cancelled' });
    expect(gh.checkRuns[0]).toMatchObject({ status: 'completed', conclusion: 'cancelled' });
  });

  it('skips drafts when configured and reports failures on the check run', async () => {
    const draft = fakeRepo('three_reqs_one_missing', { config: 'draft_prs: skip\n' });
    const pull = draft.gh.pulls.get('acme/reports#77');
    if (pull) pull.draft = true;
    expect(
      await reviewPullRequest(draft.gh, 1, draft.pr, {
        providers: draft.providers,
        store: new MemoryStore(),
      }),
    ).toEqual({
      status: 'skipped',
      reason: 'draft PR (draft_prs: skip)',
    });
    const broken = fakeRepo('three_reqs_one_missing');
    broken.gh.listPullFiles = async () => {
      throw new Error('socket hang up');
    };
    await expect(
      reviewPullRequest(broken.gh, 1, broken.pr, { providers: broken.providers, store: new MemoryStore() }),
    ).rejects.toThrow('socket');
    expect(broken.gh.checkRuns[0]).toMatchObject({ conclusion: 'neutral' });
    expect(broken.gh.checkRuns[0]?.output?.title).toMatch(/could not finish/);
  });

  it('notes a PR that edits the config file', async () => {
    const repo = fakeRepo('three_reqs_one_missing');
    const pull = repo.gh.pulls.get('acme/reports#77');
    pull?.files.push({
      filename: '.remit.yml',
      status: 'added',
      additions: 1,
      deletions: 0,
      patch: '@@ -0,0 +1 @@\n+mode: gate',
    });
    repo.gh.addContent('acme', 'reports', 'head0000', '.remit.yml', 'mode: gate\n');
    const out = await reviewPullRequest(repo.gh, 1, repo.pr, {
      providers: repo.providers,
      store: new MemoryStore(),
    });
    expect(
      out.status === 'done' &&
        out.record.result.warnings.some((w) => w.includes('applies after it is merged')),
    ).toBe(true);
  });
});

describe('slash parsing', () => {
  it('parses each command and rejects malformed ids', () => {
    expect(parseSlash('/remit review')).toEqual({ name: 'review' });
    expect(parseSlash('thanks\n/remit agree F-R1 F-U2-loosens_test junk')).toEqual({
      name: 'agree',
      ids: ['F-R1', 'F-U2-loosens_test'],
    });
    expect(parseSlash('/remit disagree F-R2 not what the issue meant')).toEqual({
      name: 'disagree',
      ids: ['F-R2'],
      reason: 'not what the issue meant',
    });
    expect(parseSlash('/remit disagree F-R2')).toEqual({ name: 'disagree', ids: ['F-R2'] });
    expect(parseSlash('/remit explain F-R1')).toEqual({ name: 'explain', id: 'F-R1' });
    expect(parseSlash('/remit confirm')).toEqual({ name: 'confirm' });
    expect(parseSlash('/remit')).toEqual({ name: 'help' });
    expect(parseSlash('/remit agree nope')).toMatchObject({ name: 'unknown' });
    expect(parseSlash('/remit explain')).toMatchObject({ name: 'unknown' });
    expect(parseSlash('/remit disagree nope')).toMatchObject({ name: 'unknown' });
    expect(parseSlash('/remit dance')).toMatchObject({ name: 'unknown' });
    expect(parseSlash('/remitx review')).toBeNull();
    expect(parseSlash('no command here')).toBeNull();
    expect(isBotLogin('dependabot[bot]')).toBe(true);
    expect(isBotLogin('someone', 'Bot')).toBe(true);
    expect(isBotLogin('someone', 'User')).toBe(false);
  });
});

describe('sticky comments', () => {
  it('updates only the bot comment carrying the marker, never a human quote of it', async () => {
    const gh = new FakeGitHub().addIssue(
      { owner: 'a', repo: 'r', number: 1 },
      {
        title: 'T',
        body: 'B',
        author: 'u',
        comments: [{ id: 'c1', author: 'human', body: `quoting ${markerOf('rework')}` }],
      },
    );
    const ref = { owner: 'a', repo: 'r', number: 1 };
    const body = withMarker('rework', 'hello');
    expect(await upsertSticky(gh, ref, 'rework', body)).toMatchObject({ created: true });
    expect(await upsertSticky(gh, ref, 'rework', withMarker('rework', 'changed'))).toMatchObject({
      created: false,
    });
    expect(await upsertSticky(gh, ref, 'rework', withMarker('rework', 'changed'))).toMatchObject({
      created: false,
    });
    expect(gh.posted.get('a/r#1')?.map((c) => c.body)).toEqual([withMarker('rework', 'changed')]);
    expect(withMarker('summary', 'x')).toBe('x');
    expect(withMarker('checklist', 'x', 'hash=1')).toBe('<!-- remit:checklist v1 hash=1 -->\nx');
  });
});

describe('setup and secrets', () => {
  it('builds the manifest with the 10.2 permissions and a read-only variant', () => {
    const m = manifest('https://x.example/');
    expect(m.hook_attributes.url).toBe('https://x.example/webhooks');
    expect(m.default_permissions).toMatchObject({ checks: 'write', issues: 'write', contents: 'read' });
    expect(m.default_events).toEqual(['pull_request', 'issues', 'issue_comment', 'check_run']);
    expect(manifest('https://x.example', true).default_permissions).toEqual(READ_ONLY_PERMISSIONS);
  });

  it('encrypts app credentials with AES-256-GCM and detects tampering', async () => {
    const key = ['enc', 'key', 'for', 'tests'].join('-');
    const token = encrypt('secret text', key);
    expect(token).not.toContain('secret text');
    expect(decrypt(token, key)).toBe('secret text');
    expect(() => decrypt(token, 'other')).toThrow();
    expect(() => decrypt('bogus', key)).toThrow(/not an encrypted/);
    const store = new FileSecretStore(join(mkdtempSync(join(tmpdir(), 'remit-sec-')), 'app.enc'), key);
    expect(await store.load()).toBeNull();
    const s = {
      appId: '1',
      slug: 'remit',
      privateKey: 'PEM',
      webhookSecret: 'w',
      clientId: 'c',
      clientSecret: 's',
    };
    await store.save(s);
    expect(await store.load()).toEqual(s);
  });
});
