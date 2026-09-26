import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ms, usd } from '../components.js';
import { colors } from '../theme.js';
function Reliability({ name, bins }) {
  const size = 140;
  return _jsxs('figure', {
    style: { margin: 0 },
    children: [
      _jsxs('svg', {
        width: size,
        height: size,
        role: 'img',
        'aria-label': `Reliability diagram for ${name}`,
        children: [
          _jsx('rect', {
            x: 0,
            y: 0,
            width: size,
            height: size,
            fill: colors.surface,
            stroke: colors.border,
          }),
          _jsx('line', { x1: 0, y1: size, x2: size, y2: 0, stroke: colors.border }),
          bins
            .filter((b) => b.n > 0)
            .map((b) =>
              _jsx(
                'circle',
                { cx: b.meanP * size, cy: size - b.accuracy * size, r: 3, fill: colors.accent },
                b.lo,
              ),
            ),
        ],
      }),
      _jsx('figcaption', { className: 'muted', children: name }),
    ],
  });
}
export function Metrics({ deadLetters }) {
  const [m, setM] = useState(null);
  useEffect(() => {
    api('/api/metrics').then(setM, () => setM(null));
  }, []);
  if (!m) return _jsx('p', { className: 'muted', children: 'Loading metrics\u2026' });
  const latest = m.evalRuns[0];
  const types = [...new Set(m.agreement.map((a) => a.type))];
  const count = (type, label) => m.agreement.find((a) => a.type === type && a.label === label)?.n ?? 0;
  return _jsxs('section', {
    'aria-labelledby': 'metrics-title',
    children: [
      _jsx('h1', { id: 'metrics-title', children: 'Metrics' }),
      _jsxs('h2', { children: ['Cost and latency (last 30 days, ', m.reviews, ' reviews)'] }),
      _jsxs('p', {
        className: 'num',
        children: [
          'Cost p50 ',
          usd(m.cost.p50),
          ' \u00B7 p95 ',
          usd(m.cost.p95),
          ' \u00B7 latency p50 ',
          ms(m.latency.p50),
          ' \u00B7 p95',
          ' ',
          ms(m.latency.p95),
        ],
      }),
      _jsx('h2', { children: 'Eval runs' }),
      m.evalRuns.length
        ? _jsxs('table', {
            children: [
              _jsx('thead', {
                children: _jsxs('tr', {
                  children: [
                    _jsx('th', { scope: 'col', children: 'Run' }),
                    _jsx('th', { scope: 'col', children: 'Corpus' }),
                    _jsx('th', { scope: 'col', children: 'PR recall' }),
                    _jsx('th', { scope: 'col', children: 'When' }),
                  ],
                }),
              }),
              _jsx('tbody', {
                children: m.evalRuns.map((r) =>
                  _jsxs(
                    'tr',
                    {
                      children: [
                        _jsx('td', { className: 'num', children: r.id }),
                        _jsxs('td', { children: [r.corpus, '/', r.split] }),
                        _jsx('td', { className: 'num', children: r.metrics.pr?.recall?.toFixed(2) ?? 'n/a' }),
                        _jsx('td', {
                          className: 'num',
                          children: new Date(r.createdAt).toISOString().slice(0, 10),
                        }),
                      ],
                    },
                    r.id,
                  ),
                ),
              }),
            ],
          })
        : _jsx('p', { className: 'muted', children: 'No eval runs are stored yet.' }),
      latest?.metrics.calibration
        ? _jsxs(_Fragment, {
            children: [
              _jsxs('h2', { children: ['Reliability (', latest.id, ')'] }),
              _jsx('div', {
                style: { display: 'flex', gap: '1rem', flexWrap: 'wrap' },
                children: Object.entries(latest.metrics.calibration).map(([k, v]) =>
                  _jsx(Reliability, { name: k, bins: v.bins ?? [] }, k),
                ),
              }),
            ],
          })
        : null,
      _jsx('h2', { children: 'Feedback agreement by finding type' }),
      types.length
        ? _jsxs('table', {
            children: [
              _jsx('thead', {
                children: _jsxs('tr', {
                  children: [
                    _jsx('th', { scope: 'col', children: 'Type' }),
                    _jsx('th', { scope: 'col', children: 'Agree' }),
                    _jsx('th', { scope: 'col', children: 'Disagree' }),
                    _jsx('th', { scope: 'col', children: 'Weak agree' }),
                  ],
                }),
              }),
              _jsx('tbody', {
                children: types.map((t) =>
                  _jsxs(
                    'tr',
                    {
                      children: [
                        _jsx('td', { children: t.replace('_', ' ') }),
                        _jsx('td', { className: 'num', children: count(t, 'agree') }),
                        _jsx('td', { className: 'num', children: count(t, 'disagree') }),
                        _jsx('td', { className: 'num', children: count(t, 'weak_agree') }),
                      ],
                    },
                    t,
                  ),
                ),
              }),
            ],
          })
        : _jsx('p', { className: 'muted', children: 'No feedback yet.' }),
      _jsx('h2', { children: 'Dead-letter jobs' }),
      deadLetters.length
        ? _jsx('ul', {
            children: deadLetters.map((d) =>
              _jsxs(
                'li',
                { children: [_jsx('span', { className: 'num', children: d.id }), ' ', d.kind, ' ', d.key] },
                d.id,
              ),
            ),
          })
        : _jsx('p', { className: 'muted', children: 'No failed jobs.' }),
    ],
  });
}
//# sourceMappingURL=Metrics.js.map
