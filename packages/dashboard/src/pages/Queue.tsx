import { useCallback, useEffect, useState } from 'react';
import { api, type QueueItem } from '../api.js';

/** The labeling queue: `a` agree, `d` disagree, `s` skip, `?` help. Keys are ignored while typing in a field. */
export function Queue() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [help, setHelp] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    api<QueueItem[]>('/api/queue').then(setItems, () => setItems([]));
  }, []);
  const item = items?.[index];
  const label = useCallback(
    async (l: 'agree' | 'disagree') => {
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
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
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
  return (
    <section aria-labelledby="queue-title">
      <h1 id="queue-title">Labeling queue</h1>
      <p className="muted">
        Keys: <kbd>a</kbd> agree, <kbd>d</kbd> disagree, <kbd>s</kbd> skip, <kbd>?</kbd> help.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {help ? (
        <div role="dialog" aria-label="Keyboard shortcuts" className="card">
          <p>
            Press a to agree that the finding is right, d to disagree, s to skip it, and ? or Escape to close
            this help.
          </p>
        </div>
      ) : null}
      {items === null ? (
        <p className="muted">Loading findings…</p>
      ) : !item ? (
        <p>Nothing left to label. Thank you.</p>
      ) : (
        <article className="card" aria-label={`Finding ${item.finding.id}`}>
          <h2>
            {item.finding.id}{' '}
            <span className="muted">
              ({item.finding.priority}, {item.finding.type})
            </span>
          </h2>
          <p className="muted">
            {item.repo}#{item.pr} · confidence{' '}
            <span className="num">{item.finding.confidence.toFixed(2)}</span>
          </p>
          {item.quote ? <blockquote>{item.quote}</blockquote> : null}
          <ul>
            {item.finding.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {item.finding.locations.map((l) => (
            <p key={`${l.file}${l.lines[0]}`} className="num">
              {l.file}:{l.lines[0]}-{l.lines[1]}
            </p>
          ))}
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button type="button" onClick={() => void label('agree')}>
              Agree (a)
            </button>
            <button type="button" onClick={() => void label('disagree')}>
              Disagree (d)
            </button>
            <button type="button" onClick={() => setIndex((i) => i + 1)}>
              Skip (s)
            </button>
          </div>
        </article>
      )}
    </section>
  );
}
