import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ms, StatusBadge, usd } from '../components.js';
export function Reviews() {
  const [rows, setRows] = useState(null);
  const [repo, setRepo] = useState('');
  const [status, setStatus] = useState('');
  const [p0, setP0] = useState('');
  const [since, setSince] = useState('');
  useEffect(() => {
    const q = new URLSearchParams();
    if (repo) q.set('repo', repo);
    if (status) q.set('status', status);
    if (p0) q.set('hasP0', p0);
    if (since) q.set('since', since);
    api(`/api/reviews?${q}`).then(setRows, () => setRows([]));
  }, [repo, status, p0, since]);
  return _jsxs('section', {
    'aria-labelledby': 'reviews-title',
    children: [
      _jsx('h1', { id: 'reviews-title', children: 'Reviews' }),
      _jsxs('div', {
        className: 'filters',
        children: [
          _jsxs('label', {
            children: [
              'Repository',
              _jsx('input', {
                value: repo,
                onChange: (e) => setRepo(e.target.value),
                placeholder: 'owner/repo',
              }),
            ],
          }),
          _jsxs('label', {
            children: [
              'Status',
              _jsxs('select', {
                value: status,
                onChange: (e) => setStatus(e.target.value),
                children: [
                  _jsx('option', { value: '', children: 'Any' }),
                  _jsx('option', { value: 'done', children: 'Done' }),
                  _jsx('option', { value: 'failed', children: 'Failed' }),
                ],
              }),
            ],
          }),
          _jsxs('label', {
            children: [
              'Has P0',
              _jsxs('select', {
                value: p0,
                onChange: (e) => setP0(e.target.value),
                children: [
                  _jsx('option', { value: '', children: 'Any' }),
                  _jsx('option', { value: 'true', children: 'Yes' }),
                  _jsx('option', { value: 'false', children: 'No' }),
                ],
              }),
            ],
          }),
          _jsxs('label', {
            children: [
              'Since',
              _jsx('input', { type: 'date', value: since, onChange: (e) => setSince(e.target.value) }),
            ],
          }),
        ],
      }),
      rows === null
        ? _jsx('p', { className: 'muted', children: 'Loading reviews\u2026' })
        : rows.length === 0
          ? _jsx('p', { className: 'muted', children: 'No reviews match these filters.' })
          : _jsxs('table', {
              children: [
                _jsx('thead', {
                  children: _jsxs('tr', {
                    children: [
                      _jsx('th', { scope: 'col', children: 'Pull request' }),
                      _jsx('th', { scope: 'col', children: 'Result' }),
                      _jsx('th', { scope: 'col', children: 'Mode' }),
                      _jsx('th', { scope: 'col', children: 'Cost' }),
                      _jsx('th', { scope: 'col', children: 'Latency' }),
                      _jsx('th', { scope: 'col', children: 'When' }),
                    ],
                  }),
                }),
                _jsx('tbody', {
                  children: rows.map((r) =>
                    _jsxs(
                      'tr',
                      {
                        children: [
                          _jsx('td', {
                            children: _jsxs('a', {
                              href: `#/reviews/${encodeURIComponent(r.id)}`,
                              children: [r.repo, '#', r.prNumber],
                            }),
                          }),
                          _jsx('td', {
                            children:
                              r.status === 'done'
                                ? _jsx(StatusBadge, { status: r.hasP0 ? 'problem' : 'done' })
                                : _jsx(StatusBadge, { status: 'failed' }),
                          }),
                          _jsx('td', { children: r.mode.replace('_', ' ') }),
                          _jsx('td', { className: 'num', children: usd(r.costUsd) }),
                          _jsx('td', { className: 'num', children: ms(r.latencyMs) }),
                          _jsx('td', {
                            className: 'num',
                            children: new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' '),
                          }),
                        ],
                      },
                      r.id,
                    ),
                  ),
                }),
              ],
            }),
    ],
  });
}
//# sourceMappingURL=Reviews.js.map
