import type { ReviewResult } from '@remit/core';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ms, StatusBadge, usd } from '../components.js';
import type { Status } from '../theme.js';

interface Detail {
  id: string;
  repo: string;
  pr: number;
  headSha: string;
  result: ReviewResult;
  feedback: { findingId: string; label: string; login: string }[];
}

const statusOf = (s: string): Status =>
  s === 'done' || s === 'preexisting' || s === 'deferred'
    ? 'done'
    : s === 'uncertain' || s === 'not_checkable'
      ? 'uncertain'
      : 'problem';

export function ReviewDetail({ id }: { id: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Detail>(`/api/reviews/${encodeURIComponent(id)}`).then(setD, () =>
      setError('This review was not found or you cannot see it.'),
    );
  }, [id]);
  if (error) return <p role="alert">{error}</p>;
  if (!d) return <p className="muted">Loading review…</p>;
  const r = d.result;
  const blob = (file: string, lines: [number, number]) =>
    `https://github.com/${d.repo}/blob/${d.headSha}/${file}#L${lines[0]}-L${lines[1]}`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${d.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <article aria-labelledby="detail-title">
      <h1 id="detail-title">
        {d.repo}#{d.pr}
      </h1>
      <p className="muted">
        Head <span className="num">{d.headSha.slice(0, 7)}</span> · cost{' '}
        <span className="num">{usd(r.usage.costUsd)}</span> · latency{' '}
        <span className="num">{ms(r.usage.latencyMs)}</span> · questions {r.versions.questionSet} · Jev{' '}
        {r.versions.jevModel}
        {r.versions.calibration ? ` · calibration ${r.versions.calibration}` : ' · uncalibrated'}
        {' · '}
        <button type="button" onClick={download}>
          Download JSON
        </button>
      </p>
      <h2>Requirements</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Id</th>
            <th scope="col">Status</th>
            <th scope="col">Quote</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {r.requirementVerdicts.map((v) => {
            const q = r.requirements.find((x) => x.id === v.requirementId);
            return (
              <tr key={v.requirementId}>
                <td className="num">{v.requirementId}</td>
                <td>
                  <StatusBadge status={statusOf(v.status)} />{' '}
                  <span className="muted">{v.status.replace('_', ' ')}</span>
                </td>
                <td>{q?.quote}</td>
                <td>
                  {v.evidence.map((e) =>
                    e.lines.map((l) => (
                      <div key={`${e.unitId}-${l[0]}`}>
                        <a href={blob(e.file, l)}>
                          {e.file}:{l[0]}-{l[1]}
                        </a>
                      </div>
                    )),
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h2>Units</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Unit</th>
            <th scope="col">Role</th>
            <th scope="col">Facts</th>
          </tr>
        </thead>
        <tbody>
          {r.units.map((u) => (
            <tr key={u.id}>
              <td>
                <span className="num">{u.id}</span> {u.file}
                {u.symbol ? ` (${u.symbol.name})` : ''}
              </td>
              <td>
                {r.unitVerdicts.find((v) => v.unitId === u.id)?.role.replace('_', ' ') ?? 'not reviewed'}
              </td>
              <td>
                {u.facts.map((f) => `${f.kind} (${f.severity})`).join(', ') || (
                  <span className="muted">none</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Raw answers</h2>
      {r.requirementVerdicts.map((v) => (
        <details key={v.requirementId}>
          <summary>{v.requirementId}</summary>
          <pre>{JSON.stringify(v.answers, null, 2)}</pre>
        </details>
      ))}
      {r.warnings.length ? (
        <>
          <h2>Warnings</h2>
          <ul>
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}
