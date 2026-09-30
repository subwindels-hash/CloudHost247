import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import OperatingSystemSelector from '../components/OperatingSystemSelector';
import { usePageMeta } from '../lib/usePageMeta';
import {
  addSshKey,
  fetchServerConfiguration,
  fetchServerPlans,
  fetchSshKeys,
  orderServer,
  type AvailableOperatingSystem,
  type ServerConfiguration,
  type ServerPlan,
  type SshKey,
} from '../lib/infrastructure-api';

interface LocationChoice { providerId: string; providerName: string; regionId: string; regionName: string; datacenterId: string | null; datacenterName: string | null }

function locationValue(location: LocationChoice) {
  return [location.providerId,location.regionId,location.datacenterId ?? 'region'].join(':');
}

export default function NewServerPage() {
  usePageMeta('Deploy a server','Choose a verified operating-system image for a CloudHost247 server.');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [plans,setPlans] = useState<ServerPlan[] | null>(null);
  const [planId,setPlanId] = useState(params.get('planId') ?? '');
  const [serverType,setServerType] = useState<'VPS'|'DEDICATED'|'CLOUD'>('VPS');
  const [configuration,setConfiguration] = useState<ServerConfiguration | null>(null);
  const [locationKey,setLocationKey] = useState('');
  const [osId,setOsId] = useState('');
  const [versionId,setVersionId] = useState('');
  const [architecture,setArchitecture] = useState<'x86_64'|'arm64'>('x86_64');
  const [controlPanelId,setControlPanelId] = useState('');
  const [billingPeriod,setBillingPeriod] = useState('monthly');
  const [hostname,setHostname] = useState('');
  const [sshKeys,setSshKeys] = useState<SshKey[]>([]);
  const [sshKeyId,setSshKeyId] = useState('');
  const [newKey,setNewKey] = useState({ name: '',publicKey: '' });
  const [showKeyForm,setShowKeyForm] = useState(false);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);

  useEffect(() => {
    fetchServerPlans().then(({ plans: rows }) => {
      setPlans(rows);
      const initial = rows.find((plan) => plan.id === planId) ?? rows[0];
      if (initial) {
        setPlanId(initial.id);
        setServerType(initial.serverTypes[0] ?? 'VPS');
        setBillingPeriod(initial.pricing[0]?.billingPeriod ?? 'monthly');
      }
    }).catch((cause: Error) => setError(cause.message));
    fetchSshKeys().then(({ sshKeys: rows }) => {
      setSshKeys(rows);
      setSshKeyId(rows[0]?.id ?? '');
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!planId) return;
    setConfiguration(null);
    setError('');
    fetchServerConfiguration(planId,serverType).then((result) => setConfiguration(result)).catch((cause: Error) => setError(cause.message));
  }, [planId,serverType]);

  const selectedPlan = plans?.find((plan) => plan.id === planId) ?? null;
  const locations = useMemo<LocationChoice[]>(() => {
    const choices: LocationChoice[] = [];
    for (const region of configuration?.regions ?? []) {
      if (region.regionWideAvailable) choices.push({ providerId: region.provider.id,providerName: region.provider.name,regionId: region.id,regionName: region.name,datacenterId: null,datacenterName: null });
      for (const datacenter of region.datacenters) choices.push({ providerId: region.provider.id,providerName: region.provider.name,regionId: region.id,regionName: region.name,datacenterId: datacenter.id,datacenterName: datacenter.name });
    }
    return choices;
  },[configuration]);

  useEffect(() => {
    if (!locations.some((location) => locationValue(location) === locationKey)) setLocationKey(locations[0] ? locationValue(locations[0]) : '');
  },[locations,locationKey]);
  const location = locations.find((item) => locationValue(item) === locationKey) ?? null;

  const systems = useMemo<AvailableOperatingSystem[]>(() => {
    if (!location) return [];
    return (configuration?.operatingSystems ?? []).map((os) => ({
      ...os,
      versions: os.versions.filter((version) => version.availability.some((available) =>
        available.providerId === location.providerId && available.regionId === location.regionId &&
        (location.datacenterId ? available.datacenterId === location.datacenterId : available.datacenterId === null)
      )),
    })).filter((os) => os.versions.length > 0);
  },[configuration,location]);

  useEffect(() => {
    const currentOs = systems.find((os) => os.id === osId) ?? systems[0];
    if (!currentOs) { setOsId('');setVersionId('');return; }
    if (currentOs.id !== osId) setOsId(currentOs.id);
    const currentVersion = currentOs.versions.find((version) => version.id === versionId)
      ?? currentOs.versions.find((version) => version.default)
      ?? currentOs.versions.find((version) => version.recommended)
      ?? currentOs.versions[0];
    if (currentVersion && currentVersion.id !== versionId) setVersionId(currentVersion.id);
    if (currentVersion && !currentVersion.architectures.includes(architecture)) setArchitecture(currentVersion.architectures[0] ?? 'x86_64');
  },[systems,osId,versionId,architecture]);

  const compatibleControlPanels = useMemo(() => (configuration?.controlPanels ?? []).filter((panel) =>
    panel.availability.some((item) => item.operatingSystemVersionId===versionId && item.architecture===architecture)
  ),[configuration,versionId,architecture]);

  useEffect(() => {
    const targetSlug = params.get('panel');
    if (targetSlug && configuration?.controlPanels) {
      const match = configuration.controlPanels.find((p) => p.slug === targetSlug || p.id === targetSlug);
      if (match && !controlPanelId) {
        setControlPanelId(match.id);
      }
    }
  }, [configuration, params, controlPanelId]);

  useEffect(() => {
    if (controlPanelId && !compatibleControlPanels.some((panel) => panel.id===controlPanelId)) setControlPanelId('');
  },[compatibleControlPanels,controlPanelId]);

  async function saveKey(event: FormEvent) {
    event.preventDefault();
    setBusy(true);setError('');
    try {
      const { sshKey } = await addSshKey(newKey.name,newKey.publicKey);
      setSshKeys((current) => [sshKey,...current]);setSshKeyId(sshKey.id);setShowKeyForm(false);setNewKey({ name: '',publicKey: '' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save SSH key'); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!location || !versionId || !sshKeyId) { setError('Complete the location, operating system, and SSH key selections.');return; }
    setBusy(true);setError('');
    try {
      const result = await orderServer({
        planId,billingPeriod,providerId: location.providerId,regionId: location.regionId,datacenterId: location.datacenterId,
        operatingSystemVersionId: versionId,architecture,serverType,sshKeyIds: [sshKeyId],hostname,
        controlPanelId: controlPanelId || null,
      });
      navigate(result.paymentRequired ? `/invoices/${result.invoiceId}` : `/dashboard/servers/${result.serverId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create the server order'); }
    finally { setBusy(false); }
  }

  if (plans === null && !error) return <CatalogLoadingBanner label="Loading server plans…" />;
  if (plans?.length === 0) return <div className="ch247-card"><h1>Deploy a server</h1><p className="ch247-banner ch247-banner--warning">No server plan currently has a verified provider image. Ask an administrator to finish infrastructure configuration.</p></div>;

  return (
    <form className="ch247-stack" onSubmit={submit}>
      <section className="ch247-card ch247-order-heading">
        <div><span className="ch247-eyebrow">New infrastructure</span><h1>Deploy a server</h1><p className="ch247-page__hint">Your server is queued only after verified payment. Provider image identifiers stay private.</p></div>
        <Link to="/dashboard/servers">Back to servers</Link>
      </section>
      {error && <CatalogErrorBanner message={error} />}

      <section className="ch247-card">
        <h2>1. Plan &amp; billing</h2>
        <div className="ch247-form-grid">
          <label className="ch247-field">Server plan<select value={planId} onChange={(event) => {
            const next = plans?.find((plan) => plan.id === event.target.value);setPlanId(event.target.value);if(next){setServerType(next.serverTypes[0]??'VPS');setBillingPeriod(next.pricing[0]?.billingPeriod??'monthly');}
          }}>{plans?.map((plan) => <option key={plan.id} value={plan.id}>{plan.product.name} — {plan.name}</option>)}</select></label>
          <label className="ch247-field">Server type<select value={serverType} onChange={(event) => setServerType(event.target.value as typeof serverType)}>{selectedPlan?.serverTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label className="ch247-field">Billing period<select value={billingPeriod} onChange={(event) => setBillingPeriod(event.target.value)}>{selectedPlan?.pricing.map((price) => <option key={price.billingPeriod} value={price.billingPeriod}>{price.billingPeriod.replace('_',' ')} — {price.currency} {price.amount}{price.setupFee && Number(price.setupFee)>0?` + ${price.setupFee} setup`:''}</option>)}</select></label>
        </div>
      </section>

      <section className="ch247-card">
        <h2>2. Location</h2>
        {configuration === null ? <CatalogLoadingBanner label="Resolving available regions and images…" /> : locations.length === 0 ? <p className="ch247-banner ch247-banner--warning">This plan has no available provider/region combinations.</p> : <label className="ch247-field">Region &amp; datacenter<select value={locationKey} onChange={(event) => setLocationKey(event.target.value)}>{locations.map((item) => <option key={locationValue(item)} value={locationValue(item)}>{item.regionName}{item.datacenterName?` — ${item.datacenterName}`:''} · {item.providerName}</option>)}</select></label>}
      </section>

      <section className="ch247-card">
        <span className="ch247-step-number">3</span>
        <OperatingSystemSelector operatingSystems={systems} selectedOsId={osId} selectedVersionId={versionId} selectedArchitecture={architecture} onOsChange={setOsId} onVersionChange={setVersionId} onArchitectureChange={setArchitecture} />
      </section>

      <section className="ch247-card">
        <h2>4. Access &amp; hostname</h2>
        <div className="ch247-form-grid">
          <label className="ch247-field">Hostname<input required value={hostname} onChange={(event) => setHostname(event.target.value.toLowerCase())} placeholder="vps-01.example.com" /></label>
          <label className="ch247-field">SSH key<select required value={sshKeyId} onChange={(event) => setSshKeyId(event.target.value)}><option value="">Select a key</option>{sshKeys.map((key) => <option key={key.id} value={key.id}>{key.name} · {key.fingerprint}</option>)}</select></label>
          <label className="ch247-field">Control panel<select value={controlPanelId} onChange={(event)=>setControlPanelId(event.target.value)}><option value="">None</option>{compatibleControlPanels.map((panel)=><option key={panel.id} value={panel.id}>{panel.name}</option>)}</select><small>Only panels compatible with this OS version and architecture are shown.</small></label>
        </div>
        <button type="button" className="ch247-btn" onClick={() => setShowKeyForm((current) => !current)}>{showKeyForm?'Cancel':'Add SSH key'}</button>
        {showKeyForm && <div className="ch247-inline-key-form"><label className="ch247-field">Key name<input value={newKey.name} onChange={(event) => setNewKey({ ...newKey,name: event.target.value })} /></label><label className="ch247-field">OpenSSH public key<textarea rows={3} value={newKey.publicKey} onChange={(event) => setNewKey({ ...newKey,publicKey: event.target.value })} /></label><button type="button" className="ch247-btn" disabled={busy} onClick={(event) => void saveKey(event as unknown as FormEvent)}>Save key</button></div>}
      </section>

      <section className="ch247-card ch247-order-review">
        <div><h2>Review</h2><p>{selectedPlan?.name} · {location?.regionName ?? 'Choose a region'} · {systems.find((os) => os.id===osId)?.versions.find((version)=>version.id===versionId)?.displayName ?? 'Choose an OS'} · {architecture}</p><p className="ch247-page__hint">Payment creates a durable provisioning job. The server is not marked ready until health checks pass.</p></div>
        <button className="ch247-btn ch247-btn--primary" type="submit" disabled={busy || !location || !versionId || !sshKeyId}>{busy?'Creating secure order…':'Continue to payment'}</button>
      </section>
    </form>
  );
}
