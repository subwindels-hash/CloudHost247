import { useEffect, useState } from 'react';

interface HealthState {
  health: 'checking' | 'ok' | 'error';
  ready: 'checking' | 'ok' | 'error';
}

export default function HomePage() {
  const [state, setState] = useState<HealthState>({ health: 'checking', ready: 'checking' });

  useEffect(() => {
    fetch('/health')
      .then((r) => setState((s) => ({ ...s, health: r.ok ? 'ok' : 'error' })))
      .catch(() => setState((s) => ({ ...s, health: 'error' })));

    fetch('/ready')
      .then((r) => setState((s) => ({ ...s, ready: r.ok ? 'ok' : 'error' })))
      .catch(() => setState((s) => ({ ...s, ready: 'error' })));
  }, []);

  return (
    <div>
      <div className="ch247-card">
        <h1>CloudHost247</h1>
        <p>Independent Node.js/PostgreSQL platform — Phase 1 foundation, packaged for cPanel deployment.</p>
      </div>
      <div className="ch247-card">
        <h2>Platform status</h2>
        <p>
          API process: <StatusBadge value={state.health} />
        </p>
        <p>
          Database connectivity: <StatusBadge value={state.ready} />
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ value }: { value: 'checking' | 'ok' | 'error' }) {
  if (value === 'checking') return <span>checking…</span>;
  if (value === 'ok') return <span className="ch247-status-ok">ok</span>;
  return <span className="ch247-status-error">unavailable</span>;
}
