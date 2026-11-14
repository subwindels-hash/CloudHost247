import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { usePageMeta } from '../../lib/usePageMeta';
import { communityApi, type CommunityCategory } from '../../lib/community-api';
import {
  CommunityTabs,
  EmptyState,
  formatCount,
  LoadError,
  Loading,
  relativeTime,
  useCommunityMe,
} from '../../components/community/CommunityUI';

/**
 * `/admin/community` — the community control room.
 *
 * Only admins and super admins reach this page (RequireRole in the router, and `requireRole` on every
 * endpoint behind it). Two things are visibly separated rather than blended:
 *
 *   • moderation — categories, reports, pins/locks, removals and posting restrictions: any admin;
 *   • authority    — roles, badges and publishing a verified answer to the AI knowledge base:
 *                    super admin only. The buttons are hidden for a plain admin, and the server
 *                    answers 403 even if they are called directly.
 */

type Overview = Awaited<ReturnType<typeof communityApi.admin.overview>>;
type Report = Overview['recentReports'][number];
type Solution = Awaited<ReturnType<typeof communityApi.admin.solutions>>['solutions'][number];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'categories', label: 'Categories' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'solutions', label: 'AI knowledge' },
  { id: 'audit', label: 'Audit log' },
] as const;

export default function AdminCommunityPage() {
  usePageMeta('Community administration', 'Moderate the CloudHost247 community forum.');
  const { identity } = useCommunityMe();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [solutions, setSolutions] = useState<Solution[] | null>(null);
  const [categories, setCategories] = useState<CommunityCategory[] | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState({ slug: '', name: '', description: '', purpose: 'discussion' });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [overviewData, categoryData, reportData, solutionData] = await Promise.all([
        communityApi.admin.overview(),
        communityApi.admin.categories(),
        communityApi.admin.reports('open'),
        communityApi.admin.solutions(),
      ]);
      setOverview(overviewData);
      setCategories(categoryData.categories);
      setReports(reportData.reports);
      setSolutions(solutionData.solutions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The community console could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'That action could not be completed.');
    }
  };

  const createCategory = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () =>
        communityApi.admin.createCategory({
          slug: newCategory.slug.trim(),
          name: newCategory.name.trim(),
          description: newCategory.description.trim(),
          purpose: newCategory.purpose,
        }),
      'Category created.'
    );
    setNewCategory({ slug: '', name: '', description: '', purpose: 'discussion' });
  };

  return (
    <div className="community-page">
      <div className="community-wrap">
        <header>
          <p className="community-eyebrow">Administration</p>
          <h1>Community console</h1>
          <p className="community-form__hint">
            {identity ? `Signed in as ${identity.displayName} (${identity.isSuperAdmin ? 'super administrator' : 'administrator'}). ` : ''}
            Every action below is written to the platform audit log.
          </p>
        </header>

        <CommunityTabs label="Community administration sections" active={tab} onChange={setTab} items={[...TABS]} />

        {notice && <p className="community-note" role="status">{notice}</p>}
        {error && <LoadError message={error} onRetry={() => void load()} />}
        {!overview && !error && <Loading label="Loading community console…" />}

        {tab === 'overview' && overview && (
          <>
            <dl className="community-admin-grid">
              <div className="community-metric"><dt>Discussions</dt><dd>{formatCount(overview.totals.discussions)}</dd></div>
              <div className="community-metric"><dt>Replies</dt><dd>{formatCount(overview.totals.replies)}</dd></div>
              <div className="community-metric"><dt>Members</dt><dd>{formatCount(overview.totals.members)}</dd></div>
              <div className="community-metric"><dt>Solved</dt><dd>{formatCount(overview.totals.solved)}</dd></div>
              <div className="community-metric"><dt>Open reports</dt><dd>{formatCount(overview.totals.openReports)}</dd></div>
              <div className="community-metric"><dt>Restricted members</dt><dd>{formatCount(overview.totals.restricted)}</dd></div>
              <div className="community-metric"><dt>AI-published answers</dt><dd>{formatCount(overview.totals.publishedSolutions)}</dd></div>
            </dl>

            <section className="community-section">
              <div className="community-section__head"><h2>Community staff</h2></div>
              {overview.staff.length === 0 ? (
                <EmptyState title="No community designations granted">
                  Platform administrators can moderate without a designation. Grant a moderator, developer or staff
                  designation from a member profile — only a super administrator can.
                </EmptyState>
              ) : (
                <table className="community-table">
                  <thead>
                    <tr><th scope="col">Member</th><th scope="col">Designations</th></tr>
                  </thead>
                  <tbody>
                    {overview.staff.map((member) => (
                      <tr key={member.userId}>
                        <td>{member.displayName} <code>@{member.username || '—'}</code></td>
                        <td>{member.designations.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}

        {tab === 'categories' && categories && (
          <section className="community-section">
            <div className="community-section__head"><h2>Categories</h2><p>Order, purpose and staff-only posting are enforced by the server.</p></div>
            <table className="community-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Slug</th>
                  <th scope="col">Purpose</th>
                  <th scope="col">Discussions</th>
                  <th scope="col">State</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td>{category.name}</td>
                    <td><code>{category.slug}</code></td>
                    <td>{category.purpose}{category.staffOnlyPosting ? ' · staff only' : ''}</td>
                    <td>{formatCount(category.discussionCount)}</td>
                    <td>{category.isEnabled ? 'Enabled' : 'Disabled'}</td>
                    <td>
                      <div className="community-admin-actions">
                        <button
                          type="button"
                          className="community-button community-button--quiet community-button--sm"
                          onClick={() => void run(() => communityApi.admin.updateCategory(category.id, { isEnabled: !category.isEnabled }), category.isEnabled ? 'Category disabled.' : 'Category enabled.')}
                        >
                          {category.isEnabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          className="community-button community-button--quiet community-button--sm"
                          onClick={() => void run(() => communityApi.admin.updateCategory(category.id, { position: Math.max(0, category.position - 1) }), 'Category reordered.')}
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          className="community-button community-button--quiet community-button--sm"
                          onClick={() => void run(() => communityApi.admin.updateCategory(category.id, { position: category.position + 1 }), 'Category reordered.')}
                        >
                          Move down
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <form className="community-form community-section" onSubmit={createCategory}>
              <fieldset>
                <legend>New category</legend>
                <div className="community-form__row">
                  <label>
                    Name
                    <input type="text" value={newCategory.name} maxLength={120} onChange={(event) => setNewCategory({ ...newCategory, name: event.target.value })} required />
                  </label>
                  <label>
                    Slug
                    <input type="text" value={newCategory.slug} maxLength={64} onChange={(event) => setNewCategory({ ...newCategory, slug: event.target.value })} placeholder="e.g. security" required />
                  </label>
                  <label>
                    Purpose
                    <select value={newCategory.purpose} onChange={(event) => setNewCategory({ ...newCategory, purpose: event.target.value })}>
                      <option value="discussion">Discussion</option>
                      <option value="question">Question (accepted solutions)</option>
                      <option value="showcase">Showcase</option>
                      <option value="announcement">Announcement (staff only)</option>
                    </select>
                  </label>
                </div>
                <label>
                  Description
                  <input type="text" value={newCategory.description} maxLength={400} onChange={(event) => setNewCategory({ ...newCategory, description: event.target.value })} required />
                </label>
              </fieldset>
              <div className="community-form__actions">
                <button type="submit" className="community-button">Create category</button>
              </div>
            </form>
          </section>
        )}

        {tab === 'moderation' && (
          <section className="community-section">
            <div className="community-section__head"><h2>Open reports</h2><p>Resolving a report records the decision in the audit log.</p></div>
            {!reports ? (
              <Loading />
            ) : reports.length === 0 ? (
              <EmptyState title="No open reports">Nothing has been reported. Reported discussions and replies appear here with the reason and the reporter.</EmptyState>
            ) : (
              <table className="community-table">
                <thead>
                  <tr><th scope="col">Target</th><th scope="col">Reason</th><th scope="col">Reported by</th><th scope="col">When</th><th scope="col">Actions</th></tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr key={report.id}>
                      <td><code>{report.targetType}</code><br /><code>{report.targetId}</code></td>
                      <td>{report.reason}{report.detail ? <p className="community-form__hint">{report.detail}</p> : null}</td>
                      <td>@{report.reporter}</td>
                      <td>{relativeTime(report.createdAt)}</td>
                      <td>
                        <div className="community-admin-actions">
                          <button
                            type="button"
                            className="community-button community-button--quiet community-button--sm"
                            onClick={() => void run(() => communityApi.admin.resolveReport(report.id, 'actioned', 'Actioned by a moderator'), 'Report actioned.')}
                          >
                            Action
                          </button>
                          <button
                            type="button"
                            className="community-button community-button--quiet community-button--sm"
                            onClick={() => void run(() => communityApi.admin.resolveReport(report.id, 'dismissed', 'No action needed'), 'Report dismissed.')}
                          >
                            Dismiss
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {tab === 'solutions' && (
          <section className="community-section">
            <div className="community-section__head"><h2>Verified community answers</h2><p>Only these, and only after a super administrator verifies them, can be retrieved by the AI assistant.</p></div>
            <p className="community-note">
              A verified answer is stored with the trust model&rsquo;s <strong>approved</strong> status and authority tier 4 —
              below official pages and documentation, above unreviewed sources. Editing the thread withdraws its approval
              automatically until it is verified again.
            </p>
            {!solutions ? (
              <Loading />
            ) : solutions.length === 0 ? (
              <EmptyState title="Nothing published to the knowledge base yet">
                Open a solved discussion and choose “Verify for AI answers”. The assistant will only ever quote answers
                that were verified this way.
              </EmptyState>
            ) : (
              <table className="community-table">
                <thead>
                  <tr><th scope="col">Answer</th><th scope="col">Status</th><th scope="col">Chunks</th><th scope="col">Last synced</th></tr>
                </thead>
                <tbody>
                  {solutions.map((solution) => (
                    <tr key={solution.id}>
                      <td>{solution.title}{solution.url ? <><br /><code>{solution.url}</code></> : null}</td>
                      <td>{solution.approval_status} · {solution.sync_status}{solution.excluded ? ' · excluded' : ''}</td>
                      <td>{solution.chunk_count}</td>
                      <td>{solution.last_synced_at ? relativeTime(solution.last_synced_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {tab === 'audit' && overview && (
          <section className="community-section">
            <div className="community-section__head"><h2>Moderation audit trail</h2><p>Rows come from the platform audit log; they are append-only.</p></div>
            {overview.recentActions.length === 0 ? (
              <EmptyState title="No community actions recorded yet">Category changes, moderate removals, role grants, restrictions and knowledge-base publications appear here.</EmptyState>
            ) : (
              <table className="community-table">
                <thead>
                  <tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Resource</th><th scope="col">Details</th></tr>
                </thead>
                <tbody>
                  {overview.recentActions.map((action) => (
                    <tr key={action.id}>
                      <td>{relativeTime(action.createdAt)}</td>
                      <td><code>{action.action}</code></td>
                      <td>{action.resourceType}{action.resourceId ? <><br /><code>{action.resourceId}</code></> : null}</td>
                      <td><code>{JSON.stringify(action.metadata)}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
