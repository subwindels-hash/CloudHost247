/**
 * One alert, end to end: the score, the derivation, the evidence, the reviewer timeline and the
 * actions a reviewer may take.
 *
 * Three deliberate choices here:
 *
 *  * The transition buttons are built from `meta.transitions[alert.status]` — the server's state
 *    machine — so a move the API would refuse with a 409 is not offered as a button at all.
 *  * The minimum note lengths come from `/meta` too, so the screen asks for what the API requires
 *    instead of discovering it as a validation error.
 *  * Every action renders the server's own advisory statement, because this is the screen where a
 *    reviewer is most likely to look for something to *do* about the customer. There is nothing here
 *    that touches money, service or account state, and the page says so next to the buttons.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FSLayout from '../../components/fraud-sentinel/FSLayout';
import {
  AdvisoryNotice,
  DataQualityFlags,
  EvidenceIntegrityNotice,
  EvidenceList,
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
  useFsMeta,
  useFsPermissions,
} from '../../components/fraud-sentinel/fs-widgets';
import {
  fetchFsReviewers,
  fsPost,
  type AlertDetail,
  type FsReviewer,
} from '../../lib/fraud-sentinel-api';

export default function FSAlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { state, reload } = useFsData<AlertDetail>(`/alerts/${id}`);
  const meta = useFsMeta();
  const permissions = useFsPermissions();

  const canInvestigate = permissions.includes('fraud_sentinel.investigate');
  const canAssign = permissions.includes('fraud_sentinel.assign');

  const [reviewers, setReviewers] = useState<FsReviewer[]>([]);
  const [reviewerError, setReviewerError] = useState('');
  const [transition, setTransition] = useState('');
  const [note, setNote] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [fpReason, setFpReason] = useState('');
  const [fpExplanation, setFpExplanation] = useState('');
  const [fpRules, setFpRules] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  // The reviewer picker is only worth loading for someone who can actually assign.
  useEffect(() => {
    if (!canAssign) return;
    let cancelled = false;
    fetchFsReviewers()
      .then((people) => !cancelled && setReviewers(people))
      .catch((err: unknown) => !cancelled && setReviewerError(err instanceof Error ? err.message : 'Could not load reviewers'));
    return () => {
      cancelled = true;
    };
  }, [canAssign]);

  async function act(label: string, run: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setDone('');
    try {
      await run();
      setDone(label);
      setTransition('');
      setNote('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request was refused');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FSLayout
      title="Alert"
      hint="Reading an alert is a read. The actions below record what a reviewer concluded — they never change a payment, an invoice, a service or an account."
      actions={
        <div className="ch247-inline-actions">
          <Link to="/admin/fraud-sentinel/alerts">← Alert queue</Link>
        </div>
      }
    >
      <FsLoad state={state}>
        {(detail) => {
          const alert = detail.alert;
          const assessment = detail.assessment;
          return (
            <div className="ch247-stack">
              <AdvisoryNotice advisory={detail.advisory} />

              <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '1.1rem' }}>{alert.alert_number}</strong>
                <FsBadge value={alert.status} />
                <FsBadge value={alert.risk_level} />
                <FsBadge value={alert.category} />
                {alert.recurrence_count > 1 ? (
                  <span className="ch247-badge ch247-badge--warning">
                    seen {alert.recurrence_count} times
                  </span>
                ) : null}
                <span className="ch247-page__hint">detected {formatDateTime(alert.detected_at)}</span>
              </div>

              <p style={{ whiteSpace: 'pre-wrap' }}>{alert.title}</p>
              <p className="ch247-page__hint" style={{ whiteSpace: 'pre-wrap' }}>{alert.explanation}</p>

              <KeyValue
                rows={[
                  [
                    'Subject',
                    alert.customer_id ? (
                      <Link to={`/admin/fraud-sentinel/customers/${alert.customer_id}`}>
                        {alert.customer_email ?? alert.customer_id}
                        {alert.customer_name ? ` — ${alert.customer_name}` : ''}
                      </Link>
                    ) : (
                      <span>{humanize(alert.subject_type)} · {alert.subject_label ?? alert.subject_id ?? 'unknown'}</span>
                    ),
                  ],
                  ['Primary rule', alert.primary_rule_code ? <code>{alert.primary_rule_code}</code> : '—'],
                  ['Reviewer', alert.reviewer_name ? `${alert.reviewer_name} (assigned ${timeAgo(alert.assigned_at)})` : <span className="ch247-page__hint">unassigned</span>],
                  ['Escalated', alert.escalated_at ? formatDateTime(alert.escalated_at) : 'never'],
                  ['Resolved', alert.resolved_at ? `${formatDateTime(alert.resolved_at)} — “${alert.resolution_note ?? ''}”` : 'open'],
                  ['Assessed', formatDateTime(alert.last_assessed_at)],
                  [
                    'Evidence ledger',
                    alert.customer_id ? (
                      <Link to={`/admin/fraud-sentinel/transactions/${alert.customer_id}`}>
                        Transaction ledger for this customer →
                      </Link>
                    ) : (
                      <span className="ch247-page__hint">This subject is not a customer, so it has no customer ledger.</span>
                    ),
                  ],
                ]}
              />

              {assessment ? (
                <>
                  <h3>Score derivation</h3>
                  <ScoreMeter score={assessment.risk_score} level={assessment.risk_level} />
                  <KeyValue
                    rows={[
                      ['Confidence', <FsBadge value={assessment.confidence} />],
                      ['Rule set version', <code>{assessment.rule_set_version}</code>],
                      ['Scoring version', assessment.scoring_version],
                      [
                        'Window examined',
                        `${formatDateTime(assessment.window_started_at)} → ${formatDateTime(assessment.window_ended_at)}`,
                      ],
                      ['Events examined', assessment.events_examined],
                      ['Assessment status', <FsBadge value={assessment.status} />],
                      [
                        'Compared with the previous assessment',
                        assessment.previous_score === null ? (
                          <span className="ch247-page__hint">first assessment for this subject</span>
                        ) : (
                          <span>
                            {assessment.previous_score} ({assessment.previous_level ?? '—'}) → {assessment.risk_score} ({assessment.risk_level})
                          </span>
                        ),
                      ],
                      [
                        'AI assistance',
                        assessment.ai_assisted ? (
                          <span>
                            <FsBadge value={assessment.ai_engine ?? 'ai'} /> — model-generated text.{' '}
                            {assessment.ai_summary ?? 'No summary was recorded.'}
                          </span>
                        ) : (
                          <span className="ch247-page__hint">
                            none — every number and sentence here is derived by the deterministic rule engine
                          </span>
                        ),
                      ],
                    ]}
                  />

                  <h3>Rules that fired</h3>
                  <TriggeredRulesTable rules={assessment.triggered_rules} />

                  <h3>Family contributions</h3>
                  <p className="ch247-page__hint">
                    Each scoring family is capped, so one noisy family cannot dominate the total. The
                    score is the sum of the credited column.
                  </p>
                  <FamilyContributions contributions={assessment.family_contributions} />

                  <h3>Data quality</h3>
                  <DataQualityFlags flags={assessment.data_quality} />

                  <h3>Evidence</h3>
                  <EvidenceIntegrityNotice integrity={detail.evidenceIntegrity} />
                  <EvidenceList evidence={assessment.evidence} />
                  {assessment.triggered_rules.some((rule) => rule.evidence.length > 0) ? (
                    <details>
                      <summary className="ch247-page__hint">Evidence per rule</summary>
                      {assessment.triggered_rules.map((rule) => (
                        <div key={rule.code} style={{ marginTop: '0.5rem' }}>
                          <p><code>{rule.code}</code> v{rule.version}</p>
                          <EvidenceList evidence={rule.evidence} />
                        </div>
                      ))}
                    </details>
                  ) : null}

                  <h3>Recommendations</h3>
                  <p className="ch247-page__hint">
                    Suggested next steps for a human. None of them is performed by this module.
                  </p>
                  <Recommendations items={assessment.recommendations} />
                </>
              ) : (
                <p className="ch247-page__hint">
                  The assessment behind this alert is no longer readable — it was pruned by the retention
                  horizon. The alert row itself and its investigation timeline are retained.
                </p>
              )}

              <h3>Risk history</h3>
              {detail.riskHistory.length === 0 ? (
                <p className="ch247-page__hint">No previous assessment recorded for this subject.</p>
              ) : (
                <div className="ch247-table-wrap">
                  <table className="ch247-table">
                    <thead>
                      <tr>
                        <th>Recorded</th>
                        <th>Score</th>
                        <th>Level</th>
                        <th>Change from previous</th>
                        <th>Primary reason</th>
                        <th>Rule set</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.riskHistory.map((entry) => (
                        <tr key={entry.id}>
                          <td className="ch247-page__hint">{formatDateTime(entry.recorded_at)}</td>
                          <td>{entry.risk_score}</td>
                          <td><FsBadge value={entry.risk_level} /></td>
                          <td>
                            {entry.previous_score === null ? (
                              <span className="ch247-page__hint">first</span>
                            ) : (
                              <span>{entry.risk_score - entry.previous_score > 0 ? '+' : ''}{entry.risk_score - entry.previous_score}</span>
                            )}
                          </td>
                          <td>{entry.primary_reason_code ? <code>{entry.primary_reason_code}</code> : '—'}</td>
                          <td className="ch247-page__hint"><code>{entry.rule_set_version.slice(0, 8)}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h3>Investigation timeline</h3>
              {detail.investigations.length === 0 ? (
                <p className="ch247-page__hint">Nothing has been recorded on this alert yet.</p>
              ) : (
                <div className="ch247-table-wrap">
                  <table className="ch247-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Action</th>
                        <th>By</th>
                        <th>Status change</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.investigations.map((entry) => (
                        <tr key={entry.id}>
                          <td className="ch247-page__hint">{formatDateTime(entry.created_at)}</td>
                          <td><code>{entry.action}</code></td>
                          <td>
                            {entry.actor_name ?? entry.actor_id ?? <span className="ch247-page__hint">{entry.actor_type}</span>}
                            {entry.actor_type === 'system' ? <span className="ch247-page__hint"> (scheduled pass)</span> : null}
                          </td>
                          <td>
                            {entry.from_status && entry.to_status ? (
                              <span>{humanize(entry.from_status)} → {humanize(entry.to_status)}</span>
                            ) : (
                              <span className="ch247-page__hint">—</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'pre-wrap' }}>{entry.note ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {detail.falsePositive ? (
                <>
                  <h3>False-positive report on file</h3>
                  <KeyValue
                    rows={[
                      ['Reason', humanize(detail.falsePositive.reason_category)],
                      ['Reported by', detail.falsePositive.reported_by_name ?? detail.falsePositive.reported_by ?? 'unknown'],
                      ['Reported at', formatDateTime(detail.falsePositive.created_at)],
                      ['Rules named', detail.falsePositive.rule_codes.length ? detail.falsePositive.rule_codes.map((code) => <code key={code}>{code}</code>) : <span className="ch247-page__hint">none named</span>],
                      ['Explanation', <span style={{ whiteSpace: 'pre-wrap' }}>{detail.falsePositive.explanation}</span>],
                    ]}
                  />
                  <p className="ch247-page__hint">
                    One report per alert. To report again, reopen the alert first — the report stays on
                    the record either way, and it feeds the rule feedback report.
                  </p>
                </>
              ) : null}

              {/* --------------------------------------------------------- actions */}

              {error ? <p className="ch247-page__hint" role="alert" style={{ color: '#a33' }}>{error}</p> : null}
              {done ? <p className="ch247-page__hint" role="status">{done}</p> : null}

              {canInvestigate ? (
                <FsLoad state={meta}>
                  {(vocabulary) => {
                    const allowed = vocabulary.transitions[alert.status] ?? [];
                    const minNote = vocabulary.minResolutionNote;
                    const closing = transition === 'resolved' || transition === 'false_positive';
                    const noteTooShort = closing && note.trim().length < minNote;
                    return (
                      <div className="ch247-card">
                        <h3>Record a conclusion</h3>
                        {allowed.length === 0 ? (
                          <p className="ch247-page__hint">
                            This alert is in <strong>{humanize(alert.status)}</strong>, which the state
                            machine allows no further move from.
                          </p>
                        ) : (
                          <div className="ch247-stack">
                            <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
                              <select value={transition} onChange={(event) => setTransition(event.target.value)}>
                                <option value="">Move this alert to…</option>
                                {allowed.map((value) => (
                                  <option key={value} value={value}>{humanize(value)}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={busy || !transition || Boolean(noteTooShort)}
                                onClick={() =>
                                  act(`Alert moved to ${humanize(transition)}`, () =>
                                    fsPost(`/alerts/${alert.id}/transition`, {
                                      toStatus: transition,
                                      note: note.trim() || null,
                                    })
                                  )
                                }
                              >
                                {busy ? 'Working…' : 'Apply'}
                              </button>
                            </div>
                            <textarea
                              value={note}
                              onChange={(event) => setNote(event.target.value)}
                              placeholder={
                                closing
                                  ? `Required to close: say what you found (at least ${minNote} characters).`
                                  : 'Optional note for the timeline.'
                              }
                              rows={3}
                              style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                            />
                            {noteTooShort ? (
                              <p className="ch247-page__hint" style={{ color: '#a33' }}>
                                A note of at least {minNote} characters is required to mark an alert
                                resolved or a false positive. You have {note.trim().length}.
                              </p>
                            ) : null}
                            <p className="ch247-page__hint">
                              Applying a move takes the alert if nobody owns it yet — an alert with no
                              reviewer is nobody's problem, so the first person to touch it owns it.
                            </p>
                          </div>
                        )}

                        <h4 style={{ marginTop: '1rem' }}>Add a note</h4>
                        <NoteForm
                          busy={busy}
                          onSend={(kind, text) =>
                            act('Note added to the timeline', () =>
                              fsPost(`/alerts/${alert.id}/notes`, { note: text, kind })
                            )
                          }
                        />

                        <h4 style={{ marginTop: '1rem' }}>Report a false positive</h4>
                        <p className="ch247-page__hint">
                          Moves the alert to <strong>false positive</strong> and records why, so the rule
                          feedback report can show which rules reviewers disagree with. It does not
                          delete the alert or disable the rule.
                        </p>
                        <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
                          <select value={fpReason} onChange={(event) => setFpReason(event.target.value)}>
                            <option value="">Reason…</option>
                            {vocabulary.falsePositiveReasons.map((value) => (
                              <option key={value} value={value}>{humanize(value)}</option>
                            ))}
                          </select>
                          {assessment ? (
                            <select
                              multiple
                              value={fpRules}
                              onChange={(event) =>
                                setFpRules(
                                  Array.from(event.target.selectedOptions).map((option) => option.value)
                                )
                              }
                              size={3}
                              style={{ minWidth: '16rem' }}
                            >
                              {assessment.triggered_rules.map((rule) => (
                                <option key={rule.code} value={rule.code}>
                                  {rule.code} (+{rule.cappedWeight})
                                </option>
                              ))}
                            </select>
                          ) : null}
                          <button
                            type="button"
                            disabled={busy || !fpReason || fpExplanation.trim().length < vocabulary.minFalsePositiveExplanation}
                            onClick={() =>
                              act('False positive recorded', () =>
                                fsPost(`/alerts/${alert.id}/false-positive`, {
                                  reasonCategory: fpReason,
                                  explanation: fpExplanation.trim(),
                                  ...(fpRules.length ? { ruleCodes: fpRules } : {}),
                                })
                              )
                            }
                          >
                            Report false positive
                          </button>
                        </div>
                        <textarea
                          value={fpExplanation}
                          onChange={(event) => setFpExplanation(event.target.value)}
                          placeholder={`What did you check, and why is this not fraud? At least ${vocabulary.minFalsePositiveExplanation} characters.`}
                          rows={3}
                          style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                        />
                      </div>
                    );
                  }}
                </FsLoad>
              ) : (
                <p className="ch247-page__hint">
                  Your role can read this alert but not record a conclusion on it
                  (<code>fraud_sentinel.investigate</code> is required).
                </p>
              )}

              {canAssign ? (
                <div className="ch247-card">
                  <h3>Reviewer</h3>
                  {reviewerError ? (
                    <p className="ch247-page__hint" role="alert" style={{ color: '#a33' }}>{reviewerError}</p>
                  ) : null}
                  <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
                    <select value={reviewerId} onChange={(event) => setReviewerId(event.target.value)}>
                      <option value="">Unassigned</option>
                      {reviewers.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.fullName || person.email} ({person.role})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        act(
                          reviewerId ? 'Alert assigned' : 'Alert unassigned',
                          () => fsPost(`/alerts/${alert.id}/assign`, { reviewerId: reviewerId || null, note: note.trim() || null })
                        )
                      }
                    >
                      {reviewerId ? 'Assign' : 'Unassign'}
                    </button>
                  </div>
                  <p className="ch247-page__hint">
                    Only an active administrator can hold an investigation. The list is the platform's
                    own staff directory; the server re-checks the role and the account status when you
                    press Assign.
                  </p>
                </div>
              ) : null}
            </div>
          );
        }}
      </FsLoad>
    </FSLayout>
  );
}

/**
 * The note form, kept out of the page body because it owns two local pieces of state (the text and
 * which kind of note it is) and is used twice: a plain note and an explicit "I read the evidence"
 * marker, which is the one thing this module can record about a reviewer's attention.
 */
function NoteForm({ busy, onSend }: { busy: boolean; onSend: (kind: 'note_added' | 'evidence_reviewed', note: string) => void }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'note_added' | 'evidence_reviewed'>('note_added');
  return (
    <div className="ch247-stack">
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
        <select value={kind} onChange={(event) => setKind(event.target.value as 'note_added' | 'evidence_reviewed')}>
          <option value="note_added">Note</option>
          <option value="evidence_reviewed">Evidence reviewed</option>
        </select>
        <button type="button" disabled={busy || text.trim().length < 3} onClick={() => { onSend(kind, text.trim()); setText(''); }}>
          Add to timeline
        </button>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="At least 3 characters. Recorded verbatim on the timeline and in the audit log."
        rows={2}
        style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
      />
    </div>
  );
}
