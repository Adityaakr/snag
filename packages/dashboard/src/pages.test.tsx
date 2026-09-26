// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Metrics } from './pages/Metrics.js';
import { ReviewDetail } from './pages/ReviewDetail.js';
import { Reviews } from './pages/Reviews.js';
import { Settings } from './pages/Settings.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(routes: Record<string, unknown>) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      return key ? new Response(JSON.stringify(routes[key])) : new Response('{}', { status: 404 });
    }),
  );
  return urls;
}

describe('Reviews page', () => {
  it('lists reviews with cost and latency and sends filters as query parameters', async () => {
    const urls = serve({
      '/api/reviews': [
        {
          id: 'rev1',
          repo: 'acme/reports',
          prNumber: 77,
          headSha: 'h',
          status: 'done',
          mode: 'comment_only',
          hasP0: true,
          costUsd: 0.0123,
          latencyMs: 4200,
          createdAt: '2026-09-27T10:00:00Z',
        },
      ],
    });
    render(<Reviews />);
    expect((await screen.findByText('acme/reports#77')).getAttribute('href')).toBe('#/reviews/rev1');
    expect(screen.getByText('Needs work')).toBeTruthy();
    expect(screen.getByText('$0.0123')).toBeTruthy();
    expect(screen.getByText('4.2 s')).toBeTruthy();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Has P0'), 'true');
    await user.type(screen.getByLabelText('Repository'), 'acme/reports');
    await waitFor(() => expect(urls.at(-1)).toBe('/api/reviews?repo=acme%2Freports&hasP0=true'));
  });
});

describe('Review detail page', () => {
  it('shows requirements with evidence links, units with roles and facts, raw answers and warnings', async () => {
    serve({
      '/api/reviews/rev1': {
        id: 'rev1',
        repo: 'acme/reports',
        pr: 77,
        headSha: 'abcdef1234',
        feedback: [],
        result: {
          usage: { costUsd: 0.01, latencyMs: 900 },
          versions: { questionSet: 'qs-0.1.0', jevModel: 'jev-1.13.0' },
          requirements: [{ id: 'R1', quote: 'Export as CSV' }],
          requirementVerdicts: [
            {
              requirementId: 'R1',
              status: 'missing',
              evidence: [{ unitId: 'U1', file: 'src/a.ts', lines: [[3, 5]] }],
              answers: [{ call: 'forward.v0', question: 'coverage', value: 0.1 }],
            },
          ],
          units: [
            {
              id: 'U1',
              file: 'src/a.ts',
              symbol: { name: 'exportCsv' },
              facts: [{ kind: 'test_skipped', severity: 'high' }],
            },
          ],
          unitVerdicts: [{ unitId: 'U1', role: 'unexplained_behavioral' }],
          warnings: ['TYPESAFE_API_KEY is not set.'],
        },
      },
    });
    render(<ReviewDetail id="rev1" />);
    expect((await screen.findByText('src/a.ts:3-5')).getAttribute('href')).toBe(
      'https://github.com/acme/reports/blob/abcdef1234/src/a.ts#L3-L5',
    );
    expect(screen.getByText('Export as CSV')).toBeTruthy();
    expect(screen.getByText('unexplained behavioral')).toBeTruthy();
    expect(screen.getByText('test_skipped (high)')).toBeTruthy();
    expect(screen.getByText('TYPESAFE_API_KEY is not set.')).toBeTruthy();
    expect(screen.getByText(/uncalibrated/)).toBeTruthy();
  });

  it('reports a review the user cannot see', async () => {
    serve({});
    render(<ReviewDetail id="nope" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/not found/);
  });
});

describe('Metrics and settings pages', () => {
  it('shows eval runs, reliability diagrams, agreement, percentiles and dead letters', async () => {
    serve({
      '/api/metrics': {
        evalRuns: [
          {
            id: 'run1',
            corpus: 'mutations',
            split: 'dev',
            createdAt: '2026-09-26T00:00:00Z',
            metrics: {
              pr: { recall: 0.85 },
              calibration: {
                'forward.conflict': { bins: [{ lo: 0, hi: 0.1, n: 5, meanP: 0.05, accuracy: 0.1 }] },
              },
            },
          },
        ],
        agreement: [
          { type: 'requirement', label: 'agree', n: 3 },
          { type: 'requirement', label: 'weak_agree', n: 1 },
        ],
        cost: { p50: 0.02, p95: 0.05 },
        latency: { p50: 1200, p95: 30000 },
        reviews: 4,
      },
    });
    render(<Metrics deadLetters={[{ id: 'j1', key: 'review:a/b#1', kind: 'review' }]} />);
    expect(await screen.findByRole('img', { name: 'Reliability diagram for forward.conflict' })).toBeTruthy();
    expect(screen.getByText('0.85')).toBeTruthy();
    expect(screen.getByText(/Cost p50 \$0\.0200/)).toBeTruthy();
    expect(screen.getByText('review:a/b#1', { exact: false })).toBeTruthy();
  });

  it('shows installations, repositories and the read-only defaults', async () => {
    serve({
      '/api/settings': {
        installations: [{ id: 4242, account: 'acme' }],
        repositories: [{ fullName: 'acme/reports', installationId: 4242, configHash: null }],
        defaults: { mode: 'comment_only' },
      },
    });
    render(<Settings />);
    expect(await screen.findByText('acme/reports')).toBeTruthy();
    expect(screen.getByText(/"mode": "comment_only"/)).toBeTruthy();
  });
});
