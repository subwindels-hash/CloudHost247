/**
 * Rule catalogue — the 40 reviewed detection rules as configured in THIS database, beside the
 * defaults this build ships, with the drift report and the tuning controls.
 *
 * What an operator can do here is narrow on purpose: change a weight, enable or disable a rule, change
 * its severity, family, applicable subject types or its numeric parameters. Every change is versioned
 * (the rule's `version` increments), written to an append-only history table and audited, and a weight
 * change is refused outright without a stated reason — because a weight moves every future score.
 *
 * Nothing here rewrites the detector code. A rule with no evaluator in this build can be listed and
 * even enabled, and the drift report says so: it will never contribute to a score.
 */
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import FSLayout from '../../components/fraud-sentinel/FSLayout';
import {
  AdvisoryNotice,
  FsBadge,
  FsLoad,
  KeyValue,
  formatDateTime,
  humanize,
  useFsData,
  useFsMeta,
} from '../../components/fraud-sentinel/fs-widgets';
import {
  fsPatch,
  fsPost,
  type RuleDriftReport,
  type RuleFeedbackRow,
  type RuleHistoryRow,
  type RuleWithDefault,
} from '../../lib/fraud-sentinel-api';

interface RulesPageData {
  items: RuleWithDefault[];
  total: number;
  drift: RuleDriftReport;
  canEdit: boolean;
}

interface RuleDetailData {
  rule: RuleWithDefault;
  history: RuleHistoryRow[];
  canEdit: boolean;
}

interface FeedbackData {
  window: { since: string; until: string };
  rules: RuleFeedbackRow[];
}

export default function RulesPage() {
  const meta = useFsMeta();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [family, setFamily] = useState('');
  const [enabledOnly, setEnabledOnly] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState('');
  const [busy, setBusy] = useState(false);

  const { state, reload } = useFsData<RulesPageData>('/rules', {
    search: search.trim() || undefined,
    category: category || undefined,
    family: family || undefined,
    enabledOnly: enabledOnly || undefined,
  });
  const feedback = useFsData<FeedbackData>('/rule-feedback', { days: 90 });

  async function syncCatalogue() {
    setBusy(true);
    setSyncError('');
    setSyncMessage('');
    try {
      const result = await fsPost<{ inserted: string[] }>('/rules/sync');
      setSyncMessage(
        result.inserted.length === 0
          ? 'Nothing inserted: every rule this build ships is already in the database. Existing rules were left exactly as tuned.'
          : `Inserted ${result.inserted.length} missing rule(s): ${result.inserted.join(', ')}.`
      );
      reload();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FSLayout
      title="Rule Catalogue"
      hint="Detection rules are configuration, not code: each one names the recorded rows it reads, the points it is worth and the recommendation it produces. Tuning a rule changes how future scores are computed and is versioned and audited."
      actions={
        <div className="ch247-inline-actions">
          <button type="button" disabled={busy} onClick={syncCatalogue}>
            {busy ? 'Syncing…' : 'Sync catalogue from this build'}
          </button>
        </div>
      }
    >
      <div className="ch247-stack">
        {syncMessage ? <p className="ch247-page__hint" role="status">{syncMessage}</p> : null}
        {syncError ? <p className="ch247-page__hint" role="alert" style={{ color: '#a33' }}>{syncError}</p> : null}

        <FsLoad state={meta}>
          {(vocabulary) => (
            <div className="ch247-stack">
              <AdvisoryNotice advisory={vocabulary.advisory} compact />
              <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">Any category</option>
                {vocabulary.categories.map((value) => (
                  <option key={value} value={value}>{humanize(value)}</option>
                ))}
              </select>
              <select value={enabledOnly} onChange={(event) => setEnabledOnly(event.target.value)}>
                <option value="">Enabled and disabled</option>
                <option value="true">Enabled only</option>
                <option value="false">Disabled only</option>
              </select>
              <input
                placeholder="Search code, name or description"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                style={{ flex: '1 1 220px', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
              />
              </div>
            </div>
          )}
        </FsLoad>

        <FsLoad state={state}>
          {(data) => (
            <>
              <h3>Configuration drift</h3>
              <DriftReport drift={data.drift} />

              <h3>Rules ({data.total})</h3>
              {!data.canEdit ? (
                <p className="ch247-page__hint">
                  Your role can read the catalogue but not change it (<code>fraud_sentinel.rules</code> is required).
                </p>
              ) : null}

              {/* Families are derived from the rows rather than listed here, so a family added to the
                  catalogue appears in the filter without a frontend change. */}
              <div className="ch247-inline-actions">
                <select value={family} onChange={(event) => setFamily(event.target.value)}>
                  <option value="">Any scoring family</option>
                  {Array.from(new Set(data.items.map((rule) => rule.family)))
                    .sort()
                    .map((value) => (
                      <option key={value} value={value}>{humanize(value)}</option>
                    ))}
                </select>
              </div>

              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Family</th>
                      <th>Weight</th>
                      <th>Severity</th>
                      <th>Applies to</th>
                      <th>Version</th>
                      <th>State</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((rule) => (
                      <Fragment key={rule.code}>
                        <tr>
                          <td><code>{rule.code}</code></td>
                          <td>
                            {rule.name}
                            {rule.drift.length > 0 ? (
                              <span className="ch247-badge ch247-badge--warning" style={{ marginLeft: '0.4rem' }}>
                                tuned: {rule.drift.join(', ')}
                              </span>
                            ) : null}
                            {rule.hasEvaluator ? null : (
                              <span className="ch247-badge ch247-badge--danger" style={{ marginLeft: '0.4rem' }}>
                                no evaluator in this build
                              </span>
                            )}
                          </td>
                          <td className="ch247-page__hint">{humanize(rule.family)}</td>
                          <td>
                            {rule.weight}
                            {rule.catalogueDefault && rule.catalogueDefault.weight !== rule.weight ? (
                              <span className="ch247-page__hint"> (default {rule.catalogueDefault.weight})</span>
                            ) : null}
                          </td>
                          <td><FsBadge value={rule.severity} /></td>
                          <td className="ch247-page__hint">{rule.applies_to.map(humanize).join(', ')}</td>
                          <td>v{rule.version}</td>
                          <td><FsBadge value={rule.enabled ? 'enabled' : 'disabled'} /></td>
                          <td>
                            <button type="button" onClick={() => setOpen(open === rule.code ? null : rule.code)}>
                              {open === rule.code ? 'Hide' : 'Inspect'}
                            </button>
                          </td>
                        </tr>
                        {open === rule.code ? (
                          <tr>
                            <td colSpan={9}>
                              <RuleDetail code={rule.code} onChanged={reload} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                    {data.items.length === 0 ? (
                      <tr><td colSpan={9} className="ch247-page__hint">No rule matches those filters.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </FsLoad>

        <h3>Reviewer disagreement</h3>
        <p className="ch247-page__hint">
          Alerts raised against false positives reported, per rule, over the last 90 days. This is the
          only tuning signal the module can produce from its own records, and it changes nothing by
          itself: retuning is a human act through the controls above, versioned and audited.
        </p>
        <FsLoad state={feedback.state}>
          {(data) => (
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Family</th>
                    <th>Weight</th>
                    <th>Alerts</th>
                    <th>False positives</th>
                    <th>Disagreement rate</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rules.map((row) => (
                    <tr key={row.code}>
                      <td><code>{row.code}</code> <span className="ch247-page__hint">v{row.version}</span></td>
                      <td className="ch247-page__hint">{humanize(row.family)}</td>
                      <td>{row.weight}</td>
                      <td>{row.alerts}</td>
                      <td>{row.falsePositives}</td>
                      <td>
                        {row.falsePositiveRate === null ? (
                          <span className="ch247-page__hint">no alerts — untested</span>
                        ) : (
                          <span>{Math.round(row.falsePositiveRate * 100)}%</span>
                        )}
                      </td>
                      <td><FsBadge value={row.enabled ? 'enabled' : 'disabled'} /></td>
                    </tr>
                  ))}
                  {data.rules.length === 0 ? (
                    <tr><td colSpan={7} className="ch247-page__hint">No rule has been stored yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
              <p className="ch247-page__hint">
                Window {data.window.since.slice(0, 10)} → {data.window.until.slice(0, 10)}.
              </p>
            </div>
          )}
        </FsLoad>
      </div>
    </FSLayout>
  );
}

/* -------------------------------------------------------------------------- */
/* Drift                                                                       */
/* -------------------------------------------------------------------------- */

function DriftReport({ drift }: { drift: RuleDriftReport }) {
  const clean =
    drift.missingInDatabase.length === 0 && drift.withoutEvaluator.length === 0 && drift.tuned.length === 0;
  if (clean) {
    return (
      <p className="ch247-page__hint" role="status">
        No drift: every rule this build ships is stored, every stored rule has an evaluator, and nobody
        has tuned one.
      </p>
    );
  }
  return (
    <div className="ch247-stack">
      {drift.missingInDatabase.length > 0 ? (
        <p className="ch247-page__hint" style={{ color: '#a33' }}>
          <strong>Missing from the database</strong> ({drift.missingInDatabase.length}):{' '}
          {drift.missingInDatabase.map((code) => <code key={code}>{code}</code>)} — press “Sync
          catalogue from this build” to insert them. Existing rules are never overwritten.
        </p>
      ) : null}
      {drift.withoutEvaluator.length > 0 ? (
        <p className="ch247-page__hint" style={{ color: '#a33' }}>
          <strong>No evaluator in this build</strong> ({drift.withoutEvaluator.length}):{' '}
          {drift.withoutEvaluator.map((entry) => (
            <span key={entry.code}>
              <code>{entry.code}</code>
              {entry.enabled ? ' (enabled — it can never contribute)' : ''}{' '}
            </span>
          ))}
        </p>
      ) : null}
      {drift.tuned.length > 0 ? (
        <p className="ch247-page__hint">
          <strong>Tuned away from the reviewed default</strong> ({drift.tuned.length}):{' '}
          {drift.tuned.map((entry) => (
            <span key={entry.code}>
              <code>{entry.code}</code> [{entry.drift.join(', ')}]{' '}
            </span>
          ))}
          — each change is in the rule history with the reason it was given.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One rule                                                                    */
/* -------------------------------------------------------------------------- */

function RuleDetail({ code, onChanged }: { code: string; onChanged: () => void }) {
  const { state, reload } = useFsData<RuleDetailData>(`/rules/${code}`);
  const [weight, setWeight] = useState('');
  const [severity, setSeverity] = useState('');
  const [enabled, setEnabled] = useState('');
  const [parameters, setParameters] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  return (
    <FsLoad state={state}>
      {(detail) => {
        const rule = detail.rule;
        const defaults = rule.catalogueDefault;
        const parameterText =
          parameters ||
          JSON.stringify(rule.parameters, null, 2);

        async function save(patch: Record<string, unknown>, label: string) {
          setBusy(true);
          setError('');
          setDone('');
          try {
            const result = await fsPatch<RuleDetailData & { changeType: string }>(`/rules/${code}`, patch);
            setDone(`${label} — recorded as ${result.changeType} at version ${result.rule.version}.`);
            setWeight('');
            setSeverity('');
            setEnabled('');
            setParameters('');
            setReason('');
            reload();
            onChanged();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'The change was refused');
          } finally {
            setBusy(false);
          }
        }

        return (
          <div className="ch247-stack" style={{ padding: '0.25rem 0' }}>
            <p style={{ whiteSpace: 'pre-wrap' }}>{rule.description}</p>
            <KeyValue
              rows={[
                ['Category', humanize(rule.category)],
                ['Scoring family', <span>{humanize(rule.family)} <span className="ch247-page__hint">— capped per assessment, see the family contributions on any score</span></span>],
                ['Applies to', rule.applies_to.map(humanize).join(', ')],
                ['Data sources', rule.data_sources.map((source) => <code key={source}>{source}</code>)],
                ['Recommendation', <span style={{ whiteSpace: 'pre-wrap' }}>{rule.recommendation}</span>],
                ['Evaluator in this build', rule.hasEvaluator ? 'yes' : <span style={{ color: '#a33' }}>no — this rule can never contribute to a score</span>],
                ['Last changed', `${formatDateTime(rule.updated_at)}${rule.updated_by ? ` by ${rule.updated_by}` : ''}`],
              ]}
            />

            {defaults ? (
              <p className="ch247-page__hint">
                Reviewed default: weight {defaults.weight}, severity {defaults.severity},{' '}
                {defaults.enabled ? 'enabled' : 'disabled'}, version {defaults.version}.{' '}
                {rule.drift.length > 0 ? `This database differs on: ${rule.drift.join(', ')}.` : 'This database matches it.'}
              </p>
            ) : (
              <p className="ch247-page__hint">
                This rule exists only in the database — no build ships a default for it, so there is
                nothing to compare it against.
              </p>
            )}

            <h4>Parameters</h4>
            <p className="ch247-page__hint">
              Numeric thresholds the detector reads (how many failures, how wide a window). Changing
              them changes what the rule detects; the change is versioned like any other.
            </p>
            <pre style={{ margin: 0, fontSize: '0.78rem', whiteSpace: 'pre-wrap' }}>{parameterText}</pre>

            {error ? <p className="ch247-page__hint" role="alert" style={{ color: '#a33' }}>{error}</p> : null}
            {done ? <p className="ch247-page__hint" role="status">{done}</p> : null}

            {detail.canEdit ? (
              <div className="ch247-card">
                <h4>Change this rule</h4>
                <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
                  <label>
                    <span className="ch247-page__hint"> Weight (1–30)</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      step={1}
                      value={weight}
                      placeholder={String(rule.weight)}
                      onChange={(event) => setWeight(event.target.value)}
                      style={{ width: '6rem', padding: '0.4rem 0.5rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                    />
                  </label>
                  <label>
                    <span className="ch247-page__hint"> Severity</span>
                    <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                      <option value="">{rule.severity} (unchanged)</option>
                      {['low', 'medium', 'high', 'critical'].map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="ch247-page__hint"> State</span>
                    <select value={enabled} onChange={(event) => setEnabled(event.target.value)}>
                      <option value="">{rule.enabled ? 'enabled' : 'disabled'} (unchanged)</option>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </label>
                </div>
                <textarea
                  value={parameters}
                  onChange={(event) => setParameters(event.target.value)}
                  placeholder='Parameters as JSON, e.g. {"minFailures": 3, "windowHours": 24}'
                  rows={3}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                />
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why — required for a weight change, recorded in the rule history and the audit log for every change"
                  style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                />
                <div className="ch247-inline-actions">
                  <button
                    type="button"
                    disabled={busy || (weight.trim() === '' && severity === '' && enabled === '' && parameters.trim() === '')}
                    onClick={async () => {
                      const patch: Record<string, unknown> = {};
                      if (reason.trim()) patch.reason = reason.trim();
                      if (weight.trim() !== '') {
                        const parsed = Number(weight);
                        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) {
                          setError('Weight must be a whole number between 1 and 30.');
                          return;
                        }
                        patch.weight = parsed;
                      }
                      if (severity) patch.severity = severity;
                      if (enabled) patch.enabled = enabled === 'true';
                      if (parameters.trim()) {
                        let parsedParameters: unknown;
                        try {
                          parsedParameters = JSON.parse(parameters);
                        } catch {
                          setError('Parameters must be valid JSON — an object of numbers, strings, booleans or null.');
                          return;
                        }
                        if (!parsedParameters || typeof parsedParameters !== 'object' || Array.isArray(parsedParameters)) {
                          setError('Parameters must be a JSON object, not an array or a scalar.');
                          return;
                        }
                        patch.parameters = parsedParameters;
                      }
                      if (patch.weight !== undefined && !patch.reason) {
                        setError('A weight change needs a stated reason: it moves every future score.');
                        return;
                      }
                      await save(patch, 'Rule updated');
                    }}
                  >
                    {busy ? 'Saving…' : 'Save change (versioned + audited)'}
                  </button>
                  <Link to={`/admin/fraud-sentinel/alerts?ruleCode=${rule.code}`}>Alerts from this rule →</Link>
                </div>
                <p className="ch247-page__hint">
                  A change takes effect on the next assessment. Scores already stored are never
                  recomputed: they keep the rule-set version they were computed with, so an old score
                  still explains itself.
                </p>
              </div>
            ) : null}

            <h4>Rule history</h4>
            {detail.history.length === 0 ? (
              <p className="ch247-page__hint">No change recorded for this rule yet.</p>
            ) : (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Change</th>
                      <th>Version</th>
                      <th>By</th>
                      <th>Reason</th>
                      <th>Snapshot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.history.map((entry) => (
                      <tr key={entry.id}>
                        <td className="ch247-page__hint">{formatDateTime(entry.created_at)}</td>
                        <td><code>{entry.change_type}</code></td>
                        <td>v{entry.version}</td>
                        <td>{entry.changed_by ?? <span className="ch247-page__hint">migration seed</span>}</td>
                        <td style={{ whiteSpace: 'pre-wrap' }}>{entry.reason ?? ''}</td>
                        <td>
                          <details>
                            <summary className="ch247-page__hint">view</summary>
                            <pre style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', whiteSpace: 'pre-wrap' }}>
                              {JSON.stringify(entry.snapshot, null, 2)}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      }}
    </FsLoad>
  );
}
