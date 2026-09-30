/**
 * Customer Cloudflare service list + purchase flow (spec §7, §50, §53).
 * Ordering only creates an order + invoice — provisioning starts after payment confirmation.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RgBadge, RgTable, RgLoad, formatDateTime } from '../../components/revenue-guardian/rg-widgets';
import { cfSend, useCfData, type CloudflareServiceDTO, CF_FEATURE_LABELS } from '../../lib/cloudflare-api';

interface CatalogPlan {
  planId: string;
  planName: string;
  productName: string | null;
  cloudflarePlan: string;
  entitlements: Record<string, boolean>;
  pricing: Array<{ billingPeriod: string; amount: string; currency: string }>;
}

export default function CloudflareServicesPage() {
  const { state, reload } = useCfData<{ services: CloudflareServiceDTO[] }>('/api/v1/cloudflare/services');
  const catalog = useCfData<{ plans: CatalogPlan[] }>('/api/v1/cloudflare/catalog');
  const [showOrder, setShowOrder] = useState(false);
  const [planId, setPlanId] = useState('');
  const [billingPeriod, setBillingPeriod] = useState('monthly');
  const [domainName, setDomainName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function placeOrder() {
    setBusy(true);
    setMessage('');
    try {
      const res = await cfSend<{ invoice: { invoiceNumber: string }; message: string }>('POST', '/api/v1/cloudflare/orders', {
        planId,
        billingPeriod,
        domainName: domainName.trim().toLowerCase(),
      });
      setMessage(`${res.message} Invoice ${res.invoice.invoiceNumber} has been issued — pay it from Billing → Invoices.`);
      setShowOrder(false);
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Order failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h1>Cloudflare Services</h1>
            <p className="ch247-page__hint">DNS, CDN, SSL, security and performance for your domains — managed from your CloudHost247 account.</p>
          </div>
          <button type="button" onClick={() => setShowOrder((v) => !v)}>{showOrder ? 'Cancel' : '+ Order Cloudflare'}</button>
        </div>
        {message ? <p className="ch247-page__hint" role="status">{message}</p> : null}

        {showOrder ? (
          <RgLoad state={catalog.state}>
            {({ plans }) => (
              <div className="ch247-stack" style={{ marginTop: '0.75rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {plans.map((plan) => (
                    <div
                      key={plan.planId}
                      className="ch247-card"
                      style={{ flex: '1 1 14rem', cursor: 'pointer', outline: planId === plan.planId ? '2px solid currentColor' : 'none' }}
                      onClick={() => setPlanId(plan.planId)}
                    >
                      <h3>{plan.planName}</h3>
                      <p className="ch247-page__hint">Cloudflare {plan.cloudflarePlan}</p>
                      {plan.pricing.map((p) => (
                        <p key={p.billingPeriod}><strong>{p.amount} {p.currency}</strong> / {p.billingPeriod.replace(/_/g, ' ')}</p>
                      ))}
                      <ul style={{ fontSize: '0.85rem', paddingLeft: '1rem' }}>
                        {Object.entries(plan.entitlements).filter(([, v]) => v).slice(0, 6).map(([k]) => (
                          <li key={k}>{CF_FEATURE_LABELS[k] ?? k}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                {plans.length === 0 ? <p className="ch247-page__hint">No Cloudflare plans are available yet.</p> : null}
                <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
                  <input placeholder="Domain name (example.com)" value={domainName} onChange={(e) => setDomainName(e.target.value)} style={{ minWidth: '18rem' }} />
                  <select value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)}>
                    {['monthly', 'quarterly', 'semi_annually', 'annually'].map((p) => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
                  </select>
                  <button type="button" disabled={busy || !planId || !domainName.trim()} onClick={placeOrder}>Order &amp; get invoice</button>
                </div>
                <p className="ch247-page__hint">The service is provisioned automatically after payment is confirmed — never before.</p>
              </div>
            )}
          </RgLoad>
        ) : null}
      </div>

      <div className="ch247-card">
        <h2>Your services</h2>
        <RgLoad state={state}>
          {({ services }) => (
            <RgTable
              empty="No Cloudflare services yet."
              columns={[
                { header: 'Domain', render: (s: CloudflareServiceDTO) => <Link to={`/services/cloudflare/${s.id}`}>{s.zone_name}</Link> },
                { header: 'Plan', render: (s) => `${s.plan_name} (${s.cloudflare_plan})` },
                { header: 'Service', render: (s) => <RgBadge value={s.status} /> },
                { header: 'Zone', render: (s) => <RgBadge value={s.activation_status === 'active' ? 'active' : s.activation_status === 'error' ? 'failed' : 'pending'} /> },
                { header: 'DNS records', render: (s) => s.dns_record_count },
                { header: 'Last synced', render: (s) => formatDateTime(s.last_synced_at) },
              ]}
              rows={services}
            />
          )}
        </RgLoad>
      </div>
    </div>
  );
}
