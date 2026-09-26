import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
export function Settings() {
  const [s, setS] = useState(null);
  useEffect(() => {
    api('/api/settings').then(setS, () => setS(null));
  }, []);
  if (!s) return _jsx('p', { className: 'muted', children: 'Loading settings\u2026' });
  return _jsxs('section', {
    'aria-labelledby': 'settings-title',
    children: [
      _jsx('h1', { id: 'settings-title', children: 'Settings' }),
      _jsx('h2', { children: 'Installations' }),
      _jsx('ul', {
        children: s.installations.map((i) =>
          _jsxs(
            'li',
            {
              children: [
                i.account,
                ' ',
                _jsxs('span', { className: 'muted num', children: ['(', i.id, ')'] }),
              ],
            },
            i.id,
          ),
        ),
      }),
      _jsx('h2', { children: 'Repositories' }),
      _jsx('ul', {
        children: s.repositories.map((r) =>
          _jsxs(
            'li',
            {
              children: [
                r.fullName,
                ' ',
                _jsxs('span', {
                  className: 'muted',
                  children: ['config ', r.configHash ? r.configHash.slice(0, 8) : 'default'],
                }),
              ],
            },
            r.fullName,
          ),
        ),
      }),
      _jsx('h2', { children: 'Effective defaults (read-only)' }),
      _jsx('p', {
        className: 'muted',
        children: 'Each repository overrides these in .remit.yml on its default branch.',
      }),
      _jsx('pre', { children: JSON.stringify(s.defaults, null, 2) }),
    ],
  });
}
//# sourceMappingURL=Settings.js.map
