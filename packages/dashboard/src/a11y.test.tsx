// @vitest-environment jsdom
/**
 * Accessibility checks (BUILD_PROMPT M8, 10.4): WCAG AA contrast for text colors, a visible focus style, status as
 * icon plus word plus color, keyboard navigation through the page, and the labeling queue's shortcuts.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { StatusBadge } from './components.js';
import { Queue } from './pages/Queue.js';
import { colors, contrast, css, STATUS } from './theme.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('contrast', () => {
  it('meets WCAG AA (4.5:1) for every text color on every background', () => {
    const text = [
      colors.text,
      colors.muted,
      colors.accent,
      colors.ok,
      colors.warn,
      colors.bad,
      colors.neutral,
    ];
    for (const bg of [colors.bg, colors.surface])
      for (const fg of text) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    // The focus ring is a non-text indicator: at least 3:1 against the page.
    expect(contrast(colors.focus, colors.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('has a visible focus style', () => {
    expect(css).toMatch(/:focus-visible \{ outline: 3px solid/);
  });

  it('always shows status as an icon, a word and a color', () => {
    for (const s of Object.keys(STATUS) as (keyof typeof STATUS)[]) {
      const { container, unmount } = render(<StatusBadge status={s} />);
      const el = container.querySelector('.status') as HTMLElement;
      expect(el.textContent).toBe(`${STATUS[s].icon}${STATUS[s].word}`);
      expect(el.style.color).not.toBe('');
      expect(el.querySelector('[aria-hidden="true"]')?.textContent).toBe(STATUS[s].icon);
      unmount();
    }
  });
});

function mockApi(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body?: string; csrf?: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      calls.push({
        url,
        method: init.method ?? 'GET',
        ...(init.body ? { body: String(init.body) } : {}),
        csrf: headers.get('x-csrf-token'),
      });
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      if (init.method === 'POST') return new Response(JSON.stringify({ recorded: true }), { status: 201 });
      if (!key) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(routes[key]), { status: 200 });
    }),
  );
  return calls;
}

const item = (id: string) => ({
  reviewId: 'rev1',
  repo: 'acme/reports',
  pr: 77,
  quote: 'Add CSV export',
  finding: {
    id,
    type: 'requirement',
    priority: 'P0',
    confidence: 0.9,
    locations: [{ file: 'src/a.ts', lines: [1, 2] }],
    reasons: ['No implementation found.'],
  },
});

describe('keyboard navigation', () => {
  beforeEach(() => {
    window.location.hash = '#/reviews';
  });

  it('reaches the navigation and filters with Tab, in order', async () => {
    mockApi({ '/api/me': { login: 'maya', csrf: 'tok' }, '/api/dead-letters': [], '/api/reviews': [] });
    render(<App />);
    await screen.findByText('No reviews match these filters.');
    const user = userEvent.setup();
    const order: string[] = [];
    for (let i = 0; i < 8; i++) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      order.push(el.getAttribute('href') ?? el.closest('label')?.firstChild?.textContent ?? el.tagName);
    }
    expect(order).toEqual([
      '#/reviews',
      '#/queue',
      '#/metrics',
      '#/settings',
      'Repository',
      'Status',
      'Has P0',
      'Since',
    ]);
  });

  it('labels findings with a, d and s, toggles help with ? and Escape, and ignores keys while typing', async () => {
    const calls = mockApi({ '/api/queue': [item('F-R1'), item('F-R2'), item('F-R3'), item('F-R4')] });
    const { setCsrf } = await import('./api.js');
    setCsrf('tok');
    render(
      <>
        <input aria-label="Notes" />
        <Queue />
      </>,
    );
    await screen.findByLabelText('Finding F-R1');
    const user = userEvent.setup();
    await user.keyboard('a');
    await screen.findByLabelText('Finding F-R2');
    await user.keyboard('d');
    await screen.findByLabelText('Finding F-R3');
    await user.keyboard('s');
    await screen.findByLabelText('Finding F-R4');
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((p) => [p.url, JSON.parse(p.body ?? '{}').label, p.csrf])).toEqual([
      ['/api/reviews/rev1/findings/F-R1/feedback', 'agree', 'tok'],
      ['/api/reviews/rev1/findings/F-R2/feedback', 'disagree', 'tok'],
    ]);
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    // Typing in a field never labels a finding.
    await user.click(screen.getByLabelText('Notes'));
    await user.keyboard('a');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toBe('Skipped.');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Agree (a)' }));
    });
    await waitFor(() => expect(screen.getByText('Nothing left to label. Thank you.')).toBeTruthy());
  });

  it('announces a label that could not be saved and keeps the finding', async () => {
    mockApi({ '/api/queue': [item('F-R1')] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit = {}) =>
        init.method === 'POST'
          ? new Response('{}', { status: 500 })
          : new Response(JSON.stringify([item('F-R1')])),
      ),
    );
    render(<Queue />);
    await screen.findByLabelText('Finding F-R1');
    await userEvent.setup().keyboard('a');
    expect(await screen.findByText('Could not save the label for F-R1. Try again.')).toBeTruthy();
    expect(screen.getByLabelText('Finding F-R1')).toBeTruthy();
  });

  it('asks to sign in when there is no session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    render(<App />);
    expect((await screen.findByText('Sign in with GitHub')).getAttribute('href')).toBe('/auth/login');
  });
});
