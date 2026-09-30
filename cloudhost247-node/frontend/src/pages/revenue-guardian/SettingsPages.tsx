/**
 * Module settings (spec §69 — everything admin-configurable, stored in platform_settings) and
 * module health diagnostics (spec §70).
 */
import { useState } from 'react';
import RGLayout from '../../components/revenue-guardian/RGLayout';
import { MetricCard, MetricRow, RgBadge, RgLoad, formatDateTime, useRgData } from '../../components/revenue-guardian/rg-widgets';
import { rgPatch } from '../../lib/revenue-guardian-api';

interface SettingsData {
  settings: {
    enabled: boolean;
    timezone: string;
    reportingCurrency: string;
    overdueThresholdDays: number;
    upcomingInvoiceReminderDays: number[];
    overdueFollowupDays: number;
    renewalReminderDays: number[];
    preSuspensionAlertDays: number;
    preTerminationAlertDays: number;
    terminateAfterSuspensionDays: number;
    riskThresholds: { medium: number; high: number; critical: number };
    highValueThresholds: { lifetimeRevenue: number; recurringRevenue: number; activeServices: number };
    agingBuckets: number[];
    schedulerIntervalMinutes: number;
    whatsapp: { enabled: boolean; provider: string | null };
  };
  whatsappStatus: { state: string; provider: string | null };
}

function parseIntList(value: string): number[] {
  return value
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && v >= 0);
}

export function RGSettingsPage() {
  const { state, reload } = useRgData<SettingsData>('/settings');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await rgPatch('/settings', patch);
      setMessage('Saved.');
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <RGLayout title="Settings" hint="All thresholds and windows live in platform settings — nothing is hard-coded. Provider secrets are write-only and never returned to the browser.">
      {message ? <p className="ch247-page__hint" role="status">{message}</p> : null}
      <RgLoad state={state}>
        {(data) => <SettingsForm data={data} busy={busy} onSave={save} />}
      </RgLoad>
    </RGLayout>
  );
}

function SettingsForm({ data, busy, onSave }: { data: SettingsData; busy: boolean; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const s = data.settings;
  const [form, setForm] = useState({
    enabled: s.enabled,
    timezone: s.timezone,
    reportingCurrency: s.reportingCurrency,
    overdueThresholdDays: String(s.overdueThresholdDays),
    upcomingInvoiceReminderDays: s.upcomingInvoiceReminderDays.join(', '),
    overdueFollowupDays: String(s.overdueFollowupDays),
    renewalReminderDays: s.renewalReminderDays.join(', '),
    preSuspensionAlertDays: String(s.preSuspensionAlertDays),
    preTerminationAlertDays: String(s.preTerminationAlertDays),
    terminateAfterSuspensionDays: String(s.terminateAfterSuspensionDays),
    riskMedium: String(s.riskThresholds.medium),
    riskHigh: String(s.riskThresholds.high),
    riskCritical: String(s.riskThresholds.critical),
    hvLifetime: String(s.highValueThresholds.lifetimeRevenue),
    hvRecurring: String(s.highValueThresholds.recurringRevenue),
    hvServices: String(s.highValueThresholds.activeServices),
    agingBuckets: s.agingBuckets.join(', '),
    schedulerIntervalMinutes: String(s.schedulerIntervalMinutes),
    waEnabled: s.whatsapp.enabled,
    waProvider: s.whatsapp.provider ?? '',
    waSid: '',
    waToken: '',
    waFrom: '',
    waAccessToken: '',
    waPhoneId: '',
  });
  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="ch247-stack">
      <h3>Module</h3>
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
        <label><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Module enabled</label>
        <label>Timezone <input value={form.timezone} onChange={(e) => set('timezone', e.target.value)} /></label>
        <label>Reporting currency <input value={form.reportingCurrency} maxLength={3} onChange={(e) => set('reportingCurrency', e.target.value.toUpperCase())} style={{ width: '4rem' }} /></label>
        <label>Scheduler interval (min) <input value={form.schedulerIntervalMinutes} onChange={(e) => set('schedulerIntervalMinutes', e.target.value)} style={{ width: '4rem' }} /></label>
      </div>

      <h3>Recovery thresholds</h3>
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
        <label>Open case after (days overdue) <input value={form.overdueThresholdDays} onChange={(e) => set('overdueThresholdDays', e.target.value)} style={{ width: '4rem' }} /></label>
        <label>Staff follow-up after (days overdue) <input value={form.overdueFollowupDays} onChange={(e) => set('overdueFollowupDays', e.target.value)} style={{ width: '4rem' }} /></label>
        <label>Invoice reminders (days before due) <input value={form.upcomingInvoiceReminderDays} onChange={(e) => set('upcomingInvoiceReminderDays', e.target.value)} style={{ width: '9rem' }} /></label>
        <label>Renewal reminders (days before expiry) <input value={form.renewalReminderDays} onChange={(e) => set('renewalReminderDays', e.target.value)} style={{ width: '11rem' }} /></label>
      </div>
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
        <label>Pre-suspension alert (days) <input value={form.preSuspensionAlertDays} onChange={(e) => set('preSuspensionAlertDays', e.target.value)} style={{ width: '4rem' }} /></label>
        <label>Pre-termination alert (days) <input value={form.preTerminationAlertDays} onChange={(e) => set('preTerminationAlertDays', e.target.value)} style={{ width: '4rem' }} /></label>
        <label>Terminate after suspension (days) <input value={form.terminateAfterSuspensionDays} onChange={(e) => set('terminateAfterSuspensionDays', e.target.value)} style={{ width: '4rem' }} /></label>
        <label>Aging buckets <input value={form.agingBuckets} onChange={(e) => set('agingBuckets', e.target.value)} style={{ width: '9rem' }} /></label>
      </div>

      <h3>Risk & high-value thresholds</h3>
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
        <label>Risk medium ≥ <input value={form.riskMedium} onChange={(e) => set('riskMedium', e.target.value)} style={{ width: '4rem' }} /></label>
        <label>high ≥ <input value={form.riskHigh} onChange={(e) => set('riskHigh', e.target.value)} style={{ width: '4rem' }} /></label>
        <label>critical ≥ <input value={form.riskCritical} onChange={(e) => set('riskCritical', e.target.value)} style={{ width: '4rem' }} /></label>
        <label>HV lifetime ≥ <input value={form.hvLifetime} onChange={(e) => set('hvLifetime', e.target.value)} style={{ width: '5rem' }} /></label>
        <label>HV monthly ≥ <input value={form.hvRecurring} onChange={(e) => set('hvRecurring', e.target.value)} style={{ width: '5rem' }} /></label>
        <label>HV services ≥ <input value={form.hvServices} onChange={(e) => set('hvServices', e.target.value)} style={{ width: '4rem' }} /></label>
      </div>

      <h3>WhatsApp (optional — fails closed when unconfigured)</h3>
      <p className="ch247-page__hint">Current status: <RgBadge value={data.whatsappStatus.state === 'READY' ? 'active' : data.whatsappStatus.state === 'DISABLED' ? 'pending' : 'failed'} /> {data.whatsappStatus.state}{data.whatsappStatus.provider ? ` (${data.whatsappStatus.provider})` : ''}. Credentials are write-only.</p>
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
        <label><input type="checkbox" checked={form.waEnabled} onChange={(e) => set('waEnabled', e.target.checked)} /> Enabled</label>
        <select value={form.waProvider} onChange={(e) => set('waProvider', e.target.value)}>
          <option value="">Provider…</option>
          <option value="twilio">Twilio</option>
          <option value="meta">Meta Cloud API</option>
        </select>
        {form.waProvider === 'twilio' ? (
          <>
            <input placeholder="Account SID" value={form.waSid} onChange={(e) => set('waSid', e.target.value)} />
            <input placeholder="Auth token" type="password" value={form.waToken} onChange={(e) => set('waToken', e.target.value)} />
            <input placeholder="From number (+123…)" value={form.waFrom} onChange={(e) => set('waFrom', e.target.value)} />
          </>
        ) : null}
        {form.waProvider === 'meta' ? (
          <>
            <input placeholder="Access token" type="password" value={form.waAccessToken} onChange={(e) => set('waAccessToken', e.target.value)} />
            <input placeholder="Phone number ID" value={form.waPhoneId} onChange={(e) => set('waPhoneId', e.target.value)} />
          </>
        ) : null}
      </div>

      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const whatsapp: Record<string, unknown> = { enabled: form.waEnabled, provider: form.waProvider || null };
            if (form.waSid) whatsapp['accountSid'] = form.waSid;
            if (form.waToken) whatsapp['authToken'] = form.waToken;
            if (form.waFrom) whatsapp['fromNumber'] = form.waFrom;
            if (form.waAccessToken) whatsapp['accessToken'] = form.waAccessToken;
            if (form.waPhoneId) whatsapp['phoneNumberId'] = form.waPhoneId;
            void onSave({
              enabled: form.enabled,
              timezone: form.timezone,
              reportingCurrency: form.reportingCurrency,
              overdueThresholdDays: Number(form.overdueThresholdDays),
              overdueFollowupDays: Number(form.overdueFollowupDays),
              upcomingInvoiceReminderDays: parseIntList(form.upcomingInvoiceReminderDays),
              renewalReminderDays: parseIntList(form.renewalReminderDays),
              preSuspensionAlertDays: Number(form.preSuspensionAlertDays),
              preTerminationAlertDays: Number(form.preTerminationAlertDays),
              terminateAfterSuspensionDays: Number(form.terminateAfterSuspensionDays),
              riskThresholds: { medium: Number(form.riskMedium), high: Number(form.riskHigh), critical: Number(form.riskCritical) },
              highValueThresholds: { lifetimeRevenue: Number(form.hvLifetime), recurringRevenue: Number(form.hvRecurring), activeServices: Number(form.hvServices) },
              agingBuckets: parseIntList(form.agingBuckets),
              schedulerIntervalMinutes: Number(form.schedulerIntervalMinutes),
              whatsapp,
            });
          }}
        >
          Save settings
        </button>
      </div>
    </div>
  );
}

interface HealthData {
  database: string;
  moduleEnabled: boolean;
  billingIntegration: { invoices: number; ledgerEntries: number; state: string };
  paymentIntegration: { payments: number; state: string };
  emailIntegration: { state: string; pendingOutbox: number; failedOutbox: number };
  whatsappIntegration: { state: string; provider: string | null };
  scheduler: { lastSuccessfulRun: string | null; lastFailedRun: string | null; runningJobs: number; failedRuns24h: number; completedRuns24h: number };
  workflow: { openCases: number; pendingFollowUps: number; pendingPromises: number };
}

export function ModuleHealthPage() {
  const { state } = useRgData<HealthData>('/health');
  return (
    <RGLayout title="Module Health" hint="Read-only diagnostics: database, billing/payment integration, email pipeline, WhatsApp, and scheduler state.">
      <RgLoad state={state}>
        {(h) => (
          <div className="ch247-stack">
            <MetricRow>
              <MetricCard label="Database" value={<RgBadge value={h.database === 'ok' ? 'active' : 'failed'} />} />
              <MetricCard label="Module" value={<RgBadge value={h.moduleEnabled ? 'active' : 'cancelled'} />} />
              <MetricCard label="Billing integration" value={<RgBadge value={h.billingIntegration.state === 'ok' ? 'active' : 'pending'} />} hint={`${h.billingIntegration.invoices} invoices · ${h.billingIntegration.ledgerEntries} ledger entries`} />
              <MetricCard label="Payments" value={<RgBadge value={h.paymentIntegration.state === 'ok' ? 'active' : 'pending'} />} hint={`${h.paymentIntegration.payments} payment records`} />
            </MetricRow>
            <MetricRow>
              <MetricCard label="Email pipeline" value={<RgBadge value={h.emailIntegration.state === 'ok' ? 'active' : 'failed'} />} hint={`${h.emailIntegration.pendingOutbox} pending · ${h.emailIntegration.failedOutbox} failed`} />
              <MetricCard label="WhatsApp" value={<RgBadge value={h.whatsappIntegration.state === 'READY' ? 'active' : h.whatsappIntegration.state === 'DISABLED' ? 'pending' : 'failed'} />} hint={h.whatsappIntegration.state} />
              <MetricCard label="Scheduler — last success" value={formatDateTime(h.scheduler.lastSuccessfulRun)} hint={`${h.scheduler.completedRuns24h} completed / ${h.scheduler.failedRuns24h} failed in 24h · ${h.scheduler.runningJobs} running`} />
            </MetricRow>
            <MetricRow>
              <MetricCard label="Open cases" value={h.workflow.openCases} />
              <MetricCard label="Pending follow-ups" value={h.workflow.pendingFollowUps} />
              <MetricCard label="Pending promises" value={h.workflow.pendingPromises} />
            </MetricRow>
          </div>
        )}
      </RgLoad>
    </RGLayout>
  );
}
