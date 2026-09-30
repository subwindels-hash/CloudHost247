/**
 * Automation control (spec §18–§21): job list with honest last-run info + permission-gated
 * "Run now" (server-locked against double execution), rules, and full run history.
 */
import { useState } from 'react';
import RGLayout from '../../components/revenue-guardian/RGLayout';
import {
  formatDateTime,
  Paginator,
  RgBadge,
  RgLoad,
  RgTable,
  useRgData,
} from '../../components/revenue-guardian/rg-widgets';
import { rgPost, type Paginated } from '../../lib/revenue-guardian-api';

interface JobsData {
  jobs: Array<{ name: string; description: string; lastSuccessfulRun: string | null; lastFailedRun: string | null }>;
  schedulerIntervalMinutes: number;
  enabled: boolean;
  timezone: string;
}

export function AutomationPage() {
  const { state, reload } = useRgData<JobsData>('/automation/jobs');
  const [message, setMessage] = useState('');
  const [busyJob, setBusyJob] = useState('');

  async function runNow(name: string) {
    setBusyJob(name);
    setMessage('');
    try {
      const outcome = await rgPost<{ status: string; result?: { processed: number; created: number; skipped: number; failed: number; notificationsSent: number } }>(`/automation/jobs/${name}/run`);
      if (outcome.result) {
        setMessage(`${name}: processed ${outcome.result.processed}, created ${outcome.result.created}, skipped ${outcome.result.skipped}, failed ${outcome.result.failed}, notifications queued ${outcome.result.notificationsSent}.`);
      } else {
        setMessage(`${name}: ${outcome.status}`);
      }
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setBusyJob('');
    }
  }

  return (
    <RGLayout title="Automation" hint="Jobs run in the background worker under database locks — never inside a web request, never twice for the same schedule bucket.">
      <RgLoad state={state}>
        {(data) => (
          <>
            <p className="ch247-page__hint">
              Module {data.enabled ? 'ENABLED' : 'DISABLED'} · cycle every {data.schedulerIntervalMinutes} min · timezone {data.timezone} (configurable in Settings).
            </p>
            {message ? <p className="ch247-page__hint" role="status">{message}</p> : null}
            <RgTable
              empty="No jobs registered."
              columns={[
                { header: 'Job', render: (j: JobsData['jobs'][number]) => j.name },
                { header: 'Description', render: (j) => j.description },
                { header: 'Last success', render: (j) => formatDateTime(j.lastSuccessfulRun) },
                { header: 'Last failure', render: (j) => formatDateTime(j.lastFailedRun) },
                {
                  header: 'Actions',
                  render: (j) => (
                    <button type="button" disabled={busyJob !== ''} onClick={() => runNow(j.name)}>
                      {busyJob === j.name ? 'Running…' : 'Run now'}
                    </button>
                  ),
                },
              ]}
              rows={data.jobs}
            />
          </>
        )}
      </RgLoad>
    </RGLayout>
  );
}

interface RunRow {
  id: string;
  job_name: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  processed_count: number;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  notifications_sent: number;
  error: string | null;
}

export function AutomationRunsPage() {
  const [page, setPage] = useState(1);
  const [jobName, setJobName] = useState('');
  const [status, setStatus] = useState('');
  const { state } = useRgData<Paginated<RunRow>>('/automation/runs', {
    page,
    limit: 50,
    jobName: jobName || undefined,
    status: status || undefined,
  });
  return (
    <RGLayout title="Automation Runs" hint="Complete execution history: when, what trigger, how many records were touched, and any errors.">
      <div className="ch247-inline-actions" style={{ marginBottom: '0.75rem' }}>
        <input placeholder="Filter by job name" value={jobName} onChange={(e) => { setJobName(e.target.value); setPage(1); }} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Any status</option>
          {['running', 'completed', 'failed'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <RgLoad state={state}>
        {(data) => (
          <>
            <RgTable
              empty="No runs recorded yet — the worker will populate this on its next cycle."
              columns={[
                { header: 'Job', render: (r: RunRow) => r.job_name },
                { header: 'Trigger', render: (r) => r.trigger },
                { header: 'Status', render: (r) => <RgBadge value={r.status} /> },
                { header: 'Started', render: (r) => formatDateTime(r.started_at) },
                { header: 'Duration', render: (r) => (r.duration_ms !== null ? `${r.duration_ms} ms` : '—') },
                { header: 'Processed', render: (r) => r.processed_count },
                { header: 'Created', render: (r) => r.created_count },
                { header: 'Skipped', render: (r) => r.skipped_count },
                { header: 'Failed', render: (r) => r.failed_count },
                { header: 'Notices queued', render: (r) => r.notifications_sent },
                { header: 'Error', render: (r) => r.error ?? '—' },
              ]}
              rows={data.items}
            />
            <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </RgLoad>
    </RGLayout>
  );
}
