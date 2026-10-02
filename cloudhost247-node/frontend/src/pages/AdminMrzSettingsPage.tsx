import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { apiFetch } from '../lib/api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';

interface MrzAdminSettingsDto {
  calculatorEnabled: boolean;
  parserEnabled: boolean;
  testDataEnabled: boolean;
  rateLimitPerMinute: number;
  loggingLevel: 'none' | 'errors_only' | 'minimal_operational';
  availability: 'public' | 'authenticated' | 'admin_only';
  privacyProtectionLocked: true;
  persistSubmittedData: false;
  logSensitiveMrzData: false;
}

/**
 * Super Admin → Settings → Tools → MRZ (spec §18)
 *
 * Allows administrators to:
 * - Enable/disable MRZ calculator
 * - Enable/disable MRZ parser
 * - Enable/disable synthetic test-data generator
 * - Configure rate limits
 * - Configure logging level (non-sensitive operational metadata only)
 * - Configure availability (public, authenticated, admin_only)
 *
 * Privacy protections are permanently locked ON and cannot be disabled.
 */
export default function AdminMrzSettingsPage() {
  usePageMeta(
    'MRZ Tool Settings — Super Admin',
    'Super Admin → Settings → Tools → MRZ configuration for CloudHost247.'
  );

  const [settings, setSettings] = useState<MrzAdminSettingsDto | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setError('');
    apiFetch<{ settings: MrzAdminSettingsDto }>('/api/v1/admin/tools/mrz/settings')
      .then((res) => {
        if (!cancelled) setSettings(res.settings);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load MRZ tool settings.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const res = await apiFetch<{ settings: MrzAdminSettingsDto }>('/api/v1/admin/tools/mrz/settings', {
        method: 'PUT',
        body: JSON.stringify({
          calculatorEnabled: settings.calculatorEnabled,
          parserEnabled: settings.parserEnabled,
          testDataEnabled: settings.testDataEnabled,
          rateLimitPerMinute: settings.rateLimitPerMinute,
          loggingLevel: settings.loggingLevel,
          availability: settings.availability,
        }),
      });
      setSettings(res.settings);
      setMessage('MRZ tool settings saved and audit-logged.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save MRZ tool settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <p className="ch247-page__hint" style={{ marginBottom: '0.35rem' }}>
          <Link to="/admin">Super Admin</Link> → <Link to="/admin/settings">Settings</Link> → Tools →{' '}
          <strong>MRZ</strong>
        </p>
        <h1>Super Admin → Settings → Tools → MRZ</h1>
        <p className="ch247-page__hint">
          Configure availability, rate limits, and operational audit level for the native ePassport MRZ
          Calculator (<code>/tools/document/mrz</code>) and MRZ Parser (<code>/tools/document/mrz-parser</code>).
        </p>
        {message && (
          <p className="ch247-banner ch247-banner--info" role="status">
            {message}
          </p>
        )}
        {error && <CatalogErrorBanner message={error} />}
      </div>

      {settings === null && !error && <CatalogLoadingBanner label="Loading MRZ tool settings…" />}

      {settings !== null && (
        <>
          <form className="ch247-card ch247-stack" onSubmit={handleSubmit}>
            <h2>Tool Feature Controls</h2>

            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={settings.calculatorEnabled}
                  onChange={(e) => setSettings({ ...settings, calculatorEnabled: e.target.checked })}
                />
                Enable MRZ Calculator
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={settings.parserEnabled}
                  onChange={(e) => setSettings({ ...settings, parserEnabled: e.target.checked })}
                />
                Enable MRZ Parser
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={settings.testDataEnabled}
                  onChange={(e) => setSettings({ ...settings, testDataEnabled: e.target.checked })}
                />
                Enable Synthetic Test-Data Generator
              </label>
            </div>

            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginTop: '0.5rem' }}>
              <div>
                <label htmlFor="mrz-admin-rate-limit" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Rate Limit (requests / minute per IP)
                </label>
                <input
                  id="mrz-admin-rate-limit"
                  type="number"
                  min={1}
                  max={600}
                  value={settings.rateLimitPerMinute}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      rateLimitPerMinute: Number.parseInt(e.target.value || '60', 10),
                    })
                  }
                  style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                />
              </div>

              <div>
                <label htmlFor="mrz-admin-logging-level" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Operational Logging Level
                </label>
                <select
                  id="mrz-admin-logging-level"
                  value={settings.loggingLevel}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      loggingLevel: e.target.value as MrzAdminSettingsDto['loggingLevel'],
                    })
                  }
                  style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                >
                  <option value="none">None (Stateless default — zero operational logs)</option>
                  <option value="errors_only">Errors Only (Non-sensitive error category metadata)</option>
                  <option value="minimal_operational">Minimal Operational (Tool, account ID, timestamp, status)</option>
                </select>
              </div>

              <div>
                <label htmlFor="mrz-admin-availability" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Tool Availability
                </label>
                <select
                  id="mrz-admin-availability"
                  value={settings.availability}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      availability: e.target.value as MrzAdminSettingsDto['availability'],
                    })
                  }
                  style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                >
                  <option value="public">Public (All visitors &amp; developers)</option>
                  <option value="authenticated">Authenticated Accounts Only</option>
                  <option value="admin_only">Administrators Only (Admin / Super Admin)</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <button type="submit" className="ch247-button" disabled={busy}>
                {busy ? 'Saving…' : 'Save MRZ Tool Settings'}
              </button>
            </div>
          </form>

          <div className="ch247-card">
            <h2>Mandatory Privacy Protections (Locked)</h2>
            <p className="ch247-page__hint">
              Privacy protections are permanently enforced by platform policy and cannot be disabled by
              any administrator setting:
            </p>
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
              <li>
                <strong>Persist Submitted Passport / MRZ Data:</strong> Disabled (Locked — Stateless)
              </li>
              <li>
                <strong>Include MRZ / Names / Document Numbers / Dates in Logs:</strong> Redacted &amp; Forbidden (Locked)
              </li>
              <li>
                <strong>Analytics Transmission of MRZ Fields:</strong> Disabled (Locked)
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
