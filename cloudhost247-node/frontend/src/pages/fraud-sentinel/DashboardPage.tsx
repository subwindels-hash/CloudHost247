/**
 * Fraud Sentinel dashboard — the counts, the risk distribution and the newest alerts.
 *
 * Every number on this screen is a count of stored rows: alerts raised, assessments recorded, false
 * positives reported, runs finished. Nothing is modelled or extrapolated, and the advisory contract
 * is rendered next to the figures rather than in a footer, because a score presented without it reads
 * as a decision the platform took.
 */
import { Link } from 'react-router-dom';
import FSLayout from '../../components/fraud-sentinel/FSLayout';
import {
  AdvisoryNotice,
  FsBadge,
  FsLoad,
  MetricCard,
  MetricRow,
  timeAgo,
  useFsData,
} from '../../components/fraud-sentinel/fs-widgets';
import type { DashboardOverview } from '../../lib/fraud-sentinel-api';

export default function FSDashboardPage() {
  const { state } = useFsData<DashboardOverview>('/overview', { days: 30 });

  return (
    <FSLayout
      title="Detection Dashboard"
      hint="Counts of what the module recorded over the last 30 days. An alert is a request for a human to look — it is not a decision, and nothing was changed because of it."
    >
      <FsLoad state={state}>
        {(data) => (
          <div className="ch247-stack">
            <AdvisoryNotice advisory={data.advisory} />

            <h3>Alerts</h3>
            <MetricRow>
              <MetricCard
                label="Open"
                value={<Link to="/admin/fraud-sentinel/alerts?status=open">{data.alerts.open}</Link>}
                hint="new + under review + escalated"
              />
              <MetricCard label="New" value={<Link to="/admin/fraud-sentinel/alerts?status=new">{data.alerts.new}</Link>} />
              <MetricCard label="Under review" value={<Link to="/admin/fraud-sentinel/alerts?status=under_review">{data.alerts.underReview}</Link>} />
              <MetricCard label="Escalated" value={<Link to="/admin/fraud-sentinel/alerts?status=escalated">{data.alerts.escalated}</Link>} />
              <MetricCard label="High or critical" value={<Link to="/admin/fraud-sentinel/alerts?riskLevel=high">{data.alerts.highOrCritical}</Link>} hint="level high, or a critical-severity rule fired" />
            </MetricRow>
            <MetricRow>
              <MetricCard label="Unassigned" value={<Link to="/admin/fraud-sentinel/alerts?unassigned=true">{data.alerts.unassigned}</Link>} />
              <MetricCard label="Resolved" value={data.alerts.resolved} />
              <MetricCard label="Reported false positive" value={data.alerts.falsePositive} hint="A reviewer disagreed — see the rule feedback report" />
              <MetricCard label="Total in window" value={data.alerts.total} hint={`window ${data.window.since.slice(0, 10)} → ${data.window.until.slice(0, 10)}`} />
            </MetricRow>

            <h3>Current risk distribution</h3>
            <p className="ch247-page__hint">
              Active assessments per level — one row per subject, the latest assessment only.
            </p>
            <MetricRow>
              {data.riskDistribution.map((entry) => (
                <MetricCard key={entry.level} label={`Level ${entry.level}`} value={<FsBadge value={entry.level} />} hint={`${entry.subjects} subject(s)`} />
              ))}
              {data.riskDistribution.length === 0 ? <p className="ch247-page__hint">No subject has been assessed yet.</p> : null}
            </MetricRow>

            <h3>Confidence</h3>
            <MetricRow>
              {data.confidenceBreakdown.map((entry) => (
                <MetricCard key={entry.confidence} label={`${entry.confidence} confidence`} value={entry.assessments} hint="assessments recorded" />
              ))}
              {data.confidenceBreakdown.length === 0 ? <p className="ch247-page__hint">No assessments recorded yet.</p> : null}
            </MetricRow>

            <h3>Alerts by category</h3>
            <MetricRow>
              {data.byCategory.map((entry) => (
                <MetricCard key={entry.category} label={entry.category} value={<Link to={`/admin/fraud-sentinel/alerts?category=${entry.category}`}>{entry.alerts}</Link>} />
              ))}
              {data.byCategory.length === 0 ? <p className="ch247-page__hint">No alerts in this window.</p> : null}
            </MetricRow>

            <h3>Rules producing alerts</h3>
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Alerts</th>
                    <th>False positives</th>
                    <th>Disagreement</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topRules.map((rule) => (
                    <tr key={rule.code}>
                      <td><Link to={`/admin/fraud-sentinel/rules?search=${rule.code}`}><code>{rule.code}</code></Link></td>
                      <td>{rule.alerts}</td>
                      <td>{rule.falsePositives}</td>
                      <td>
                        {rule.alerts === 0 ? (
                          <span className="ch247-page__hint">no alerts — untested</span>
                        ) : (
                          <span className="ch247-page__hint">{Math.round((rule.falsePositives / rule.alerts) * 100)}% of its alerts were reported false</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.topRules.length === 0 ? (
                    <tr><td colSpan={4} className="ch247-page__hint">No rule has produced an alert in this window.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <h3>Highest-risk customers</h3>
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Score</th>
                    <th>Level</th>
                    <th>Open alerts</th>
                    <th>Assessed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.highestRiskCustomers.map((customer) => (
                    <tr key={customer.customer_id}>
                      <td>
                        <Link to={`/admin/fraud-sentinel/customers/${customer.customer_id}`}>
                          {customer.email ?? customer.customer_id}
                        </Link>
                        {customer.full_name ? <span className="ch247-page__hint"> — {customer.full_name}</span> : null}
                      </td>
                      <td>{customer.risk_score} / 100</td>
                      <td><FsBadge value={customer.risk_level} /></td>
                      <td>{customer.open_alerts}</td>
                      <td className="ch247-page__hint">{timeAgo(customer.assessed_at)}</td>
                    </tr>
                  ))}
                  {data.highestRiskCustomers.length === 0 ? (
                    <tr><td colSpan={5} className="ch247-page__hint">No customer assessment on record.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <h3>Newest alerts</h3>
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th>Alert</th>
                    <th>Detected</th>
                    <th>Level</th>
                    <th>Status</th>
                    <th>Reviewer</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentAlerts.map((alert) => (
                    <tr key={alert.id}>
                      <td>
                        <Link to={`/admin/fraud-sentinel/alerts/${alert.id}`}>{alert.alert_number}</Link>{' '}
                        <span className="ch247-page__hint">{alert.title}</span>
                      </td>
                      <td className="ch247-page__hint">{timeAgo(alert.detected_at)}</td>
                      <td><FsBadge value={alert.risk_level} /> <span className="ch247-page__hint">{alert.risk_score}</span></td>
                      <td><FsBadge value={alert.status} /></td>
                      <td>{alert.reviewer_name ?? <span className="ch247-page__hint">unassigned</span>}</td>
                    </tr>
                  ))}
                  {data.recentAlerts.length === 0 ? (
                    <tr><td colSpan={5} className="ch247-page__hint">No alert recorded yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <h3>Automation</h3>
            <p className="ch247-page__hint">
              {data.lastRun
                ? <>Last recorded pass: <strong>{data.lastRun.job_name}</strong> — <FsBadge value={data.lastRun.status} /> started {timeAgo(data.lastRun.started_at)}.</>
                : 'No scheduled pass has run yet. The worker sweep runs ingest → scan → retention → rule sync on its own interval.'}
              {' '}<Link to="/admin/fraud-sentinel/operations">Operations →</Link>
            </p>
          </div>
        )}
      </FsLoad>
    </FSLayout>
  );
}
