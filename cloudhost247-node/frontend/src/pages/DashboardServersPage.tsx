import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import OsLifecycleNotice from '../components/OsLifecycleNotice';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import StatusBadge from '../components/StatusBadge';
import PlatformLogo from '../components/PlatformLogo';
import { fetchCustomerServers, readServerCancellation, type CustomerServer } from '../lib/infrastructure-api';
import { usePageMeta } from '../lib/usePageMeta';

/** Customer-owned VPS/cloud/dedicated resources. Platform deployment targets are intentionally
 * excluded from this screen even though the API returns them separately for the app scheduler. */
export default function DashboardServersPage() {
  usePageMeta('Servers','Your CloudHost247 infrastructure.');
  const [servers,setServers]=useState<CustomerServer[]|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{fetchCustomerServers().then((result)=>setServers(result.servers)).catch((cause:Error)=>setError(cause.message));},[]);
  return <div className="ch247-stack">
    <section className="ch247-card ch247-section-heading"><div><span className="ch247-eyebrow">Infrastructure</span><h1>Your servers</h1><p className="ch247-page__hint">Operating system, provisioning health, resources, and provider-backed actions in one place.</p></div><Link className="ch247-btn ch247-btn--primary" to="/servers/new">Deploy server</Link></section>
    {error&&<CatalogErrorBanner message={error}/>} {!servers&&!error&&<CatalogLoadingBanner label="Loading your servers…"/>}
    {servers?.length===0&&<section className="ch247-card ch247-empty-state"><span className="ch247-empty-state__icon">＋</span><h2>No servers yet</h2><p>Select a plan, region, and verified OS image to create your first server.</p><Link className="ch247-btn ch247-btn--primary" to="/servers/new">Deploy your first server</Link></section>}
    {servers&&servers.length>0&&<div className="ch247-server-grid">{servers.map((server)=><Link className="ch247-card ch247-server-card" to={`/dashboard/servers/${server.id}`} key={server.id}>
      <div className="ch247-server-card__top">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <PlatformLogo slug={server.os_slug ?? ''} name={server.os_name ?? 'Unknown operating system'} className="ch247-server-card__os-mark" />
          {server.control_panel_name && (
            <span className="ch247-panel-logo-sm" title={server.control_panel_name}>
              <PlatformLogo slug={server.control_panel_slug ?? ''} name={server.control_panel_name} className="ch247-panel-logo-sm__svg" compact />
            </span>
          )}
        </div>
        <StatusBadge status={server.status}/>
      </div>
      <h2>{server.name}</h2>
      <p className="ch247-server-card__os">
        {server.control_panel_name ? <strong style={{ color: 'var(--ch247-primary, #5f450a)' }}>{server.control_panel_name} · </strong> : null}
        {server.os_display_name??'Unknown operating system'} · {server.architecture??'—'} <OsLifecycleNotice compact status={server.os_version_status} displayName={server.os_display_name} endOfLifeDate={server.os_end_of_life_date}/>
      </p>
      <div className="ch247-server-card__ip"><small>PUBLIC IP</small><strong>{server.ip_address??(server.provisioning_status?.replace(/_/g,' ')??'Pending')}</strong></div>
      <dl className="ch247-server-card__specs"><div><dt>CPU</dt><dd>{server.cpu_cores} vCPU</dd></div><div><dt>RAM</dt><dd>{Math.round(server.memory_mb/1024)} GB</dd></div><div><dt>Storage</dt><dd>{Math.round(server.storage_mb/1024)} GB</dd></div></dl>
      {readServerCancellation(server)?.mode==='AT_PERIOD_END'&&<p className="ch247-server-card__cancelling">Cancels on {readServerCancellation(server)?.effectiveAt?new Date(readServerCancellation(server)!.effectiveAt!).toLocaleDateString():'the end of the paid term'}</p>}
      <div className="ch247-server-card__footer"><span>{server.region_name??'Region pending'}</span><span>View server →</span></div>
    </Link>)}</div>}
  </div>;
}
