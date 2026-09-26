import { useEffect, useState } from 'react';
import { ApiError, api, setCsrf } from './api.js';
import { Metrics } from './pages/Metrics.js';
import { Queue } from './pages/Queue.js';
import { ReviewDetail } from './pages/ReviewDetail.js';
import { Reviews } from './pages/Reviews.js';
import { Settings } from './pages/Settings.js';
import { css } from './theme.js';

const PAGES = [
  ['#/reviews', 'Reviews'],
  ['#/queue', 'Labeling queue'],
  ['#/metrics', 'Metrics'],
  ['#/settings', 'Settings'],
] as const;

export function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash || '#/reviews');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/reviews');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const [me, setMe] = useState<{ login: string } | null | 'signed-out'>(null);
  const [dead, setDead] = useState<{ id: string; key: string; kind: string }[]>([]);
  useEffect(() => {
    api<{ login: string; csrf: string }>('/api/me').then(
      (m) => {
        setCsrf(m.csrf);
        setMe(m);
        api<typeof dead>('/api/dead-letters').then(setDead, () => {});
      },
      (e) => setMe(e instanceof ApiError && e.status === 401 ? 'signed-out' : 'signed-out'),
    );
  }, []);
  const detail = /^#\/reviews\/(.+)$/.exec(hash);
  return (
    <>
      <style>{css}</style>
      <header>
        <strong>Remit</strong>
        <nav aria-label="Main">
          {PAGES.map(([href, label]) => (
            <a key={href} href={href} aria-current={hash.startsWith(href) ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <span style={{ marginLeft: 'auto' }} className="muted">
          {me && me !== 'signed-out' ? me.login : null}
        </span>
      </header>
      <main>
        {me === null ? (
          <p className="muted">Loading…</p>
        ) : me === 'signed-out' ? (
          <p>
            <a href="/auth/login">Sign in with GitHub</a> to see reviews for your installations.
          </p>
        ) : detail ? (
          <ReviewDetail id={decodeURIComponent(detail[1] as string)} />
        ) : hash.startsWith('#/queue') ? (
          <Queue />
        ) : hash.startsWith('#/metrics') ? (
          <Metrics deadLetters={dead} />
        ) : hash.startsWith('#/settings') ? (
          <Settings />
        ) : (
          <Reviews />
        )}
      </main>
    </>
  );
}
