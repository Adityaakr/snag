import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
import { colors, STATUS } from './theme.js';
export function StatusBadge({ status }) {
  const s = STATUS[status];
  return _jsxs('span', {
    className: 'status',
    style: { color: colors[s.color] },
    children: [_jsx('span', { 'aria-hidden': 'true', children: s.icon }), s.word],
  });
}
export const usd = (n) => `$${n.toFixed(4)}`;
export const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
//# sourceMappingURL=components.js.map
