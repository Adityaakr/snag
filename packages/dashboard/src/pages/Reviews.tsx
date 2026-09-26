import { useEffect, useState } from 'react';
import { api, type ReviewRow } from '../api.js';
import { ms, StatusBadge, usd } from '../components.js';

export function Reviews() {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
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
    api<ReviewRow[]>(`/api/reviews?${q}`).then(setRows, () => setRows([]));
  }, [repo, status, p0, since]);
  return (
    <section aria-labelledby="reviews-title">
      <h1 id="reviews-title">Reviews</h1>
      <div className="filters">
        <label>
          Repository
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option>
            <option value="done">Done</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label>
          Has P0
          <select value={p0} onChange={(e) => setP0(e.target.value)}>
            <option value="">Any</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <label>
          Since
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
      </div>
      {rows === null ? (
        <p className="muted">Loading reviews…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No reviews match these filters.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Pull request</th>
              <th scope="col">Result</th>
              <th scope="col">Mode</th>
              <th scope="col">Cost</th>
              <th scope="col">Latency</th>
              <th scope="col">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`#/reviews/${encodeURIComponent(r.id)}`}>
                    {r.repo}#{r.prNumber}
                  </a>
                </td>
                <td>
                  {r.status === 'done' ? (
                    <StatusBadge status={r.hasP0 ? 'problem' : 'done'} />
                  ) : (
                    <StatusBadge status="failed" />
                  )}
                </td>
                <td>{r.mode.replace('_', ' ')}</td>
                <td className="num">{usd(r.costUsd)}</td>
                <td className="num">{ms(r.latencyMs)}</td>
                <td className="num">{new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
