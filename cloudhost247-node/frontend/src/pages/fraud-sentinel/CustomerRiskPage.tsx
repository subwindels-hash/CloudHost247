/**
 * Customer risk — everything recorded about one account's risk, and the on-demand re-assessment.
 *
 * With no `:id` this screen is the account picker, which reads the platform's own staff/customer
 * directory (`GET /api/v1/admin/customers`, already gated to admin/super_admin) rather than asking
 * Fraud Sentinel to keep a second copy of the account list.
 *
 * The risk figures shown here are the module's own assessment rows. They describe recorded activity;
 * they are not a decision, and this screen offers no way to act on the customer's money, service or
 * account — that is the whole point of the advisory contract rendered beside the score.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FSLayout from '../../components/fraud-sentinel/FSLayout';
import {
  AccountSearch,
  AdvisoryNotice,
  DataQualityFlags,
  FamilyContributions,
  FsBadge,
  FsLoad,
  KeyValue,
  Recommendations,
  ScoreMeter,
  TriggeredRulesTable,
  formatDateTime,
  humanize,
  timeAgo,
  useFsData,
  useFsPermissions,
} from '../../components/fraud-sentinel/fs-widgets';
import {
  fsPost,
  type AdvisoryOnly,
  type CustomerRiskProfile,
  type DataQualityFlag,
  type EvidenceRef,
  type TriggeredRule,
} from '../../lib/fraud-sentinel-api';

export default function CustomerRiskPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <Profile customerId={id} /> : <Picker />;
}

/* -------------------------------------------------------------------------- */
/* Account picker                                                              */
/* -------------------------------------------------------------------------- */

function Picker() {
  return (
    <FSLayout
      title="Customer Risk"
      hint="Open an account to see every assessment, alert and recorded event Fraud Sentinel holds for it. Reading this changes nothing."
    >
      <AccountSearch
        linkPrefix="/admin/fraud-sentinel/customers"
        note="This directory is the platform's own admin customer list, not a Fraud Sentinel table. The module keeps no copy of it: it projects recorded activity and reads the account only to name a subject."
      />
    </FSLayout>
  );
}

/* -------------------------------------------------------------------------- */
/* One account's risk                                                          */
/* -------------------------------------------------------------------------- */

interface AssessOutcome {
  assessmentId: string;
  alertId: string | null;
  result: {
    riskScore: number;
    riskLevel: string;
    previousScore: number | null;
    previousLevel: string | null;
    confidence: string;
    ruleSetVersion: string;
    eventsExamined: number;
    triggeredRules: TriggeredRule[];
    familyContributions: Array<{ family: string; raw: number; capped: number; cap: number }>;
    recommendations: string[];
    dataQuality: DataQualityFlag[];
    evidence: EvidenceRef[];
    windowStartedAt: string;
    windowEndedAt: string;
  };
  evidenceIntegrity: { ok: boolean; withheld: string[] };
  advisory: AdvisoryOnly;
}

function Profile({ customerId }: { customerId: string }) {
  const { state, reload } = useFsData<CustomerRiskProfile>(`/customers/${customerId}/risk-profile`);
  const permissions = useFsPermissions();
  const canAssess = permissions.includes('fraud_sentinel.run_scan');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<AssessOutcome | null>(null);

  async function assessNow() {
    setBusy(true);
    setError('');
    setOutcome(null);
    try {
      const result = await fsPost<AssessOutcome>(`/customers/${customerId}/assess`);
      setOutcome(result);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assessment failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FSLayout
      title="Customer Risk Profile"
      hint="Recorded assessments and alerts for one account, newest first, with the event ledger behind them."
      actions={
        <div className="ch247-inline-actions">
          <Link to="/admin/fraud-sentinel/customers">← Account search</Link>
          {canAssess ? (
            <button type="button" disabled={busy} onClick={assessNow}>
              {busy ? 'Assessing…' : 'Re-assess now'}
            </button>
          ) : null}
        </div>
      }
    >
      <FsLoad state={state}>
        {(profile) => (
          <div className="ch247-stack">
            <AdvisoryNotice advisory={profile.advisory} />

            {error ? <p className="ch247-page__hint" role="alert" style={{ color: '#a33' }}>{error}</p> : null}

            <KeyValue
              rows={[
                ['Account', profile.account ? `${profile.account.email ?? customerId}` : customerId],
                ['Name', profile.account?.full_name ?? '—'],
                ['Role', profile.account ? <FsBadge value={profile.account.role} /> : '—'],
                ['Account status', profile.account ? <FsBadge value={profile.account.status} /> : '—'],
                ['Registered', profile.account ? formatDateTime(profile.account.created_at) : '—'],
                [
                  'Transaction ledger',
                  <Link to={`/admin/fraud-sentinel/transactions/${customerId}`}>Every projected event for this account →</Link>,
                ],
              ]}
            />

            {canAssess ? (
              <p className="ch247-page__hint">
                Re-assessing reads the recorded activity again and stores a new assessment, superseding
                the previous one. It takes no action on the account and sends no notification.
              </p>
            ) : null}

            {outcome ? (
              <div className="ch247-card">
                <h3>On-demand assessment just recorded</h3>
                <ScoreMeter score={outcome.result.riskScore} level={outcome.result.riskLevel} />
                <KeyValue
                  rows={[
                    ['Assessment', <code>{outcome.assessmentId}</code>],
                    [
                      'Alert',
                      outcome.alertId ? (
                        <Link to={`/admin/fraud-sentinel/alerts/${outcome.alertId}`}>An alert was raised or updated →</Link>
                      ) : (
                        <span className="ch247-page__hint">
                          no alert — the result did not reach the configured alert threshold
                        </span>
                      ),
                    ],
                    ['Confidence', <FsBadge value={outcome.result.confidence} />],
                    ['Rule set version', <code>{outcome.result.ruleSetVersion}</code>],
                    ['Events examined', outcome.result.eventsExamined],
                    ['Window', `${formatDateTime(outcome.result.windowStartedAt)} → ${formatDateTime(outcome.result.windowEndedAt)}`],
                    [
                      'Change',
                      outcome.result.previousScore === null ? (
                        <span className="ch247-page__hint">first assessment for this subject</span>
                      ) : (
                        <span>
                          {outcome.result.previousScore} ({outcome.result.previousLevel ?? '—'}) →{' '}
                          {outcome.result.riskScore} ({outcome.result.riskLevel})
                        </span>
                      ),
                    ],
                  ]}
                />
                <TriggeredRulesTable rules={outcome.result.triggeredRules} />
                <FamilyContributions contributions={outcome.result.familyContributions} />
                <DataQualityFlags flags={outcome.result.dataQuality} />
                <Recommendations items={outcome.result.recommendations} />
              </div>
            ) : null}

            <h3>Current assessment</h3>
            {profile.current ? (
              <>
                <ScoreMeter score={profile.current.risk_score} level={profile.current.risk_level} />
                <KeyValue
                  rows={[
                    ['Assessed', formatDateTime(profile.current.assessed_at)],
                    ['Status', <FsBadge value={profile.current.status} />],
                    ['Confidence', <FsBadge value={profile.current.confidence} />],
                    ['Rule set version', <code>{profile.current.rule_set_version}</code>],
                    ['Events examined', profile.current.events_examined],
                    ['Window', `${formatDateTime(profile.current.window_started_at)} → ${formatDateTime(profile.current.window_ended_at)}`],
                    [
                      'AI assistance',
                      profile.current.ai_assisted ? (
                        <span>
                          <FsBadge value={profile.current.ai_engine ?? 'ai'} /> — {profile.current.ai_summary ?? 'no summary recorded'}
                        </span>
                      ) : (
                        <span className="ch247-page__hint">none — deterministic rule engine</span>
                      ),
                    ],
                  ]}
                />
                <TriggeredRulesTable rules={profile.current.triggered_rules} />
                <FamilyContributions contributions={profile.current.family_contributions} />
                <DataQualityFlags flags={profile.current.data_quality} />
                <h4>Recommendations</h4>
                <Recommendations items={profile.current.recommendations} />
                <h4>Evidence</h4>
                <div className="ch247-table-wrap">
                  <table className="ch247-table">
                    <thead>
                      <tr>
                        <th>Source row</th>
                        <th>Recorded at</th>
                        <th>What was recorded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.current.evidence.map((ref, index) => (
                        <tr key={`${ref.table}:${ref.id ?? index}`}>
                          <td><code>{ref.table}{ref.id ? ` · ${ref.id}` : ''}</code></td>
                          <td className="ch247-page__hint">{formatDateTime(ref.occurredAt)}</td>
                          <td style={{ whiteSpace: 'pre-wrap' }}>{ref.description}</td>
                        </tr>
                      ))}
                      {profile.current.evidence.length === 0 ? (
                        <tr><td colSpan={3} className="ch247-page__hint">No evidence rows were recorded for this assessment.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="ch247-page__hint">
                This account has never been assessed — either no recorded activity in the lookback
                window matched a detection rule, or the scan has not reached it yet.
              </p>
            )}

            <h3>Open alerts</h3>
            <AlertTable alerts={profile.openAlerts} empty="No open alert for this account." />

            <h3>Closed alerts</h3>
            <AlertTable alerts={profile.closedAlerts} empty="No closed alert for this account." />

            <h3>Score history</h3>
            {profile.history.length === 0 ? (
              <p className="ch247-page__hint">No previous assessment recorded.</p>
            ) : (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead>
                    <tr>
                      <th>Recorded</th>
                      <th>Subject</th>
                      <th>Score</th>
                      <th>Level</th>
                      <th>Previous</th>
                      <th>Primary reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.history.map((entry) => (
                      <tr key={entry.id}>
                        <td className="ch247-page__hint">{formatDateTime(entry.recorded_at)}</td>
                        <td>{humanize(entry.subject_type)}{entry.subject_label ? ` · ${entry.subject_label}` : ''}</td>
                        <td>{entry.risk_score}</td>
                        <td><FsBadge value={entry.risk_level} /></td>
                        <td>
                          {entry.previous_score === null ? (
                            <span className="ch247-page__hint">first</span>
                          ) : (
                            <span>{entry.previous_score} ({entry.previous_level ?? '—'})</span>
                          )}
                        </td>
                        <td>{entry.primary_reason_code ? <code>{entry.primary_reason_code}</code> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3>Past assessments</h3>
            {profile.assessments.length === 0 ? (
              <p className="ch247-page__hint">No assessment on record.</p>
            ) : (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead>
                    <tr>
                      <th>Assessed</th>
                      <th>Score</th>
                      <th>Level</th>
                      <th>Rules fired</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {profile.assessments.map((assessment) => (
                      <tr key={assessment.id}>
                        <td className="ch247-page__hint">{formatDateTime(assessment.assessed_at)}</td>
                        <td>{assessment.risk_score}</td>
                        <td><FsBadge value={assessment.risk_level} /></td>
                        <td>{assessment.triggered_rules.map((rule) => rule.code).join(', ') || '—'}</td>
                        <td><FsBadge value={assessment.status} /></td>
                        <td><Link to={`/admin/fraud-sentinel/assessments/${assessment.id}`}>Full derivation →</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3>Recent recorded events</h3>
            <p className="ch247-page__hint">
              The projection of platform rows this account appears in.{' '}
              <Link to={`/admin/fraud-sentinel/transactions/${customerId}`}>See the whole ledger →</Link>
            </p>
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Category</th>
                    <th>Source row</th>
                    <th>Event</th>
                    <th>Amount</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.recentEvents.map((event) => (
                    <tr key={event.id}>
                      <td className="ch247-page__hint">{formatDateTime(event.occurred_at)}</td>
                      <td>{humanize(event.category)}</td>
                      <td><code>{event.source_table}{event.source_id ? ` · ${event.source_id}` : ''}</code></td>
                      <td><code>{event.source_event_type}</code></td>
                      <td>{event.amount ? `${event.amount} ${event.currency ?? ''}` : '—'}</td>
                      <td>{event.ip_address ? <code>{event.ip_address}{event.ip_country_code ? ` (${event.ip_country_code})` : ''}</code> : '—'}</td>
                    </tr>
                  ))}
                  {profile.recentEvents.length === 0 ? (
                    <tr><td colSpan={6} className="ch247-page__hint">No event projected for this account yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </FsLoad>
    </FSLayout>
  );
}

function AlertTable({ alerts, empty }: { alerts: CustomerRiskProfile['openAlerts']; empty: string }) {
  if (alerts.length === 0) return <p className="ch247-page__hint">{empty}</p>;
  return (
    <div className="ch247-table-wrap">
      <table className="ch247-table">
        <thead>
          <tr>
            <th>Alert</th>
            <th>Detected</th>
            <th>Level</th>
            <th>Status</th>
            <th>Primary rule</th>
            <th>Reviewer</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id}>
              <td><Link to={`/admin/fraud-sentinel/alerts/${alert.id}`}>{alert.alert_number}</Link></td>
              <td className="ch247-page__hint">{formatDateTime(alert.detected_at)}</td>
              <td><FsBadge value={alert.risk_level} /> <span className="ch247-page__hint">{alert.risk_score}</span></td>
              <td><FsBadge value={alert.status} /></td>
              <td>{alert.primary_rule_code ? <code>{alert.primary_rule_code}</code> : '—'}</td>
              <td>{alert.reviewer_name ?? <span className="ch247-page__hint">unassigned</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
