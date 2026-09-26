import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ms, StatusBadge, usd } from '../components.js';
const statusOf = (s) =>
  s === 'done' || s === 'preexisting' || s === 'deferred'
    ? 'done'
    : s === 'uncertain' || s === 'not_checkable'
      ? 'uncertain'
      : 'problem';
export function ReviewDetail({ id }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/api/reviews/${encodeURIComponent(id)}`).then(setD, () =>
      setError('This review was not found or you cannot see it.'),
    );
  }, [id]);
  if (error) return _jsx('p', { role: 'alert', children: error });
  if (!d) return _jsx('p', { className: 'muted', children: 'Loading review\u2026' });
  const r = d.result;
  const blob = (file, lines) =>
    `https://github.com/${d.repo}/blob/${d.headSha}/${file}#L${lines[0]}-L${lines[1]}`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${d.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return _jsxs('article', {
    'aria-labelledby': 'detail-title',
    children: [
      _jsxs('h1', { id: 'detail-title', children: [d.repo, '#', d.pr] }),
      _jsxs('p', {
        className: 'muted',
        children: [
          'Head ',
          _jsx('span', { className: 'num', children: d.headSha.slice(0, 7) }),
          ' \u00B7 cost',
          ' ',
          _jsx('span', { className: 'num', children: usd(r.usage.costUsd) }),
          ' \u00B7 latency',
          ' ',
          _jsx('span', { className: 'num', children: ms(r.usage.latencyMs) }),
          ' \u00B7 questions ',
          r.versions.questionSet,
          ' \u00B7 Jev',
          ' ',
          r.versions.jevModel,
          r.versions.calibration ? ` · calibration ${r.versions.calibration}` : ' · uncalibrated',
          ' · ',
          _jsx('button', { type: 'button', onClick: download, children: 'Download JSON' }),
        ],
      }),
      _jsx('h2', { children: 'Requirements' }),
      _jsxs('table', {
        children: [
          _jsx('thead', {
            children: _jsxs('tr', {
              children: [
                _jsx('th', { scope: 'col', children: 'Id' }),
                _jsx('th', { scope: 'col', children: 'Status' }),
                _jsx('th', { scope: 'col', children: 'Quote' }),
                _jsx('th', { scope: 'col', children: 'Evidence' }),
              ],
            }),
          }),
          _jsx('tbody', {
            children: r.requirementVerdicts.map((v) => {
              const q = r.requirements.find((x) => x.id === v.requirementId);
              return _jsxs(
                'tr',
                {
                  children: [
                    _jsx('td', { className: 'num', children: v.requirementId }),
                    _jsxs('td', {
                      children: [
                        _jsx(StatusBadge, { status: statusOf(v.status) }),
                        ' ',
                        _jsx('span', { className: 'muted', children: v.status.replace('_', ' ') }),
                      ],
                    }),
                    _jsx('td', { children: q?.quote }),
                    _jsx('td', {
                      children: v.evidence.map((e) =>
                        e.lines.map((l) =>
                          _jsx(
                            'div',
                            {
                              children: _jsxs('a', {
                                href: blob(e.file, l),
                                children: [e.file, ':', l[0], '-', l[1]],
                              }),
                            },
                            `${e.unitId}-${l[0]}`,
                          ),
                        ),
                      ),
                    }),
                  ],
                },
                v.requirementId,
              );
            }),
          }),
        ],
      }),
      _jsx('h2', { children: 'Units' }),
      _jsxs('table', {
        children: [
          _jsx('thead', {
            children: _jsxs('tr', {
              children: [
                _jsx('th', { scope: 'col', children: 'Unit' }),
                _jsx('th', { scope: 'col', children: 'Role' }),
                _jsx('th', { scope: 'col', children: 'Facts' }),
              ],
            }),
          }),
          _jsx('tbody', {
            children: r.units.map((u) =>
              _jsxs(
                'tr',
                {
                  children: [
                    _jsxs('td', {
                      children: [
                        _jsx('span', { className: 'num', children: u.id }),
                        ' ',
                        u.file,
                        u.symbol ? ` (${u.symbol.name})` : '',
                      ],
                    }),
                    _jsx('td', {
                      children:
                        r.unitVerdicts.find((v) => v.unitId === u.id)?.role.replace('_', ' ') ??
                        'not reviewed',
                    }),
                    _jsx('td', {
                      children:
                        u.facts.map((f) => `${f.kind} (${f.severity})`).join(', ') ||
                        _jsx('span', { className: 'muted', children: 'none' }),
                    }),
                  ],
                },
                u.id,
              ),
            ),
          }),
        ],
      }),
      _jsx('h2', { children: 'Raw answers' }),
      r.requirementVerdicts.map((v) =>
        _jsxs(
          'details',
          {
            children: [
              _jsx('summary', { children: v.requirementId }),
              _jsx('pre', { children: JSON.stringify(v.answers, null, 2) }),
            ],
          },
          v.requirementId,
        ),
      ),
      r.warnings.length
        ? _jsxs(_Fragment, {
            children: [
              _jsx('h2', { children: 'Warnings' }),
              _jsx('ul', { children: r.warnings.map((w) => _jsx('li', { children: w }, w)) }),
            ],
          })
        : null,
    ],
  });
}
//# sourceMappingURL=ReviewDetail.js.map
