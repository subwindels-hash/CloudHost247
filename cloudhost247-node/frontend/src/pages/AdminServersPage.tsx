import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { apiFetch } from '../lib/api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';

interface ServerRow {
  id: string;
  name: string;
  hostname: string;
  ip_address: string | null;
  server_type: string;
  provider: string | null;
  region: string | null;
  status: string;
  cpu_cores: number;
  memory_mb: number;
  storage_mb: number;
  docker_enabled: boolean;
  kubernetes_enabled: boolean;
  cpanel_enabled: boolean;
  agent_url: string | null;
  agent_version: string | null;
  agent_last_seen_at: string | null;
  created_at: string;
}

interface CredentialMeta {
  id: string;
  credential_type: string;
  is_current: boolean;
  rotated_at: string | null;
  created_at: string;
}

/**
 * Admin servers (spec §34): the server registry — create servers, record credentials
 * (encrypted; values are write-only), rotate agent secrets (shown exactly once), retire
 * servers, and monitor agent reachability.
 */
export default function AdminServersPage() {
  usePageMeta('Servers', 'Admin — server registry');
  const [servers, setServers] = useState<ServerRow[] | null>(null);
  const [credentials, setCredentials] = useState<Record<string, CredentialMeta[]>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [secret, setSecret] = useState<{ serverId: string; secret: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const { id: focusId } = useParams<{ id?: string }>();
  const [form, setForm] = useState({
    name: '',
    hostname: '',
    ipAddress: '',
    serverType: 'VPS',
    provider: '',
    region: '',
    cpuCores: '4',
    memoryMb: '8192',
    storageMb: '102400',
    dockerEnabled: true,
    kubernetesEnabled: false,
    cpanelEnabled: false,
    agentUrl: '',
    agentSecret: '',
    whmUrl: '',
    whmUser: '',
    whmApiToken: '',
  });

  const load = useCallback(() => {
    let cancelled = false;
    apiFetch<{ servers: ServerRow[] }>('/api/v1/admin/servers')
      .then((result) => {
        if (cancelled) return;
        setServers(result.servers);
        for (const server of result.servers) {
          apiFetch<{ credentials: CredentialMeta[] }>(`/api/v1/admin/servers/${server.id}/credentials`)
            .then((cred) => !cancelled && setCredentials((current) => ({ ...current, [server.id]: cred.credentials })))
            .catch(() => undefined);
        }
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  async function createServer(event: React.FormEvent) {
    event.preventDefault();
    setBusy('create');
    setMessage('');
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        hostname: form.hostname,
        serverType: form.serverType,
        cpuCores: Number(form.cpuCores),
        memoryMb: Number(form.memoryMb),
        storageMb: Number(form.storageMb),
        dockerEnabled: form.dockerEnabled,
        kubernetesEnabled: form.kubernetesEnabled,
        cpanelEnabled: form.cpanelEnabled,
      };
      if (form.ipAddress) body.ipAddress = form.ipAddress;
      if (form.provider) body.provider = form.provider;
      if (form.region) body.region = form.region;
      if (form.agentUrl) body.agentUrl = form.agentUrl;
      if (form.agentSecret) body.agentSecret = form.agentSecret;
      if (form.whmUrl) body.whmUrl = form.whmUrl;
      if (form.whmUser) body.whmUser = form.whmUser;
      if (form.whmApiToken) body.whmApiToken = form.whmApiToken;
      const result = await apiFetch<{ server: ServerRow; agentSecret?: string }>('/api/v1/admin/servers', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setMessage(`Server created: ${result.server.name}`);
      if (result.agentSecret) setSecret({ serverId: result.server.id, secret: result.agentSecret });
      setShowCreate(false);
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy('');
    }
  }

  async function rotate(serverId: string) {
    setBusy(`rotate:${serverId}`);
    setMessage('');
    try {
      const result = await apiFetch<{ agentSecret: string }>(`/api/v1/admin/servers/${serverId}/rotate-credentials`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setSecret({ serverId, secret: result.agentSecret });
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Rotation failed');
    } finally {
      setBusy('');
    }
  }

  async function patch(serverId: string, body: Record<string, unknown>) {
    setBusy(`patch:${serverId}`);
    try {
      await apiFetch(`/api/v1/admin/servers/${serverId}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMessage('Saved.');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy('');
    }
  }

  async function remove(serverId: string) {
    if (!window.confirm('Retire and delete this server? Only possible when no installations run on it.')) return;
    setBusy(`delete:${serverId}`);
    try {
      await apiFetch(`/api/v1/admin/servers/${serverId}`, { method: 'DELETE' });
      setMessage('Server removed.');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Delete failed (installations may still run on it — retire instead)');
    } finally {
      setBusy('');
    }
  }

  async function retire(serverId: string) {
    setBusy(`retire:${serverId}`);
    try {
      await patch(serverId, { status: 'retired' });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Servers</h1>
        <p className="ch247-page__hint">
          Servers the platform can deploy to. Credentials are stored encrypted; secrets are shown
          once at creation/rotation and never again. An agent seen in the last 5 minutes counts
          as reachable.
        </p>
        {message && <p className="ch247-banner ch247-banner--info">{message}</p>}
        {error && <CatalogErrorBanner message={error} />}
        <button type="button" className="ch247-btn ch247-btn--primary" onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? 'Close' : 'Add server'}
        </button>

        {showCreate && (
          <form className="ch247-form" onSubmit={createServer}>
            <label className="ch247-field">
              Name
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="ch247-field">
              Hostname
              <input required value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} />
            </label>
            <label className="ch247-field">
              Type
              <select value={form.serverType} onChange={(e) => setForm({ ...form, serverType: e.target.value })}>
                <option value="VPS">VPS</option>
                <option value="DEDICATED">Dedicated</option>
                <option value="CPANEL">cPanel</option>
                <option value="KUBERNETES">Kubernetes</option>
                <option value="SHARED">Shared</option>
              </select>
            </label>
            <label className="ch247-field">
              CPU cores
              <input type="number" min={1} value={form.cpuCores} onChange={(e) => setForm({ ...form, cpuCores: e.target.value })} />
            </label>
            <label className="ch247-field">
              Memory (MB)
              <input type="number" min={256} value={form.memoryMb} onChange={(e) => setForm({ ...form, memoryMb: e.target.value })} />
            </label>
            <label className="ch247-field">
              Storage (MB)
              <input type="number" min={1024} value={form.storageMb} onChange={(e) => setForm({ ...form, storageMb: e.target.value })} />
            </label>
            <label className="ch247-field">
              Region
              <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="eu-central" />
            </label>
            <label className="ch247-field">
              Agent URL (Docker servers)
              <input value={form.agentUrl} onChange={(e) => setForm({ ...form, agentUrl: e.target.value })} placeholder="https://10.0.0.5:8787" />
            </label>
            <label className="ch247-field">
              Agent secret (optional — generated if blank)
              <input value={form.agentSecret} onChange={(e) => setForm({ ...form, agentSecret: e.target.value })} autoComplete="off" />
            </label>
            <div className="ch247-fieldset">
              <label>
                <input type="checkbox" checked={form.dockerEnabled} onChange={(e) => setForm({ ...form, dockerEnabled: e.target.checked })} />{' '}
                Docker deployments
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.kubernetesEnabled}
                  onChange={(e) => setForm({ ...form, kubernetesEnabled: e.target.checked })}
                />{' '}
                Kubernetes
              </label>
              <label>
                <input type="checkbox" checked={form.cpanelEnabled} onChange={(e) => setForm({ ...form, cpanelEnabled: e.target.checked })} />{' '}
                cPanel (WHM API)
              </label>
            </div>
            <button type="submit" className="ch247-btn ch247-btn--primary" disabled={busy !== ''}>
              Create server
            </button>
          </form>
        )}
      </div>

      {secret && (
        <div className="ch247-card">
          <h2>Agent secret — copy it now</h2>
          <p className="ch247-banner ch247-banner--warning">
            This secret is shown <strong>once</strong>. Store it in your password manager before closing this box.
          </p>
          <p>
            <code className="ch247-secret">{secret.secret}</code>
          </p>
          <button type="button" className="ch247-btn" onClick={() => setSecret(null)}>
            I have stored it
          </button>
        </div>
      )}

      {servers === null && !error && <CatalogLoadingBanner label="Loading servers…" />}
      {servers?.map((server) => {
        const agentSeenRecently =
          server.agent_last_seen_at && Date.now() - new Date(server.agent_last_seen_at).getTime() < 5 * 60 * 1000;
        return (
          <div key={server.id} className={`ch247-card ch247-instrow ${focusId === server.id ? 'is-focus' : ''}`}>
            <div className="ch247-instrow__main">
              <h2>{server.name}</h2>
              <p className="ch247-market-card__cat">
                {server.server_type} · {server.hostname}
                {server.region ? ` · ${server.region}` : ''} · <span className="ch247-badge">{server.status}</span>
                {server.docker_enabled ? ' · Docker' : ''}
                {server.kubernetes_enabled ? ' · K8s' : ''}
                {server.cpanel_enabled ? ' · cPanel' : ''}
              </p>
              <p className="ch247-page__hint">
                {server.cpu_cores} CPU · {Math.round(server.memory_mb / 1024)} GB RAM · {Math.round(server.storage_mb / 1024)} GB ·
                agent {server.agent_version ?? '—'}{' '}
                {server.agent_last_seen_at ? (
                  agentSeenRecently ? (
                    <span className="ch247-badge ch247-badge--active">online</span>
                  ) : (
                    <span className="ch247-badge ch247-badge--warning">
                      last seen {new Date(server.agent_last_seen_at).toLocaleString()}
                    </span>
                  )
                ) : (
                  <span className="ch247-badge">no agent</span>
                )}
              </p>
              {(credentials[server.id] ?? []).length > 0 && (
                <p className="ch247-page__hint">
                  Credentials: {(credentials[server.id] ?? []).map((credential) => (
                    <span key={credential.id} className="ch247-badge">
                      {credential.credential_type}
                      {credential.rotated_at ? ` (rotated ${new Date(credential.rotated_at).toLocaleDateString()})` : ''}
                    </span>
                  ))}
                </p>
              )}
            </div>
            <div className="ch247-instrow__side ch247-actions">
              {server.status !== 'retired' && (
                <button type="button" className="ch247-btn" disabled={busy !== ''} onClick={() => rotate(server.id)}>
                  Rotate agent secret
                </button>
              )}
              {server.status === 'active' && (
                <button type="button" className="ch247-btn" disabled={busy !== ''} onClick={() => patch(server.id, { status: 'maintenance' })}>
                  Maintenance
                </button>
              )}
              {server.status === 'maintenance' && (
                <button type="button" className="ch247-btn" disabled={busy !== ''} onClick={() => patch(server.id, { status: 'active' })}>
                  Activate
                </button>
              )}
              {server.status !== 'retired' && (
                <button type="button" className="ch247-btn" disabled={busy !== ''} onClick={() => retire(server.id)}>
                  Retire
                </button>
              )}
              <button type="button" className="ch247-btn ch247-btn--danger" disabled={busy !== ''} onClick={() => remove(server.id)}>
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
