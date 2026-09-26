import { colors, STATUS, type Status } from './theme.js';

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className="status" style={{ color: colors[s.color] }}>
      <span aria-hidden="true">{s.icon}</span>
      {s.word}
    </span>
  );
}

export const usd = (n: number) => `$${n.toFixed(4)}`;
export const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
