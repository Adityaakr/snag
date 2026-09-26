import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ms, usd } from '../components.js';
import { colors } from '../theme.js';

interface Bin {
  lo: number;
  hi: number;
  n: number;
  meanP: number;
  accuracy: number;
}
interface MetricsResponse {
  evalRuns: {
    id: string;
    corpus: string;
    split: string;
    createdAt: string;
    metrics: { pr?: { recall?: number }; calibration?: Record<string, { bins?: Bin[] }> };
  }[];
  agreement: { type: string; label: string; n: number }[];
  cost: { p50: number; p95: number };
  latency: { p50: number; p95: number };
  reviews: number;
}

function Reliability({ name, bins }: { name: string; bins: Bin[] }) {
  const size = 140;
  return (
    <figure style={{ margin: 0 }}>
      <svg width={size} height={size} role="img" aria-label={`Reliability diagram for ${name}`}>
        <rect x={0} y={0} width={size} height={size} fill={colors.surface} stroke={colors.border} />
        <line x1={0} y1={size} x2={size} y2={0} stroke={colors.border} />
        {bins
          .filter((b) => b.n > 0)
          .map((b) => (
            <circle key={b.lo} cx={b.meanP * size} cy={size - b.accuracy * size} r={3} fill={colors.accent} />
          ))}
      </svg>
      <figcaption className="muted">{name}</figcaption>
    </figure>
  );
}

export function Metrics({ deadLetters }: { deadLetters: { id: string; key: string; kind: string }[] }) {
  const [m, setM] = useState<MetricsResponse | null>(null);
  useEffect(() => {
    api<MetricsResponse>('/api/metrics').then(setM, () => setM(null));
  }, []);
  if (!m) return <p className="muted">Loading metrics…</p>;
  const latest = m.evalRuns[0];
  const types = [...new Set(m.agreement.map((a) => a.type))];
  const count = (type: string, label: string) =>
    m.agreement.find((a) => a.type === type && a.label === label)?.n ?? 0;
  return (
    <section aria-labelledby="metrics-title">
      <h1 id="metrics-title">Metrics</h1>
      <h2>Cost and latency (last 30 days, {m.reviews} reviews)</h2>
      <p className="num">
        Cost p50 {usd(m.cost.p50)} · p95 {usd(m.cost.p95)} · latency p50 {ms(m.latency.p50)} · p95{' '}
        {ms(m.latency.p95)}
      </p>
      <h2>Eval runs</h2>
      {m.evalRuns.length ? (
        <table>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Corpus</th>
              <th scope="col">PR recall</th>
              <th scope="col">When</th>
            </tr>
          </thead>
          <tbody>
            {m.evalRuns.map((r) => (
              <tr key={r.id}>
                <td className="num">{r.id}</td>
                <td>
                  {r.corpus}/{r.split}
                </td>
                <td className="num">{r.metrics.pr?.recall?.toFixed(2) ?? 'n/a'}</td>
                <td className="num">{new Date(r.createdAt).toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No eval runs are stored yet.</p>
      )}
      {latest?.metrics.calibration ? (
        <>
          <h2>Reliability ({latest.id})</h2>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {Object.entries(latest.metrics.calibration).map(([k, v]) => (
              <Reliability key={k} name={k} bins={v.bins ?? []} />
            ))}
          </div>
        </>
      ) : null}
      <h2>Feedback agreement by finding type</h2>
      {types.length ? (
        <table>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Agree</th>
              <th scope="col">Disagree</th>
              <th scope="col">Weak agree</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t}>
                <td>{t.replace('_', ' ')}</td>
                <td className="num">{count(t, 'agree')}</td>
                <td className="num">{count(t, 'disagree')}</td>
                <td className="num">{count(t, 'weak_agree')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No feedback yet.</p>
      )}
      <h2>Dead-letter jobs</h2>
      {deadLetters.length ? (
        <ul>
          {deadLetters.map((d) => (
            <li key={d.id}>
              <span className="num">{d.id}</span> {d.kind} {d.key}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No failed jobs.</p>
      )}
    </section>
  );
}
