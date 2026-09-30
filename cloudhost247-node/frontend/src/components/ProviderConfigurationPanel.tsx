import { useEffect, useState } from 'react';
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
    credentials: Array<{ name: string; fallbackName: string | null; description: string; required: boolean; present: boolean }>;
    planMetadata: Array<{ key: string; description: string; required: boolean }>;
    capabilities: Record<string, boolean>;
    notes: string;
    ready: boolean;
    missing: string[];
  };
  images: { total: number; verifiedActive: number };
}

/**
 * Shows an operator exactly which server-side variables an adapter needs and which are still
 * missing. The API returns names and booleans only — a credential value is never sent to the
 * browser, so this panel can never leak a secret.
 */
export default function ProviderConfigurationPanel({ providerId }: { providerId: string }) {
  const [report, setReport] = useState<ProviderConfigurationReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch<ProviderConfigurationReport>(`/api/v1/admin/providers/${providerId}/configuration`)
      .then((result) => { if (!cancelled) setReport(result); })
      .catch((cause: Error) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [providerId]);

  if (error) return <p className="ch247-banner ch247-banner--error">{error}</p>;
  if (!report) return <p className="ch247-page__hint">Loading configuration requirements…</p>;
  const { configuration: config, images } = report;

  return (
    <div className="ch247-provider-config">
      <p className={`ch247-provider-config__state is-${config.ready ? 'ready' : 'incomplete'}`}>
        {config.ready
          ? 'All required server-side configuration is present.'
          : `Configuration required: ${config.missing.join(', ')}`}
      </p>
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
          <thead><tr><th>Environment variable</th><th>Purpose</th><th>Required</th><th>Status</th></tr></thead>
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
                  {credential.present ? 'Set' : 'Not set'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
