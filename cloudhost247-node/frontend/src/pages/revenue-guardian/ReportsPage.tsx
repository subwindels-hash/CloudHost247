import { useState } from 'react';
import RGLayout from '../../components/revenue-guardian/RGLayout';
import { RgTable } from '../../components/revenue-guardian/rg-widgets';
import { rgExportCsv, rgPost } from '../../lib/revenue-guardian-api';

const REPORT_TYPES = [
  { value: 'revenue_recovery', label: 'Revenue recovery (cases, outstanding vs recovered)' },
  { value: 'revenue_at_risk', label: 'Revenue at risk (customers with unpaid invoices)' },
  { value: 'payment_promises', label: 'Payment promises (kept vs broken)' },
  { value: 'renewals', label: 'Upcoming renewals (projected)' },
  { value: 'collection_activity', label: 'Collection activity (follow-ups)' },
  { value: 'staff_performance', label: 'Staff performance (managers only)' },
];

interface ReportResult {
  reportType: string;
  generatedAt: string;
  generatedBy: string;
  reportingCurrencyNote: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  valueClassifications: Record<string, string>;
}

export default function ReportsPage() {
  const [reportType, setReportType] = useState('revenue_recovery');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [report, setReport] = useState<ReportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const payload = () => ({
    reportType,
    dateFrom: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined,
    dateTo: dateTo ? `${dateTo}T23:59:59.000Z` : undefined,
  });

  async function run() {
    setBusy(true);
    setError('');
    try {
      setReport(await rgPost<ReportResult>('/reports/run', payload()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report failed');
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setBusy(true);
    setError('');
    try {
      const blob = await rgExportCsv({ ...payload(), format: 'csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `revenue-guardian-${reportType}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <RGLayout title="Reports" hint="Reports use the same queries as the on-screen pages. Money columns carry an explicit classification (ACTUAL / RECOVERED / OUTSTANDING / AT RISK / PROJECTED). CSV opens directly in Excel; use the browser's print for PDF.">
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
          {REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <label>From <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label>To <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
        <button type="button" disabled={busy} onClick={run}>Run report</button>
        <button type="button" disabled={busy} onClick={exportCsv}>Export CSV</button>
        {report ? <button type="button" onClick={() => window.print()}>Print / PDF</button> : null}
      </div>
      {error ? <p className="ch247-page__hint" role="alert">Error: {error}</p> : null}
      {report ? (
        <>
          <p className="ch247-page__hint">
            Generated {report.generatedAt} by {report.generatedBy}. {report.reportingCurrencyNote}
            {Object.keys(report.valueClassifications).length > 0
              ? ` Classifications: ${Object.entries(report.valueClassifications).map(([c, v]) => `${c}=${v}`).join(', ')}.`
              : ''}
          </p>
          <RgTable
            empty="The report returned no rows."
            columns={report.columns.map((col) => ({ header: col.replace(/_/g, ' '), render: (row: Record<string, unknown>) => String(row[col] ?? '—') }))}
            rows={report.rows}
          />
        </>
      ) : (
        <p className="ch247-page__hint">Choose a report and press "Run report".</p>
      )}
    </RGLayout>
  );
}
