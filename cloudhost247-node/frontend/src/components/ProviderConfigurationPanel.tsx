import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export interface ProviderConfigurationReport {
  provider: { id: string; name: string; slug: string; providerType: string; adapter: string; status: string };
  configuration: {
    adapter: string;
    label: string;
    envPrefix: string;
    apiBaseUrl: string | null;
    apiBaseUrlRequired: boolean;
    apiBaseUrlConfigured: boolean;
    credentials: Array<{
      suffix: string;
      name: string;
      fallbackName: string | null;
      description: string;
      required: boolean;
      present: boolean;
      stored: boolean;
    }>;
    planMetadata: Array<{ key: string; description: string; required: boolean }>;
    capabilities: Record<string, boolean>;
    notes: string;
    ready: boolean;
    missing: string[];
  };
  images: { total: number; verifiedActive: number };
}

interface ConnectResponse {
  provider: { id: string; name: string; status: string; lastHealthStatus: string | null } | null;
  result: { status: 'connected' | 'failed'; code: string | null; message: string };
}

function isSecretCredential(suffix: string): boolean {
  return /(?:TOKEN|API_KEY|API_SECRET|APPLICATION_KEY|APPLICATION_SECRET|ACCESS_KEY_ID|SECRET_ACCESS_KEY|PASSWORD|CLIENT_SECRET)$/.test(suffix);
}

/**
 * Shows adapter configuration and a write-only credential form. Secret values travel only to the
 * authenticated backend, are encrypted before storage, and are never included in the report API.
 */
export default function ProviderConfigurationPanel({
  providerId,
  canManageCredentials = false,
  onConnected,
}: {
  providerId: string;
  canManageCredentials?: boolean;
  onConnected?: () => void;
}) {
  const [report, setReport] = useState<ProviderConfigurationReport | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setReport(null);
    setError('');
    try {
      const result = await apiFetch<ProviderConfigurationReport>(`/api/v1/admin/providers/${providerId}/configuration`);
      setReport(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Provider configuration could not be loaded.');
    }
  }, [providerId]);

  useEffect(() => { void load(); }, [load]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const credentials = Object.fromEntries(Object.entries(draft).filter(([, value]) => value.length > 0));
      const response = await apiFetch<ConnectResponse>(`/api/v1/admin/providers/${providerId}/connect`, {
        method: 'POST',
        body: JSON.stringify({ credentials }),
      });
      setDraft({});
      if (response.result.status === 'connected') setNotice(response.result.message);
      else setError(response.result.message);
      await load();
      onConnected?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The provider connection test failed.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !report) return <p className="ch247-banner ch247-banner--error">{error}</p>;
  if (!report) return <p className="ch247-page__hint">Loading configuration requirements…</p>;
  const { configuration: config, images } = report;

  return (
    <div className="ch247-provider-config">
      <p className={`ch247-provider-config__state is-${config.ready ? 'ready' : 'incomplete'}`}>
        {config.ready
          ? 'Required API settings are present. Run a connection test to verify provider access.'
          : `Configuration required: ${config.missing.join(', ')}`}
      </p>
      {error && <p className="ch247-banner ch247-banner--error" role="alert">{error}</p>}
      {notice && <p className="ch247-banner ch247-banner--info" role="status">{notice}</p>}
      <dl className="ch247-provider-config__facts">
        <div><dt>Adapter</dt><dd>{config.label}</dd></div>
        <div><dt>Environment prefix</dt><dd><code>{config.envPrefix}</code></dd></div>
        <div>
          <dt>API base URL</dt>
          <dd>{config.apiBaseUrl ?? (config.apiBaseUrlRequired ? 'Required — not set' : 'Adapter default')}</dd>
        </div>
        <div><dt>Verified images</dt><dd>{images.verifiedActive} of {images.total}</dd></div>
      </dl>
      <div className="ch247-table-wrap">
        <table className="ch247-table">
          <thead><tr><th>Environment variable</th><th>Purpose</th><th>Required</th><th>Configured from</th></tr></thead>
          <tbody>
            {config.credentials.map((credential) => (
              <tr key={credential.name}>
                <td>
                  <code>{credential.name}</code>
                  {credential.fallbackName && <><br /><small>or <code>{credential.fallbackName}</code></small></>}
                </td>
                <td>{credential.description}</td>
                <td>{credential.required ? 'Yes' : 'Optional'}</td>
                <td className={credential.present ? 'ch247-ok-text' : credential.required ? 'ch247-error-text' : undefined}>
                  {credential.stored ? 'Encrypted dashboard vault' : credential.present ? 'Server environment' : 'Not set'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManageCredentials ? (
        <form className="ch247-provider-connect" onSubmit={connect}>
          <div>
            <h3>Connect provider API</h3>
            <p>Enter new values to save or rotate them. Leave a field blank to keep its saved value or use the server environment. Credentials are encrypted at rest and never shown again.</p>
          </div>
          <div className="ch247-form-grid">
            {config.credentials.map((credential) => (
              <label className="ch247-field" key={credential.suffix}>
                {credential.name}{credential.required ? ' *' : ' (optional)'}
                <input
                  type={isSecretCredential(credential.suffix) ? 'password' : 'text'}
                  autoComplete="new-password"
                  spellCheck={false}
                  value={draft[credential.suffix] ?? ''}
                  placeholder={credential.present ? 'Already configured — enter to replace' : credential.description}
                  onChange={(event) => setDraft((current) => ({ ...current, [credential.suffix]: event.target.value }))}
                  aria-label={`${credential.name}${credential.required ? ' required' : ' optional'}`}
                  data-credential-suffix={credential.suffix}
                />
                <small>{credential.description}</small>
              </label>
            ))}
          </div>
          <p className="ch247-page__hint">Saving credentials requires <code>CREDENTIAL_ENCRYPTION_KEY</code> or <code>CREDENTIAL_ENCRYPTION_KEYS</code> on the backend. The connection test makes a real API request; it does not verify plans, OS images, or every provisioning operation.</p>
          <button className="ch247-btn ch247-btn--primary" type="submit" disabled={busy}>
            {busy ? 'Connecting…' : report.provider.status === 'ACTIVE' ? 'Save changes & reconnect' : 'Save & connect API'}
          </button>
        </form>
      ) : (
        <p className="ch247-page__hint">Credential entry and provider connection are restricted to Super Admin.</p>
      )}

      {config.planMetadata.length > 0 && (
        <div className="ch247-provider-config__meta">
          <h4>Required plan metadata</h4>
          <ul>
            {config.planMetadata.map((item) => (
              <li key={item.key}><code>{item.key}</code> — {item.description}{item.required ? '' : ' (optional)'}</li>
            ))}
          </ul>
        </div>
      )}
      {config.notes && <p className="ch247-provider-config__notes">{config.notes}</p>}
    </div>
  );
}
