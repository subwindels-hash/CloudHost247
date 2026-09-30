import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import StatusBadge from '../components/StatusBadge';
import { apiFetch } from '../lib/api';
import {
  fetchCustomerServer,
  fetchServerConfiguration,
  serverAction,
  type AvailableOperatingSystem,
  type CustomerServer,
  type ServerConfiguration,
} from '../lib/infrastructure-api';
import {
  fetchServerFirewall,
  addServerFirewallRule,
  deleteServerFirewallRule,
  applyBaselineFirewall,
  type FirewallRule,
} from '../lib/ssl-firewall-api';
import { usePageMeta } from '../lib/usePageMeta';

interface ProvisioningState {
  server: { status: string; provisioningStatus: string | null };
  job: {
    id: string;
    status: string;
    attempts: number;
    max_attempts: number;
    error_code: string | null;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
  } | null;
}

const ACTIVE_JOB = new Set([
  'QUEUED',
  'ALLOCATING',
  'CREATING',
  'INSTALLING_OS',
  'CONFIGURING',
  'NETWORK_CONFIGURING',
  'SECURITY_CONFIGURING',
  'HEALTH_CHECK',
]);

const PANEL_PORTS: Record<string, { port: number; protocol: 'http' | 'https' }> = {
  cpanel: { port: 2087, protocol: 'https' },
  plesk: { port: 8443, protocol: 'https' },
  directadmin: { port: 2222, protocol: 'https' },
  cyberpanel: { port: 8090, protocol: 'https' },
  hestiacp: { port: 8083, protocol: 'https' },
  cloudpanel: { port: 8443, protocol: 'https' },
  aapanel: { port: 7800, protocol: 'https' },
  fastpanel: { port: 8888, protocol: 'https' },
  webuzo: { port: 2004, protocol: 'https' },
  webmin: { port: 10000, protocol: 'https' },
  tinycp: { port: 8080, protocol: 'http' },
  kusanagi: { port: 8443, protocol: 'https' },
  dokploy: { port: 3000, protocol: 'http' },
  coolify: { port: 8000, protocol: 'http' },
  easypanel: { port: 3000, protocol: 'http' },
  cosmos: { port: 3443, protocol: 'https' },
  cloudron: { port: 443, protocol: 'https' },
  adminbolt: { port: 443, protocol: 'https' },
};

export default function ServerDetailPage() {
  const { id = '' } = useParams();
  usePageMeta('Server', 'CloudHost247 server status, actions, and operating-system reinstall.');
  const [server, setServer] = useState<CustomerServer | null>(null);
  const [provisioning, setProvisioning] = useState<ProvisioningState | null>(null);
  const [configuration, setConfiguration] = useState<ServerConfiguration | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [showReinstall, setShowReinstall] = useState(false);
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [snapshotDesc, setSnapshotDesc] = useState('');
  const [targetOs, setTargetOs] = useState('');
  const [targetVersion, setTargetVersion] = useState('');
  const [targetArchitecture, setTargetArchitecture] = useState<'x86_64' | 'arm64'>('x86_64');
  const [confirm, setConfirm] = useState('');
  const [firewallRules, setFirewallRules] = useState<FirewallRule[]>([]);
  const [newRulePort, setNewRulePort] = useState('');
  const [newRuleProtocol, setNewRuleProtocol] = useState<'tcp' | 'udp'>('tcp');
  const [newRuleDesc, setNewRuleDesc] = useState('');

  const load = useCallback(async () => {
    const [{ server: loaded }, state, fw] = await Promise.all([
      fetchCustomerServer(id),
      apiFetch<ProvisioningState>(`/api/v1/servers/${id}/provisioning-status`),
      fetchServerFirewall(id).catch(() => ({ rules: [] })),
    ]);
    setServer(loaded);
    setProvisioning(state);
    setFirewallRules(fw.rules);
  }, [id]);

  useEffect(() => {
    load().catch((cause: Error) => setError(cause.message));
  }, [load]);

  useEffect(() => {
    if (!provisioning?.job || !ACTIVE_JOB.has(provisioning.job.status)) return;
    const timer = window.setInterval(() => load().catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, [provisioning?.job?.status, load]);

  useEffect(() => {
    if (!showReinstall || !server?.plan_id) return;
    fetchServerConfiguration(server.plan_id, server.server_type)
      .then(setConfiguration)
      .catch((cause: Error) => setError(cause.message));
  }, [showReinstall, server?.plan_id, server?.server_type]);

  const reinstallSystems = useMemo<AvailableOperatingSystem[]>(() => {
    if (!server) return [];
    return (configuration?.operatingSystems ?? [])
      .map((os) => ({
        ...os,
        versions: os.versions.filter((version) =>
          version.availability.some(
            (available) =>
              available.providerId === server.provider_id &&
              available.regionId === server.region_id &&
              available.datacenterId === server.datacenter_id
          )
        ),
      }))
      .filter((os) => os.versions.length > 0);
  }, [configuration, server]);

  useEffect(() => {
    const os = reinstallSystems.find((item) => item.id === targetOs) ?? reinstallSystems[0];
    if (!os) return;
    if (os.id !== targetOs) setTargetOs(os.id);
    const version = os.versions.find((item) => item.id === targetVersion) ?? os.versions[0];
    if (version) {
      if (version.id !== targetVersion) setTargetVersion(version.id);
      if (!version.architectures.includes(targetArchitecture)) {
        setTargetArchitecture(version.architectures[0] ?? 'x86_64');
      }
    }
  }, [reinstallSystems, targetOs, targetVersion, targetArchitecture]);

  async function action(name: string, payload: unknown = {}) {
    setBusy(name);
    setError('');
    setMessage('');
    try {
      const result = await serverAction(id, name, payload);
      setMessage(`${name.replace(/_/g, ' ')} queued as job ${result.jobId}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not execute ${name}`);
    } finally {
      setBusy('');
    }
  }

  async function createSnapshot() {
    setShowSnapshotModal(false);
    await action('snapshot_create', { description: snapshotDesc || `Manual-Snapshot-${new Date().toISOString().slice(0, 10)}` });
    setSnapshotDesc('');
  }

  async function handleAddFirewallRule(e: React.FormEvent) {
    e.preventDefault();
    if (!newRulePort) return;
    setBusy('firewall');
    try {
      await addServerFirewallRule(id, {
        portRangeStart: Number(newRulePort),
        protocol: newRuleProtocol,
        description: newRuleDesc || 'Custom rule',
      });
      setMessage(`Firewall rule for port ${newRulePort}/${newRuleProtocol} added.`);
      setNewRulePort('');
      setNewRuleDesc('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add firewall rule');
    } finally {
      setBusy('');
    }
  }

  async function handleDeleteFirewallRule(ruleId: string) {
    setBusy('firewall');
    try {
      await deleteServerFirewallRule(id, ruleId);
      setMessage('Firewall rule deleted.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete firewall rule');
    } finally {
      setBusy('');
    }
  }

  async function handleApplyBaselineFirewall() {
    setBusy('firewall');
    try {
      await applyBaselineFirewall(id);
      setMessage('Baseline firewall rules applied.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply baseline firewall');
    } finally {
      setBusy('');
    }
  }

  async function reinstall() {
    if (confirm !== 'REINSTALL') {
      setError('Type REINSTALL to confirm the destructive operation.');
      return;
    }
    setBusy('reinstall');
    setError('');
    try {
      const result = await serverAction(id, 'reinstall', {
        operatingSystemVersionId: targetVersion,
        architecture: targetArchitecture,
        confirmation: 'REINSTALL',
      });
      setMessage(`Reinstall queued as job ${result.jobId}.`);
      setShowReinstall(false);
      setConfirm('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not queue reinstall');
    } finally {
      setBusy('');
    }
  }

  if (!server && !error) return <CatalogLoadingBanner label="Loading server…" />;
  if (!server) return <CatalogErrorBanner message={error || 'Server not found'} />;
  const runningJob = provisioning?.job && ACTIVE_JOB.has(provisioning.job.status);

  const panelSlug = server.control_panel_slug;
  const panelPortInfo = panelSlug ? PANEL_PORTS[panelSlug] : null;
  const panelUrl =
    panelSlug === 'adminbolt'
      ? `/dashboard/servers/${server.id}`
      : server.ip_address && panelPortInfo
      ? `${panelPortInfo.protocol}://${server.ip_address}${
          (panelPortInfo.protocol === 'http' && panelPortInfo.port === 80) ||
          (panelPortInfo.protocol === 'https' && panelPortInfo.port === 443)
            ? ''
            : `:${panelPortInfo.port}`
        }`
      : null;

  return (
    <div className="ch247-stack">
      <section className="ch247-card ch247-server-hero">
        <div className="ch247-server-hero__identity">
          {server.os_logo_url ? (
            <img src={server.os_logo_url} alt="" />
          ) : (
            <span className="ch247-os-card__fallback">OS</span>
          )}
          <div>
            <span className="ch247-eyebrow">
              {server.server_type} · {server.region_name ?? 'Region pending'}
            </span>
            <h1>{server.name}</h1>
            <p>
              {server.os_display_name ?? 'Unknown operating system'} · {server.architecture ?? '—'}
            </p>
          </div>
        </div>
        <div className="ch247-server-status">
          <StatusBadge status={server.status} />
          <strong>{server.ip_address ?? 'IP pending'}</strong>
        </div>
      </section>

      {error && <CatalogErrorBanner message={error} />}
      {message && <p className="ch247-banner ch247-banner--info">{message}</p>}

      {/* Control Panel Integration Card */}
      {server.control_panel_name && (
        <section className="ch247-card ch247-panel-status-card">
          <div className="ch247-section-heading">
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {server.control_panel_logo_url ? (
                <img
                  src={server.control_panel_logo_url}
                  alt=""
                  style={{ width: 44, height: 44, objectFit: 'contain' }}
                />
              ) : (
                <span className="ch247-os-card__fallback">
                  {server.control_panel_name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <div>
                <span className="ch247-eyebrow">Installed Control Panel</span>
                <h2 style={{ margin: 0 }}>{server.control_panel_name}</h2>
              </div>
            </div>
            {panelUrl && server.status === 'active' && (
              <a
                href={panelUrl}
                target={panelSlug === 'adminbolt' ? '_self' : '_blank'}
                rel="noopener noreferrer"
                className="ch247-btn ch247-btn--primary"
              >
                Open Panel Dashboard ↗
              </a>
            )}
          </div>

          <div style={{ marginTop: '1rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
            <div>
              <span style={{ color: '#64748b' }}>Access URL: </span>
              <strong>{panelUrl ?? 'Available after IP assignment'}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>Initial Admin Login: </span>
              <strong>root / admin</strong>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>Installation Method: </span>
              <span>{server.control_panel_installation_method ?? 'Automated via Cloud-Init'}</span>
            </div>
          </div>
        </section>
      )}

      {provisioning?.job && (
        <section className="ch247-card">
          <div className="ch247-section-heading">
            <div>
              <span className="ch247-eyebrow">Provisioning job</span>
              <h2>{provisioning.job.status.replace(/_/g, ' ')}</h2>
            </div>
            <span>
              Attempt {provisioning.job.attempts}/{provisioning.job.max_attempts}
            </span>
          </div>
          {runningJob && (
            <div className="ch247-progress">
              <span
                style={{
                  width: `${Math.max(
                    8,
                    [
                      'QUEUED',
                      'ALLOCATING',
                      'CREATING',
                      'INSTALLING_OS',
                      'CONFIGURING',
                      'NETWORK_CONFIGURING',
                      'SECURITY_CONFIGURING',
                      'HEALTH_CHECK',
                      'READY',
                    ].indexOf(provisioning.job.status) * 12.5
                  )}%`,
                }}
              />
            </div>
          )}
          {provisioning.job.error_message && (
            <p className="ch247-banner ch247-banner--error">
              <strong>{provisioning.job.error_code}</strong> — {provisioning.job.error_message}
            </p>
          )}
          <Link to={`/dashboard/servers/${server.id}/logs`}>View provisioning details →</Link>
        </section>
      )}

      <section className="ch247-server-layout">
        <article className="ch247-card">
          <h2>Server details</h2>
          <dl className="ch247-kv">
            <dt>Provider</dt>
            <dd>{server.provider_name ?? '—'}</dd>
            <dt>Region</dt>
            <dd>{server.region_name ?? '—'}</dd>
            <dt>Datacenter</dt>
            <dd>{server.datacenter_name ?? 'Automatic'}</dd>
            <dt>CPU</dt>
            <dd>{server.cpu_cores} vCPU</dd>
            <dt>RAM</dt>
            <dd>{Math.round(server.memory_mb / 1024)} GB</dd>
            <dt>Storage</dt>
            <dd>{Math.round(server.storage_mb / 1024)} GB</dd>
            <dt>Bandwidth</dt>
            <dd>{server.bandwidth_gb ? `${server.bandwidth_gb} GB` : '—'}</dd>
            <dt>Created</dt>
            <dd>{new Date(server.created_at).toLocaleDateString()}</dd>
            <dt>Renewal</dt>
            <dd>{server.renewal_date ? new Date(server.renewal_date).toLocaleDateString() : '—'}</dd>
          </dl>
        </article>

        <article className="ch247-card">
          <h2>Actions & Operations</h2>
          <div className="ch247-actions">
            {(['start', 'stop', 'reboot', 'shutdown'] as const).map(
              (name) =>
                server.capabilities?.[name] === true && (
                  <button
                    key={name}
                    type="button"
                    className="ch247-btn"
                    disabled={busy !== '' || !!runningJob}
                    onClick={() => void action(name)}
                  >
                    {name[0]?.toUpperCase()}
                    {name.slice(1)}
                  </button>
                )
            )}
            {server.capabilities?.snapshot === true && (
              <button
                type="button"
                className="ch247-btn"
                disabled={busy !== '' || !!runningJob}
                onClick={() => setShowSnapshotModal(true)}
              >
                Create Snapshot
              </button>
            )}
            {server.capabilities?.reinstall === true && (
              <button
                type="button"
                className="ch247-btn ch247-btn--danger"
                disabled={busy !== '' || !!runningJob}
                onClick={() => setShowReinstall(true)}
              >
                Reinstall OS
              </button>
            )}
          </div>
          <p className="ch247-page__hint">
            Only operations supported by this provider and product are shown. Every operation runs through the queue worker and is audit logged.
          </p>
        </article>
      </section>

      {/* Firewall & Security Group Rules */}
      <section className="ch247-card">
        <div className="ch247-section-heading">
          <div>
            <span className="ch247-eyebrow">Network Security</span>
            <h2>Firewall & Port Rules</h2>
          </div>
          <button
            type="button"
            className="ch247-btn ch247-btn--secondary"
            disabled={busy !== ''}
            onClick={handleApplyBaselineFirewall}
          >
            Apply Baseline Rules for {server.control_panel_name ?? 'Server'}
          </button>
        </div>

        <form className="ch247-card ch247-form" style={{ marginTop: '1rem' }} onSubmit={handleAddFirewallRule}>
          <h3>+ Add Firewall Inbound Port</h3>
          <div className="ch247-form-grid">
            <label className="ch247-field">
              <span>Port</span>
              <input
                type="number"
                required
                placeholder="e.g. 443 or 8080"
                value={newRulePort}
                onChange={(e) => setNewRulePort(e.target.value)}
              />
            </label>
            <label className="ch247-field">
              <span>Protocol</span>
              <select
                value={newRuleProtocol}
                onChange={(e) => setNewRuleProtocol(e.target.value as 'tcp' | 'udp')}
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </label>
            <label className="ch247-field">
              <span>Description / Purpose</span>
              <input
                placeholder="e.g. Custom Web App"
                value={newRuleDesc}
                onChange={(e) => setNewRuleDesc(e.target.value)}
              />
            </label>
          </div>
          <div className="ch247-actions">
            <button type="submit" className="ch247-btn ch247-btn--primary" disabled={busy !== ''}>
              Add Inbound Port
            </button>
          </div>
        </form>

        <div className="ch247-table-wrap" style={{ marginTop: '1rem' }}>
          <table className="ch247-table">
            <thead>
              <tr>
                <th>Protocol</th>
                <th>Port</th>
                <th>Direction</th>
                <th>Source</th>
                <th>Description</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {firewallRules.map((rule) => (
                <tr key={rule.id}>
                  <td><span className="ch247-badge">{rule.protocol.toUpperCase()}</span></td>
                  <td><strong>{rule.port_range_start}</strong></td>
                  <td>{rule.direction}</td>
                  <td><code>{rule.source_cidr}</code></td>
                  <td>{rule.description ?? '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="ch247-btn ch247-btn--sm ch247-btn--danger"
                      disabled={busy !== ''}
                      onClick={() => handleDeleteFirewallRule(rule.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {firewallRules.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: '#64748b' }}>
                    No custom firewall rules configured. Click "Apply Baseline Rules" above to setup default security.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showSnapshotModal && (
        <section className="ch247-card">
          <h2>Create Server Snapshot</h2>
          <p className="ch247-page__hint">
            Take a point-in-time image snapshot of your server disk volume.
          </p>
          <label className="ch247-field">
            <span>Snapshot Description</span>
            <input
              placeholder="e.g. Pre-upgrade backup"
              value={snapshotDesc}
              onChange={(e) => setSnapshotDesc(e.target.value)}
            />
          </label>
          <div className="ch247-actions">
            <button
              type="button"
              className="ch247-btn ch247-btn--primary"
              disabled={busy !== ''}
              onClick={createSnapshot}
            >
              Create Snapshot
            </button>
            <button type="button" className="ch247-btn" onClick={() => setShowSnapshotModal(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {showReinstall && (
        <section className="ch247-card ch247-destructive-panel">
          <span className="ch247-eyebrow">Destructive operation</span>
          <h2>Reinstall operating system</h2>
          <div className="ch247-banner ch247-banner--error">
            <strong>WARNING</strong>
            <br />
            Reinstalling the operating system will erase the current operating-system data on this server. Make sure important data has been backed up. This action cannot be undone.
          </div>
          {configuration === null ? (
            <CatalogLoadingBanner label="Loading verified reinstall images…" />
          ) : (
            <div className="ch247-form-grid">
              <label className="ch247-field">
                New operating system
                <select
                  value={targetOs}
                  onChange={(event) => {
                    setTargetOs(event.target.value);
                    setTargetVersion('');
                  }}
                >
                  {reinstallSystems.map((os) => (
                    <option key={os.id} value={os.id}>
                      {os.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ch247-field">
                Version
                <select
                  value={targetVersion}
                  onChange={(event) => setTargetVersion(event.target.value)}
                >
                  {reinstallSystems
                    .find((os) => os.id === targetOs)
                    ?.versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <label className="ch247-field">
                Architecture
                <select
                  value={targetArchitecture}
                  onChange={(event) =>
                    setTargetArchitecture(event.target.value as 'x86_64' | 'arm64')
                  }
                >
                  {reinstallSystems
                    .find((os) => os.id === targetOs)
                    ?.versions.find((version) => version.id === targetVersion)
                    ?.architectures.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}
          <label className="ch247-field">
            Type <strong>REINSTALL</strong> to confirm
            <input value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </label>
          <div className="ch247-actions">
            <button type="button" className="ch247-btn" onClick={() => setShowReinstall(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="ch247-btn ch247-btn--danger"
              disabled={confirm !== 'REINSTALL' || busy !== '' || !targetVersion}
              onClick={() => void reinstall()}
            >
              {busy === 'reinstall' ? 'Queueing…' : 'Erase and reinstall'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
