import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
/** The labeling queue: `a` agree, `d` disagree, `s` skip, `?` help. Keys are ignored while typing in a field. */
export function Queue() {
  const [items, setItems] = useState(null);
  const [index, setIndex] = useState(0);
  const [help, setHelp] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    api('/api/queue').then(setItems, () => setItems([]));
  }, []);
  const item = items?.[index];
  const label = useCallback(
    async (l) => {
      if (!item) return;
      await api(
        `/api/reviews/${encodeURIComponent(item.reviewId)}/findings/${encodeURIComponent(item.finding.id)}/feedback`,
        {
          method: 'POST',
          body: { label: l },
        },
      );
      setMessage(`Recorded ${l} for ${item.finding.id}.`);
      setIndex((i) => i + 1);
    },
    [item],
  );
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'a') void label('agree');
      else if (e.key === 'd') void label('disagree');
      else if (e.key === 's') {
        setMessage('Skipped.');
        setIndex((i) => i + 1);
      } else if (e.key === '?') setHelp((h) => !h);
      else if (e.key === 'Escape') setHelp(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [label]);
  return _jsxs('section', {
    'aria-labelledby': 'queue-title',
    children: [
      _jsx('h1', { id: 'queue-title', children: 'Labeling queue' }),
      _jsxs('p', {
        className: 'muted',
        children: [
          'Keys: ',
          _jsx('kbd', { children: 'a' }),
          ' agree, ',
          _jsx('kbd', { children: 'd' }),
          ' disagree, ',
          _jsx('kbd', { children: 's' }),
          ' skip, ',
          _jsx('kbd', { children: '?' }),
          ' help.',
        ],
      }),
      _jsx('p', { role: 'status', 'aria-live': 'polite', children: message }),
      help
        ? _jsx('div', {
            role: 'dialog',
            'aria-label': 'Keyboard shortcuts',
            className: 'card',
            children: _jsx('p', {
              children:
                'Press a to agree that the finding is right, d to disagree, s to skip it, and ? or Escape to close this help.',
            }),
          })
        : null,
      items === null
        ? _jsx('p', { className: 'muted', children: 'Loading findings\u2026' })
        : !item
          ? _jsx('p', { children: 'Nothing left to label. Thank you.' })
          : _jsxs('article', {
              className: 'card',
              'aria-label': `Finding ${item.finding.id}`,
              children: [
                _jsxs('h2', {
                  children: [
                    item.finding.id,
                    ' ',
                    _jsxs('span', {
                      className: 'muted',
                      children: ['(', item.finding.priority, ', ', item.finding.type, ')'],
                    }),
                  ],
                }),
                _jsxs('p', {
                  className: 'muted',
                  children: [
                    item.repo,
                    '#',
                    item.pr,
                    ' \u00B7 confidence',
                    ' ',
                    _jsx('span', { className: 'num', children: item.finding.confidence.toFixed(2) }),
                  ],
                }),
                item.quote ? _jsx('blockquote', { children: item.quote }) : null,
                _jsx('ul', { children: item.finding.reasons.map((r) => _jsx('li', { children: r }, r)) }),
                item.finding.locations.map((l) =>
                  _jsxs(
                    'p',
                    { className: 'num', children: [l.file, ':', l.lines[0], '-', l.lines[1]] },
                    `${l.file}${l.lines[0]}`,
                  ),
                ),
                _jsxs('div', {
                  style: { display: 'flex', gap: '.5rem' },
                  children: [
                    _jsx('button', {
                      type: 'button',
                      onClick: () => void label('agree'),
                      children: 'Agree (a)',
                    }),
                    _jsx('button', {
                      type: 'button',
                      onClick: () => void label('disagree'),
                      children: 'Disagree (d)',
                    }),
                    _jsx('button', {
                      type: 'button',
                      onClick: () => setIndex((i) => i + 1),
                      children: 'Skip (s)',
                    }),
                  ],
                }),
              ],
            }),
    ],
  });
}
//# sourceMappingURL=Queue.js.map
