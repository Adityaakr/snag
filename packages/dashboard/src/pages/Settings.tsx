import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface SettingsResponse {
  installations: { id: number; account: string }[];
  repositories: { fullName: string; installationId: number; configHash: string | null; config: unknown }[];
  defaults: unknown;
}

export function Settings() {
  const [s, setS] = useState<SettingsResponse | null>(null);
  useEffect(() => {
    api<SettingsResponse>('/api/settings').then(setS, () => setS(null));
  }, []);
  if (!s) return <p className="muted">Loading settings…</p>;
  return (
    <section aria-labelledby="settings-title">
      <h1 id="settings-title">Settings</h1>
      <h2>Installations</h2>
      <ul>
        {s.installations.map((i) => (
          <li key={i.id}>
            {i.account} <span className="muted num">({i.id})</span>
          </li>
        ))}
      </ul>
      <h2>Repositories</h2>
      <ul>
        {s.repositories.map((r) => (
          <li key={r.fullName}>
            {r.fullName}{' '}
            <span className="muted">
              config {r.configHash ? r.configHash.slice(0, 8) : 'defaults (not reviewed yet)'}
            </span>
            {r.config ? (
              <details>
                <summary>Effective config at the last review (read-only)</summary>
                <pre>{JSON.stringify(r.config, null, 2)}</pre>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
      <h2>Effective defaults (read-only)</h2>
      <p className="muted">Each repository overrides these in its config file on the default branch.</p>
      <pre>{JSON.stringify(s.defaults, null, 2)}</pre>
    </section>
  );
}
