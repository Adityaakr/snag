import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from 'react/jsx-runtime';
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
];
export function useHash() {
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
  const [me, setMe] = useState(null);
  const [dead, setDead] = useState([]);
  useEffect(() => {
    api('/api/me').then(
      (m) => {
        setCsrf(m.csrf);
        setMe(m);
        api('/api/dead-letters').then(setDead, () => {});
      },
      (e) => setMe(e instanceof ApiError && e.status === 401 ? 'signed-out' : 'signed-out'),
    );
  }, []);
  const detail = /^#\/reviews\/(.+)$/.exec(hash);
  return _jsxs(_Fragment, {
    children: [
      _jsx('style', { children: css }),
      _jsxs('header', {
        children: [
          _jsx('strong', { children: 'Remit' }),
          _jsx('nav', {
            'aria-label': 'Main',
            children: PAGES.map(([href, label]) =>
              _jsx(
                'a',
                { href: href, 'aria-current': hash.startsWith(href) ? 'page' : undefined, children: label },
                href,
              ),
            ),
          }),
          _jsx('span', {
            style: { marginLeft: 'auto' },
            className: 'muted',
            children: me && me !== 'signed-out' ? me.login : null,
          }),
        ],
      }),
      _jsx('main', {
        children:
          me === null
            ? _jsx('p', { className: 'muted', children: 'Loading\u2026' })
            : me === 'signed-out'
              ? _jsxs('p', {
                  children: [
                    _jsx('a', { href: '/auth/login', children: 'Sign in with GitHub' }),
                    ' to see reviews for your installations.',
                  ],
                })
              : detail
                ? _jsx(ReviewDetail, { id: decodeURIComponent(detail[1]) })
                : hash.startsWith('#/queue')
                  ? _jsx(Queue, {})
                  : hash.startsWith('#/metrics')
                    ? _jsx(Metrics, { deadLetters: dead })
                    : hash.startsWith('#/settings')
                      ? _jsx(Settings, {})
                      : _jsx(Reviews, {}),
      }),
    ],
  });
}
//# sourceMappingURL=App.js.map
