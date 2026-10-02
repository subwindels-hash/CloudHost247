import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { apiFetch } from '../lib/api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';

interface SettingsMap {
  [key: string]: string | number | boolean;
}

interface SettingSchemaEntry {
  key: string;
  type: 'number' | 'boolean' | 'string';
  label: string;
  description: string | null;
  min: number | null;
  max: number | null;
}

/**
 * Admin platform settings (spec §49): a fixed whitelist of tunable knobs. Unknown keys are
 * rejected server-side with 400 — this page simply renders whatever the whitelist allows.
 */
export default function AdminSettingsPage() {
  usePageMeta('Platform settings', 'Admin — configurable platform behavior');
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [schemas, setSchemas] = useState<SettingSchemaEntry[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    apiFetch<{ settings: SettingsMap; schemas: SettingSchemaEntry[] }>('/api/v1/admin/settings')
      .then((result) => {
        if (cancelled) return;
        setSettings(result.settings);
        setSchemas(result.schemas ?? []);
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  async function save(key: string, rawValue: string) {
    const schema = schemas.find((entry) => entry.key === key);
    setBusy(true);
    setMessage('');
    try {
      const value =
        schema?.type === 'number'
          ? Number(rawValue)
          : schema?.type === 'boolean'
            ? rawValue === 'true'
            : rawValue;
      await apiFetch(`/api/v1/admin/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) });
      setMessage(`Saved ${key}.`);
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Platform settings</h1>
        <p className="ch247-page__hint">
          Only the settings below are configurable at runtime — everything else is code. Each
          change is audit-logged with the admin who made it.
        </p>
        <p className="ch247-page__hint">
          <Link to="/admin/settings/tools/mrz">Super Admin → Settings → Tools → MRZ →</Link>
        </p>
        {message && <p className="ch247-banner ch247-banner--info">{message}</p>}
        {error && <CatalogErrorBanner message={error} />}
      </div>

      {settings === null && !error && <CatalogLoadingBanner label="Loading settings…" />}
      {settings !== null && schemas.length === 0 && (
        <div className="ch247-card">
          <p className="ch247-page__hint">No settings are exposed for runtime configuration.</p>
        </div>
      )}

      {settings !== null && schemas.map((schema) => (
        <div key={schema.key} className="ch247-card">
          <h2>{schema.label}</h2>
          <p className="ch247-page__hint">
            <code>{schema.key}</code>
            {schema.description ? ` — ${schema.description}` : ''}
            {schema.min !== null ? ` (min ${schema.min})` : ''}
            {schema.max !== null ? ` (max ${schema.max})` : ''}
          </p>
          <form
            className="ch247-inlineform"
            onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get('value');
              if (typeof value === 'string') save(schema.key, value);
            }}
          >
            {schema.type === 'boolean' ? (
              <select name="value" defaultValue={String(settings[schema.key] ?? false)}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input name="value" type={schema.type === 'number' ? 'number' : 'text'} defaultValue={String(settings[schema.key] ?? '')} />
            )}
            <button type="submit" className="ch247-btn ch247-btn--primary" disabled={busy}>
              Save
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}
