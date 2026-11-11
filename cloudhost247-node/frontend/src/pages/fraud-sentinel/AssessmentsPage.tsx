/**
 * Assessments — the scored results themselves, for every subject type, not only customers.
 *
 * The alert queue shows only the results that crossed the alert threshold; this screen shows all of
 * them, including the low and medium scores that were recorded and deliberately not escalated, and
 * the subjects that are not customers at all (an IP address, a webhook gateway, a staff account).
 * That distinction matters: a reviewer asking "did we look at this and decide it was fine?" needs the
 * stored assessment, not the absence of an alert.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FSLayout from '../../components/fraud-sentinel/FSLayout';
import {
  AdvisoryNotice,
  DataQualityFlags,
  EvidenceList,
  FamilyContributions,
  FsBadge,
  FsLoad,
  FsTable,
  KeyValue,
  Paginator,
  Recommendations,
  ScoreMeter,
  TriggeredRulesTable,
  formatDateTime,
  humanize,
  useFsData,
  useFsMeta,
} from '../../components/fraud-sentinel/fs-widgets';
import type { AdvisoryOnly, AssessmentRow, EvidenceIntegrity } from '../../lib/fraud-sentinel-api';

interface AssessmentsPageData {
  items: AssessmentRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  advisory: AdvisoryOnly;
}

interface AssessmentDetailData {
  assessment: AssessmentRow;
  evidenceIntegrity: EvidenceIntegrity;
  advisory: AdvisoryOnly;
}

export default function AssessmentsPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <Detail assessmentId={id} /> : <List />;
}

function List() {
  const meta = useFsMeta();
  const [page, setPage] = useState(1);
  const [subjectType, setSubjectType] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [status, setStatus] = useState('active');
  const [minScore, setMinScore] = useState('');
  const [ruleCode, setRuleCode] = useState('');
  const [days, setDays] = useState('');
  const limit = 25;

  const { state } = useFsData<AssessmentsPageData>('/assessments', {
    page,
    limit,
    subjectType: subjectType || undefined,
    riskLevel: riskLevel || undefined,
    status: status || undefined,
    minScore: minScore || undefined,
    ruleCode: ruleCode.trim() || undefined,
    days: days || undefined,
  });

  return (
    <FSLayout
      title="Assessments"
      hint="Every scored result the engine stored, including the ones that never became an alert. A score describes recorded activity; it is not a verdict and nothing was changed because of it."
    >
      <div className="ch247-stack">
        <FsLoad state={meta}>
          {(vocabulary) => (
            <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
              <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                <option value="active">Current only</option>
                <option value="superseded">Superseded only</option>
                <option value="">Any</option>
              </select>
              <select value={subjectType} onChange={(event) => { setSubjectType(event.target.value); setPage(1); }}>
                <option value="">Any subject</option>
                {vocabulary.subjectTypes.map((value) => (
                  <option key={value} value={value}>{humanize(value)}</option>
                ))}
              </select>
              <select value={riskLevel} onChange={(event) => { setRiskLevel(event.target.value); setPage(1); }}>
                <option value="">Any level</option>
                {vocabulary.levels.map((value) => (
                  <option key={value} value={value}>{humanize(value)}</option>
                ))}
              </select>
              <select value={minScore} onChange={(event) => { setMinScore(event.target.value); setPage(1); }}>
                <option value="">Any score</option>
                <option value="25">25 and above</option>
                <option value="50">50 and above</option>
                <option value="75">75 and above</option>
              </select>
              <select value={days} onChange={(event) => { setDays(event.target.value); setPage(1); }}>
                <option value="">Any time</option>
                <option value="1">Last 24 hours</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
              <input
                placeholder="Rule code, e.g. PAY_REPEATED_FAILURES"
                value={ruleCode}
                onChange={(event) => { setRuleCode(event.target.value); setPage(1); }}
                style={{ flex: '1 1 220px', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
              />
            </div>
          )}
        </FsLoad>

        <FsLoad state={state}>
          {(data) => (
            <>
              <AdvisoryNotice advisory={data.advisory} compact />
              <FsTable<AssessmentRow>
                columns={[
                  { header: 'Assessed', render: (row) => <span className="ch247-page__hint">{formatDateTime(row.assessed_at)}</span> },
                  {
                    header: 'Subject',
                    render: (row) =>
                      row.customer_id ? (
                        <Link to={`/admin/fraud-sentinel/customers/${row.customer_id}`}>
                          {row.customer_email ?? 'customer'}
                        </Link>
                      ) : (
                        <span>
                          <FsBadge value={row.subject_type} /> {row.subject_label ?? row.subject_id ?? '—'}
                        </span>
                      ),
                  },
                  { header: 'Score', render: (row) => <><strong>{row.risk_score}</strong> <FsBadge value={row.risk_level} /></> },
                  { header: 'Confidence', render: (row) => <FsBadge value={row.confidence} /> },
                  { header: 'Rules fired', render: (row) => row.triggered_rules.length },
                  {
                    header: 'Primary reason',
                    render: (row) => {
                      const primary = row.triggered_rules[0];
                      return primary ? <code>{primary.code}</code> : <span className="ch247-page__hint">no rule fired</span>;
                    },
                  },
                  { header: 'Events', render: (row) => row.events_examined },
                  { header: 'Status', render: (row) => <FsBadge value={row.status} /> },
                  { header: '', render: (row) => <Link to={`/admin/fraud-sentinel/assessments/${row.id}`}>Derivation →</Link> },
                ]}
                rows={data.items}
                empty="No assessment matches the current filters. Assessments are stored on every pass, so an empty list means nothing in the recorded activity matched a rule inside the window."
                keyOf={(row) => row.id}
              />
              <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
            </>
          )}
        </FsLoad>
      </div>
    </FSLayout>
  );
}

function Detail({ assessmentId }: { assessmentId: string }) {
  const { state } = useFsData<AssessmentDetailData>(`/assessments/${assessmentId}`);

  return (
    <FSLayout
      title="Assessment"
      hint="The full derivation of one stored score: the rules that fired, what each contributed, which family cap bit, and the evidence rows behind it."
      actions={
        <div className="ch247-inline-actions">
          <Link to="/admin/fraud-sentinel/assessments">← All assessments</Link>
        </div>
      }
    >
      <FsLoad state={state}>
        {(data) => {
          const assessment = data.assessment;
          return (
            <div className="ch247-stack">
              <AdvisoryNotice advisory={data.advisory} />
              <ScoreMeter score={assessment.risk_score} level={assessment.risk_level} />

              <KeyValue
                rows={[
                  [
                    'Subject',
                    assessment.customer_id ? (
                      <Link to={`/admin/fraud-sentinel/customers/${assessment.customer_id}`}>
                        {assessment.customer_email ?? assessment.customer_id}
                        {assessment.customer_name ? ` — ${assessment.customer_name}` : ''}
                      </Link>
                    ) : (
                      <span>
                        {humanize(assessment.subject_type)} · {assessment.subject_label ?? assessment.subject_id ?? 'unknown'}
                      </span>
                    ),
                  ],
                  ['Assessed', formatDateTime(assessment.assessed_at)],
                  ['Status', <FsBadge value={assessment.status} />],
                  ['Confidence', <FsBadge value={assessment.confidence} />],
                  ['Rule set version', <code>{assessment.rule_set_version}</code>],
                  ['Scoring version', assessment.scoring_version],
                  ['Window', `${formatDateTime(assessment.window_started_at)} → ${formatDateTime(assessment.window_ended_at)}`],
                  ['Events examined', assessment.events_examined],
                  [
                    'Previous assessment',
                    assessment.previous_score === null ? (
                      <span className="ch247-page__hint">first for this subject</span>
                    ) : (
                      <span>
                        {assessment.previous_score} ({assessment.previous_level ?? '—'}) —{' '}
                        {assessment.previous_assessment_id ? (
                          <Link to={`/admin/fraud-sentinel/assessments/${assessment.previous_assessment_id}`}>open it →</Link>
                        ) : (
                          'row pruned by retention'
                        )}
                      </span>
                    ),
                  ],
                  [
                    'AI assistance',
                    assessment.ai_assisted ? (
                      <span>
                        <FsBadge value={assessment.ai_engine ?? 'ai'} /> — {assessment.ai_summary ?? 'no summary recorded'}
                      </span>
                    ) : (
                      <span className="ch247-page__hint">none — every figure here is computed by the deterministic rule engine</span>
                    ),
                  ],
                ]}
              />

              <h3>Rules that fired</h3>
              <TriggeredRulesTable rules={assessment.triggered_rules} />

              <h3>Family contributions</h3>
              <FamilyContributions contributions={assessment.family_contributions} />

              <h3>Data quality</h3>
              <DataQualityFlags flags={assessment.data_quality} />

              <h3>Evidence</h3>
              <EvidenceList evidence={assessment.evidence} integrity={data.evidenceIntegrity} />

              <h3>Recommendations</h3>
              <Recommendations items={assessment.recommendations} />
            </div>
          );
        }}
      </FsLoad>
    </FSLayout>
  );
}
