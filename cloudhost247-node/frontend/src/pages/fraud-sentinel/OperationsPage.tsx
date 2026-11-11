/**
 * Operations — the module's own machinery: the four jobs, the run ledger, an on-demand scan, and the
 * settings that decide how much is looked at and how long it is kept.
 *
 * Two honest limitations are surfaced here rather than hidden:
 *
 *  * A manual run is guarded by a database-enforced `run_key` lock. Pressing Run twice in the same
 *    minute returns `locked`, which is not an error — it means the first pass still owns that bucket.
 *  * `POST /scan` assesses synchronously and writes no run row, so its report is shown here in full
 *    (including the sources it could not read) instead of being summarised into a counter.
 *
 * Settings are readable by every Fraud Sentinel viewer and writable only by a super administrator,
 * because they include the retention horizons — which drive deletion of evidence — and the scoring
 * thresholds, which change how every future score is computed.
 */
import { useState } from 'react';
import FSLayout from '../../components/fraud-sentinel/FSLayout';
import {
  AdvisoryNotice,
  FsBadge,
  FsLoad,
  FsTable,
  KeyValue,
  Paginator,
  formatDateTime,
  humanize,
  timeAgo,
  useFsData,
  useFsPermissions,
} from '../../components/fraud-sentinel/fs-widgets';
import {
  fsPatch,
  fsPost,
  type FsSettings,
  type JobRunOutcome,
  type Paginated,
  type RunRow,
  type ScanReport,
  type SettingsView,
} from '../../lib/fraud-sentinel-api';

interface RunsPageData extends Paginated<RunRow> {
  latestPerJob: RunRow[];
  jobs: Array<{ name: string; description: string }>;
}

export default function OperationsPage() {
  const permissions = useFsPermissions();
  const canRun = permissions.includes('fraud_sentinel.run_scan');
  const canEditSettings = permissions.includes('fraud_sentinel.settings');

  return (
    <FSLayout
      title="Operations"
      hint="Ingestion, scanning, retention and rule sync — what the module does on its own, what an administrator can trigger, and what each pass actually touched."
    >
      <div className="ch247-stack">
        <Jobs canRun={canRun} />
        <ScanNow canRun={canRun} />
        <Runs />
        <Settings canEdit={canEditSettings} />
      </div>
    </FSLayout>
  );
}

/* -------------------------------------------------------------------------- */
/* Jobs                                                                        */
/* -------------------------------------------------------------------------- */

function Jobs({ canRun }: { canRun: boolean }) {
  const runs = useFsData<RunsPageData>('/runs', { page: 1, limit: 1 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [outcomes, setOutcomes] = useState<Record<string, JobRunOutcome>>({});

  async function runJob(name: string) {
    setBusy(name);
    setError('');
    try {
      const outcome = await fsPost<JobRunOutcome>(`/jobs/${name}/run`);
      setOutcomes((previous) => ({ ...previous, [name]: outcome }));
      runs.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The job could not be started');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ch247-stack">
      <h3>Scheduled jobs</h3>
      <p className="ch247-page__hint">
        The worker sweep runs ingest → scan → retention → rule sync on its own interval. A manual run
        is refused while another pass holds the same bucket: the lock lives in the database, not in this
        page, so two administrators pressing the button at once cannot double the work.
      </p>
      {error ? <p className="ch247-page__hint" role="alert" style={{ color: '#a33' }}>{error}</p> : null}
      <FsLoad state={runs.state}>
        {(data) => (
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>What it does</th>
                  <th>Last run</th>
                  <th>Result</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((job) => {
                  const latest = data.latestPerJob.find((run) => run.job_name === job.name);
                  const outcome = outcomes[job.name];
                  return (
                    <tr key={job.name}>
                      <td><code>{job.name}</code></td>
                      <td className="ch247-page__hint" style={{ maxWidth: '32rem' }}>{job.description}</td>
                      <td className="ch247-page__hint">
                        {latest ? `${timeAgo(latest.started_at)} (${latest.trigger})` : 'never'}
                      </td>
                      <td>
                        {latest ? (
                          <span>
                            <FsBadge value={latest.status} />{' '}
                            <span className="ch247-page__hint">
                              {latest.duration_ms === null ? 'in progress' : `${latest.duration_ms} ms`}
                              {latest.error ? ` — ${latest.error}` : ''}
                            </span>
                          </span>
                        ) : (
                          <span className="ch247-page__hint">—</span>
                        )}
                      </td>
                      <td>
                        {canRun ? (
                          <button type="button" disabled={busy !== null} onClick={() => runJob(job.name)}>
                            {busy === job.name ? 'Running…' : 'Run now'}
                          </button>
                        ) : (
                          <span className="ch247-page__hint">needs run_scan</span>
                        )}
                        {outcome ? (
                          <div className="ch247-page__hint" style={{ marginTop: '0.25rem' }}>
                            <FsBadge value={outcome.status} />
                            <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1rem' }}>
                              {outcome.notes.map((note) => (
                                <li key={note}>{note}</li>
                              ))}
                              {outcome.error ? <li style={{ color: '#a33' }}>{outcome.error}</li> : null}
                              {outcome.result?.skippedSources?.map((source) => (
                                <li key={source.table} style={{ color: '#a33' }}>
                                  could not read <code>{source.table}</code>: {source.reason}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </FsLoad>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* On-demand scan                                                              */
/* -------------------------------------------------------------------------- */

function ScanNow({ canRun }: { canRun: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<ScanReport | null>(null);
  const [maxSubjects, setMaxSubjects] = useState('');

  async function scan() {
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const result = await fsPost<ScanReport>('/scan', undefined, {
        maxSubjects: maxSubjects.trim() ? Number(maxSubjects) : undefined,
      });
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The scan failed');
    } finally {
      setBusy(false);
    }
  }

  if (!canRun) {
    return (
      <div className="ch247-stack">
        <h3>Scan now</h3>
        <p className="ch247-page__hint">
          Your role cannot trigger a scan (<code>fraud_sentinel.run_scan</code> is required). Scheduled
          passes still run on their own.
        </p>
      </div>
    );
  }

  return (
    <div className="ch247-stack">
      <h3>Scan now</h3>
      <p className="ch247-page__hint">
        Runs one full pass synchronously: ingest the recorded rows, assess every active subject inside
        the lookback window, raise or update alerts. It writes assessments and alerts only — no
        payment, order, balance, entitlement or account state is touched, and no run-ledger row is
        written because nothing was queued.
      </p>
      {error ? <p className="ch247-page__hint" role="alert" style={{ color: '#a33' }}>{error}</p> : null}
      <div className="ch247-inline-actions">
        <input
          type="number"
          min={1}
          max={5000}
          value={maxSubjects}
          placeholder="Max subjects (default: scan_batch_size)"
          onChange={(event) => setMaxSubjects(event.target.value)}
          style={{ width: '16rem', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
        />
        <button type="button" disabled={busy} onClick={scan}>{busy ? 'Scanning…' : 'Run a full scan pass'}</button>
      </div>

      {report ? (
        <div className="ch247-card">
          <AdvisoryNotice advisory={report.advisory} compact />
          <KeyValue
            rows={[
              ['Module enabled', report.enabled ? 'yes' : <span style={{ color: '#a33' }}>no — fraud_sentinel.enabled is false, so the pass did nothing</span>],
              ['Started', formatDateTime(report.startedAt)],
              ['Finished', formatDateTime(report.finishedAt)],
              ['Duration', `${report.durationMs} ms`],
              ['Window', `${formatDateTime(report.window.startedAt)} → ${formatDateTime(report.window.endedAt)}`],
              ['Subjects considered', report.subjectsConsidered],
              ['Assessments stored', report.assessmentsCreated],
              ['Assessments unchanged', <span>{report.assessmentsUnchanged} <span className="ch247-page__hint">(same score and rules — nothing stored, nothing alerted)</span></span>],
              ['Alerts raised', report.alertsCreated],
              ['Alerts updated', report.alertsUpdated],
              ['Reviewer notifications', report.notificationsSent],
              ['Failures', report.failures.length],
            ]}
          />

          <h4>Ingestion by source</h4>
          <p className="ch247-page__hint">
            Scanned rows versus newly projected events. A row already in the ledger is excluded by the
            source query and refused by the unique dedupe key, so re-running is safe.
          </p>
          <FsTable<{ table: string; scanned: number; ingested: number }>
            columns={[
              { header: 'Source table', render: (entry) => <code>{entry.table}</code> },
              { header: 'Rows scanned', render: (entry) => entry.scanned },
              { header: 'Newly projected', render: (entry) => entry.ingested },
            ]}
            rows={report.ingestion.perTable}
            empty="No source table was read."
            keyOf={(entry) => entry.table}
          />
          <p className="ch247-page__hint">
            Total: {report.ingestion.scanned} row(s) scanned, {report.ingestion.ingested} event(s) projected.
          </p>

          {report.ingestion.skippedSources.length > 0 ? (
            <>
              <h4>Sources that could not be read</h4>
              <FsTable<{ table: string; reason: string }>
                columns={[
                  { header: 'Source table', render: (entry) => <code>{entry.table}</code> },
                  { header: 'Why it was skipped', render: (entry) => <span style={{ color: '#a33' }}>{entry.reason}</span> },
                ]}
                rows={report.ingestion.skippedSources}
                empty="Every source was read."
                keyOf={(entry) => entry.table}
              />
              <p className="ch247-page__hint">
                A skipped source means the rules that read it saw no evidence this pass. It is reported
                rather than ignored, because a score computed without a source is a weaker score.
              </p>
            </>
          ) : null}

          {report.failures.length > 0 ? (
            <>
              <h4>Subjects that failed to assess</h4>
              <FsTable<{ subjectType: string; subjectId: string; error: string }>
                columns={[
                  { header: 'Subject', render: (entry) => <span>{humanize(entry.subjectType)} · <code>{entry.subjectId}</code></span> },
                  { header: 'Error', render: (entry) => <span style={{ color: '#a33' }}>{entry.error}</span> },
                ]}
                rows={report.failures}
                empty="Every subject assessed cleanly."
                keyOf={(entry) => `${entry.subjectType}:${entry.subjectId}`}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Run ledger                                                                  */
/* -------------------------------------------------------------------------- */

function Runs() {
  const [page, setPage] = useState(1);
  const [jobName, setJobName] = useState('');
  const [status, setStatus] = useState('');
  const [trigger, setTrigger] = useState('');
  const limit = 25;

  const { state } = useFsData<RunsPageData>('/runs', {
    page,
    limit,
    jobName: jobName || undefined,
    status: status || undefined,
    trigger: trigger || undefined,
  });

  return (
    <div className="ch247-stack">
      <h3>Run ledger</h3>
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
        <select value={jobName} onChange={(event) => { setJobName(event.target.value); setPage(1); }}>
          <option value="">Any job</option>
          <option value="fraud_sentinel_ingest">ingest</option>
          <option value="fraud_sentinel_scan">scan</option>
          <option value="fraud_sentinel_retention">retention</option>
          <option value="fraud_sentinel_rule_sync">rule sync</option>
        </select>
        <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">Any status</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <select value={trigger} onChange={(event) => { setTrigger(event.target.value); setPage(1); }}>
          <option value="">Scheduled and manual</option>
          <option value="schedule">Scheduled only</option>
          <option value="manual">Manual only</option>
        </select>
      </div>

      <FsLoad state={state}>
        {(data) => (
          <>
            <FsTable<RunRow>
              columns={[
                { header: 'Started', render: (run) => <span className="ch247-page__hint">{formatDateTime(run.started_at)}</span> },
                { header: 'Job', render: (run) => <code>{run.job_name}</code> },
                { header: 'Trigger', render: (run) => <><FsBadge value={run.trigger} /> {run.triggered_by_name ?? run.triggered_by ?? ''}</> },
                { header: 'Status', render: (run) => <FsBadge value={run.status} /> },
                { header: 'Duration', render: (run) => (run.duration_ms === null ? <span className="ch247-page__hint">running</span> : `${run.duration_ms} ms`) },
                {
                  header: 'Work done',
                  render: (run) => (
                    <span className="ch247-page__hint">
                      {run.events_ingested} events · {run.subjects_scanned} subjects · {run.assessments_created} assessments ·{' '}
                      {run.alerts_created} alerts raised · {run.alerts_updated} updated · {run.records_pruned} pruned ·{' '}
                      {run.notifications_sent} notified
                    </span>
                  ),
                },
                { header: 'Failed', render: (run) => (run.failed_count > 0 ? <span style={{ color: '#a33' }}>{run.failed_count}</span> : '0') },
                { header: 'Error', render: (run) => (run.error ? <span style={{ color: '#a33' }}>{run.error}</span> : <span className="ch247-page__hint">—</span>) },
                { header: 'Run key', render: (run) => <code>{run.run_key}</code> },
              ]}
              rows={data.items}
              empty="No run recorded yet."
              keyOf={(run) => run.id}
            />
            <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
            <p className="ch247-page__hint">
              The run key is the idempotency lock: a scheduled pass uses the job plus its time bucket, a
              manual pass uses the job plus the current minute. A <code>running</code> row older than an
              hour is reclaimed by the next sweep and left marked <code>failed</code> — its key is never
              freed, so the same bucket is not processed twice.
            </p>
          </>
        )}
      </FsLoad>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

/** A numeric field the form may send, with the range the API accepts. */
interface NumericField {
  key: keyof FsSettings;
  label: string;
  min: number;
  max: number;
  hint?: string;
  /** True when changing it alters how a score is computed — those need a stated reason. */
  scoring?: boolean;
}

const NUMERIC_FIELDS: NumericField[] = [
  { key: 'lookbackDays', label: 'Lookback window (days)', min: 1, max: 365, hint: 'How far back each assessment reads recorded activity' },
  { key: 'scanBatchSize', label: 'Subjects per scan', min: 1, max: 10000 },
  { key: 'eventBatchLimit', label: 'Events per subject', min: 1, max: 100000 },
  { key: 'ingestBatchLimit', label: 'Rows ingested per source table', min: 1, max: 100000 },
  { key: 'schedulerIntervalMinutes', label: 'Scheduler interval (minutes)', min: 5, max: 1440 },
  { key: 'retentionEventDays', label: 'Keep projected events (days)', min: 1, max: 3650, hint: 'After this the ledger rows are pruned; the source payments, orders and audit rows are never touched' },
  { key: 'retentionHistoryDays', label: 'Keep risk history (days)', min: 1, max: 3650 },
  { key: 'retentionSupersededAssessmentDays', label: 'Keep superseded assessments (days)', min: 1, max: 3650 },
];

function Settings({ canEdit }: { canEdit: boolean }) {
  const { state, reload } = useFsData<SettingsView>('/settings');
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState('');
  const [alertMinLevel, setAlertMinLevel] = useState('');
  const [alertOnCriticalRule, setAlertOnCriticalRule] = useState('');
  const [aiAssistEnabled, setAiAssistEnabled] = useState('');
  const [aiEngine, setAiEngine] = useState('');
  const [notifyRoles, setNotifyRoles] = useState<string[]>([]);
  const [thresholds, setThresholds] = useState({ medium: '', high: '', critical: '' });
  const [familyCaps, setFamilyCaps] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function save() {
    const patch: Record<string, unknown> = {};
    for (const field of NUMERIC_FIELDS) {
      const raw = numbers[field.key];
      if (raw === undefined || raw.trim() === '') continue;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < field.min || parsed > field.max) {
        setError(`${field.label} must be a whole number between ${field.min} and ${field.max}.`);
        return;
      }
      patch[field.key] = parsed;
    }
    if (enabled !== '') patch.enabled = enabled === 'true';
    if (alertMinLevel) patch.alertMinLevel = alertMinLevel;
    if (alertOnCriticalRule !== '') patch.alertOnCriticalRule = alertOnCriticalRule === 'true';
    if (aiAssistEnabled !== '') patch.aiAssistEnabled = aiAssistEnabled === 'true';
    if (aiEngine.trim()) patch.aiEngine = aiEngine.trim();
    if (notifyRoles.length > 0) patch.notifyReviewerRoles = notifyRoles;
    const thresholdEntries = Object.entries(thresholds).filter(([, value]) => value.trim() !== '');
    if (thresholdEntries.length > 0) {
      const parsedThresholds: Record<string, number> = {};
      for (const [key, value] of thresholdEntries) {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          setError(`The ${key} threshold must be a whole number between 1 and 100.`);
          return;
        }
        parsedThresholds[key] = parsed;
      }
      // The API takes the whole ladder, so an unchanged step is sent back exactly as stored rather
      // than guessed at here; the server also forces the ladder monotonic and records in the audit row
      // both what was requested and what it stored when it has to correct one.
      if (state.status !== 'ready') {
        setError('Settings are still loading — wait for the stored values before changing a threshold.');
        return;
      }
      const stored = state.data.settings.riskThresholds;
      patch.riskThresholds = {
        medium: parsedThresholds.medium ?? stored.medium,
        high: parsedThresholds.high ?? stored.high,
        critical: parsedThresholds.critical ?? stored.critical,
      };
    }
    if (familyCaps.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(familyCaps);
      } catch {
        setError('Family caps must be valid JSON — an object of family name to whole-number cap.');
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError('Family caps must be a JSON object, not an array or a scalar.');
        return;
      }
      for (const [family, cap] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 0 || cap > 100) {
          setError(`The cap for ${family} must be a whole number between 0 and 100.`);
          return;
        }
      }
      patch.familyCaps = parsed;
    }

    if (Object.keys(patch).length === 0) {
      setError('Nothing to save — every field is still at its stored value.');
      return;
    }
    if (reason.trim()) patch.reason = reason.trim();

    setBusy(true);
    setError('');
    setDone('');
    try {
      await fsPatch<SettingsView>('/settings', patch);
      setDone('Settings saved. Values outside the accepted range were corrected to the reviewed default, and the audit row records both what was requested and what was stored.');
      setNumbers({});
      setEnabled('');
      setAlertMinLevel('');
      setAlertOnCriticalRule('');
      setAiAssistEnabled('');
      setAiEngine('');
      setNotifyRoles([]);
      setThresholds({ medium: '', high: '', critical: '' });
      setFamilyCaps('');
      setReason('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change was refused');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ch247-stack">
      <h3>Settings</h3>
      <FsLoad state={state}>
        {(view) => {
          const settings = view.settings;
          const overridden = new Set(view.overridden);
          const scoring = new Set(view.scoringKeys);
          return (
            <div className="ch247-stack">
              <p className="ch247-page__hint">
                Stored in <code>platform_settings</code> under the <code>fraud_sentinel.*</code> prefix.
                A key marked <strong>scoring</strong> changes how every future score is computed and
                cannot be changed without a stated reason.
                {canEdit
                  ? ' You can edit these.'
                  : ' Your role can read them but not change them — settings are super-administrator only, because they include the retention horizons.'}
              </p>

              {error ? <p className="ch247-page__hint" role="alert" style={{ color: '#a33' }}>{error}</p> : null}
              {done ? <p className="ch247-page__hint" role="status">{done}</p> : null}

              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead>
                    <tr>
                      <th>Setting</th>
                      <th>Stored</th>
                      <th>Shipped default</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>enabled</th>
                      <td>{settings.enabled ? 'on' : <span style={{ color: '#a33' }}>off — nothing is ingested, assessed or alerted</span>}</td>
                      <td className="ch247-page__hint">{view.defaults.enabled ? 'on' : 'off'}</td>
                      <td>
                        {canEdit ? (
                          <select value={enabled} onChange={(event) => setEnabled(event.target.value)}>
                            <option value="">unchanged</option>
                            <option value="true">on</option>
                            <option value="false">off</option>
                          </select>
                        ) : null}
                      </td>
                    </tr>

                    {NUMERIC_FIELDS.map((field) => (
                      <tr key={field.key}>
                        <th>
                          {field.key}
                          {overridden.has(field.key) ? <span className="ch247-badge ch247-badge--warning" style={{ marginLeft: '0.4rem' }}>tuned</span> : null}
                          {scoring.has(field.key) ? <span className="ch247-badge" style={{ marginLeft: '0.4rem' }}>scoring</span> : null}
                          {field.hint ? <div className="ch247-page__hint">{field.hint}</div> : null}
                        </th>
                        <td>{String(settings[field.key])}</td>
                        <td className="ch247-page__hint">{String(view.defaults[field.key])}</td>
                        <td>
                          {canEdit ? (
                            <input
                              type="number"
                              min={field.min}
                              max={field.max}
                              value={numbers[field.key] ?? ''}
                              placeholder={String(settings[field.key])}
                              onChange={(event) => setNumbers((previous) => ({ ...previous, [field.key]: event.target.value }))}
                              style={{ width: '7rem', padding: '0.4rem 0.5rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                            />
                          ) : null}
                        </td>
                      </tr>
                    ))}

                    <tr>
                      <th>
                        riskThresholds
                        {overridden.has('riskThresholds') ? <span className="ch247-badge ch247-badge--warning" style={{ marginLeft: '0.4rem' }}>tuned</span> : null}
                        <span className="ch247-badge" style={{ marginLeft: '0.4rem' }}>scoring</span>
                        <div className="ch247-page__hint">Score at which a level begins. The server forces the ladder monotonic.</div>
                      </th>
                      <td>
                        medium ≥ {settings.riskThresholds.medium}, high ≥ {settings.riskThresholds.high}, critical ≥ {settings.riskThresholds.critical}
                      </td>
                      <td className="ch247-page__hint">
                        {view.defaults.riskThresholds.medium} / {view.defaults.riskThresholds.high} / {view.defaults.riskThresholds.critical}
                      </td>
                      <td>
                        {canEdit ? (
                          <div className="ch247-inline-actions">
                            {(['medium', 'high', 'critical'] as const).map((level) => (
                              <input
                                key={level}
                                type="number"
                                min={1}
                                max={100}
                                value={thresholds[level]}
                                placeholder={level}
                                onChange={(event) => setThresholds((previous) => ({ ...previous, [level]: event.target.value }))}
                                style={{ width: '5rem', padding: '0.4rem 0.5rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                              />
                            ))}
                          </div>
                        ) : null}
                      </td>
                    </tr>

                    <tr>
                      <th>
                        familyCaps
                        {overridden.has('familyCaps') ? <span className="ch247-badge ch247-badge--warning" style={{ marginLeft: '0.4rem' }}>tuned</span> : null}
                        <span className="ch247-badge" style={{ marginLeft: '0.4rem' }}>scoring</span>
                        <div className="ch247-page__hint">Maximum points one scoring family can contribute, so no single noisy family can dominate a score.</div>
                      </th>
                      <td>
                        <details>
                          <summary className="ch247-page__hint">{Object.keys(settings.familyCaps).length} families</summary>
                          <pre style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(settings.familyCaps, null, 2)}
                          </pre>
                        </details>
                      </td>
                      <td className="ch247-page__hint">
                        <details>
                          <summary className="ch247-page__hint">defaults</summary>
                          <pre style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(view.defaults.familyCaps, null, 2)}
                          </pre>
                        </details>
                      </td>
                      <td>
                        {canEdit ? (
                          <textarea
                            value={familyCaps}
                            onChange={(event) => setFamilyCaps(event.target.value)}
                            placeholder='JSON object, e.g. {"payment_failures": 30}'
                            rows={3}
                            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.78rem', padding: '0.5rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                          />
                        ) : null}
                      </td>
                    </tr>

                    <tr>
                      <th>
                        alertMinLevel
                        {overridden.has('alertMinLevel') ? <span className="ch247-badge ch247-badge--warning" style={{ marginLeft: '0.4rem' }}>tuned</span> : null}
                        <span className="ch247-badge" style={{ marginLeft: '0.4rem' }}>scoring</span>
                        <div className="ch247-page__hint">The lowest level that raises an alert. Scores below it are still stored as assessments.</div>
                      </th>
                      <td><FsBadge value={settings.alertMinLevel} /></td>
                      <td className="ch247-page__hint">{view.defaults.alertMinLevel}</td>
                      <td>
                        {canEdit ? (
                          <select value={alertMinLevel} onChange={(event) => setAlertMinLevel(event.target.value)}>
                            <option value="">unchanged</option>
                            {view.levels.map((level) => (
                              <option key={level} value={level}>{level}</option>
                            ))}
                          </select>
                        ) : null}
                      </td>
                    </tr>

                    <tr>
                      <th>
                        alertOnCriticalRule
                        {overridden.has('alertOnCriticalRule') ? <span className="ch247-badge ch247-badge--warning" style={{ marginLeft: '0.4rem' }}>tuned</span> : null}
                        <span className="ch247-badge" style={{ marginLeft: '0.4rem' }}>scoring</span>
                        <div className="ch247-page__hint">Raise an alert for a single critical-severity rule even when the capped total is below alertMinLevel.</div>
                      </th>
                      <td>{settings.alertOnCriticalRule ? 'yes' : 'no'}</td>
                      <td className="ch247-page__hint">{view.defaults.alertOnCriticalRule ? 'yes' : 'no'}</td>
                      <td>
                        {canEdit ? (
                          <select value={alertOnCriticalRule} onChange={(event) => setAlertOnCriticalRule(event.target.value)}>
                            <option value="">unchanged</option>
                            <option value="true">yes</option>
                            <option value="false">no</option>
                          </select>
                        ) : null}
                      </td>
                    </tr>

                    <tr>
                      <th>
                        notifyReviewerRoles
                        {overridden.has('notifyReviewerRoles') ? <span className="ch247-badge ch247-badge--warning" style={{ marginLeft: '0.4rem' }}>tuned</span> : null}
                        <div className="ch247-page__hint">Who receives the in-app notification when an alert is raised. Nobody is emailed about a customer; this is an internal reviewer alert.</div>
                      </th>
                      <td>{settings.notifyReviewerRoles.join(', ') || <span className="ch247-page__hint">nobody</span>}</td>
                      <td className="ch247-page__hint">{view.defaults.notifyReviewerRoles.join(', ')}</td>
                      <td>
                        {canEdit ? (
                          <select
                            multiple
                            size={3}
                            value={notifyRoles}
                            onChange={(event) => setNotifyRoles(Array.from(event.target.selectedOptions).map((option) => option.value))}
                            style={{ minWidth: '10rem' }}
                          >
                            {['super_admin', 'admin', 'staff'].map((role) => (
                              <option key={role} value={role}>{role}</option>
                            ))}
                          </select>
                        ) : null}
                      </td>
                    </tr>

                    <tr>
                      <th>
                        aiAssistEnabled
                        {overridden.has('aiAssistEnabled') ? <span className="ch247-badge ch247-badge--warning" style={{ marginLeft: '0.4rem' }}>tuned</span> : null}
                        <div className="ch247-page__hint">
                          Off by design. When on, a model may add a summary beside the deterministic score; the score itself is never model output, and every assessment records whether AI text is present.
                        </div>
                      </th>
                      <td>
                        {settings.aiAssistEnabled ? 'on' : 'off'} · engine <code>{settings.aiEngine}</code>
                      </td>
                      <td className="ch247-page__hint">
                        {view.defaults.aiAssistEnabled ? 'on' : 'off'} · <code>{view.defaults.aiEngine}</code>
                      </td>
                      <td>
                        {canEdit ? (
                          <div className="ch247-inline-actions">
                            <select value={aiAssistEnabled} onChange={(event) => setAiAssistEnabled(event.target.value)}>
                              <option value="">unchanged</option>
                              <option value="true">on</option>
                              <option value="false">off</option>
                            </select>
                            <input
                              value={aiEngine}
                              placeholder={settings.aiEngine}
                              onChange={(event) => setAiEngine(event.target.value)}
                              style={{ width: '9rem', padding: '0.4rem 0.5rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                            />
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="ch247-page__hint">
                Scoring families in this build: {view.families.map(humanize).join(', ')}. Categories:{' '}
                {view.categories.map(humanize).join(', ')}.
              </p>

              {canEdit ? (
                <div className="ch247-stack">
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Reason — required when a scoring setting changes, recorded in the audit log for every change"
                    style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                  />
                  <div className="ch247-inline-actions">
                    <button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button>
                    <span className="ch247-page__hint">
                      A change applies to future assessments only. Stored scores keep the rule-set version
                      they were computed with, so an old assessment still explains itself.
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        }}
      </FsLoad>
    </div>
  );
}
