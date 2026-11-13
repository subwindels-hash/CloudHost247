import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { useApiResource } from '../../lib/useApiResource';
import type {
  CommunityCategory,
  DiscussionSummary,
  MemberProfile,
  MemberSummary,
  Page as PageResult,
} from '../../lib/community-api';
import {
  CommunityBreadcrumb,
  CommunityTabs,
  DiscussionCard,
  EmptyState,
  formatCount,
  LoadError,
  Loading,
  Pagination,
  plural,
  relativeTime,
  standingLabel,
} from '../../components/community/CommunityUI';

/**
 * The community's browse surfaces: all categories, a category, all discussions, search, the member
 * directory, a member profile and the developer area.
 *
 * Every one of them reads a real endpoint through `useApiResource`, which gives the page genuine
 * loading / error / success states. Empty results are stated plainly ("no discussions in this
 * category yet") rather than padded with sample rows.
 */

const PURPOSE_LABEL: Record<string, string> = {
  question: 'Q&A',
  announcement: 'Staff only',
  showcase: 'Showcase',
  discussion: 'Discussion',
};

function CategoryGrid({ categories }: { categories: CommunityCategory[] }) {
  return (
    <div className="community-categories">
      {categories.map((category) => (
        <Link key={category.id} className="community-category-card" to={`/community/category/${category.slug}`}>
          <div className="community-category-card__top">
            <h3>{category.name}</h3>
            <span className="community-category-card__purpose">{PURPOSE_LABEL[category.purpose] ?? 'Discussion'}</span>
          </div>
          <p>{category.description}</p>
          <span className="community-category-card__meta">
            <span>{formatCount(category.discussionCount)} discussions</span>
            <span>{formatCount(category.replyCount)} replies</span>
            <span>{formatCount(category.solvedCount)} solved</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export function CommunityCategoriesPage() {
  usePageMeta('Community categories', 'Browse every CloudHost247 community category, from hosting support to the developer corner.');
  const state = useApiResource<{ categories: CommunityCategory[] }>('/api/v1/community/categories');
  return (
    <div className="community-page">
      <div className="community-wrap">
        <CommunityBreadcrumb trail={[{ label: 'Categories' }]} />
        <header>
          <p className="community-eyebrow">Community</p>
          <h1>Categories</h1>
          <p className="community-form__hint">
            Twelve forums, each with a clear purpose. Questions &amp; Answers and the support categories support
            accepted solutions; Announcements are posted by CloudHost247 staff only.
          </p>
        </header>
        <section className="community-section">
          {state.status === 'loading' && <Loading />}
          {state.status === 'error' && <LoadError message={state.message} />}
          {state.status === 'success' && <CategoryGrid categories={state.data.categories} />}
        </section>
      </div>
    </div>
  );
}

export function CommunityDiscussionsPage() {
  usePageMeta('All discussions', 'Every discussion in the CloudHost247 community forum.');
  const [params, setParams] = useSearchParams();
  const sort = (params.get('sort') ?? 'latest') as 'latest' | 'popular' | 'unanswered' | 'solved' | 'trending';
  const page = Number(params.get('page') ?? 1) || 1;
  const state = useApiResource<PageResult<DiscussionSummary>>(`/api/v1/community/discussions?sort=${sort}&page=${page}`);

  const update = (next: Record<string, string | number>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) merged.set(key, String(value));
    setParams(merged, { replace: true });
  };

  return (
    <div className="community-page">
      <div className="community-wrap">
        <CommunityBreadcrumb trail={[{ label: 'Discussions' }]} />
        <header>
          <p className="community-eyebrow">Community</p>
          <h1>All discussions</h1>
        </header>
        <CommunityTabs
          label="Sort discussions"
          active={sort}
          onChange={(id) => update({ sort: id, page: 1 })}
          items={[
            { id: 'latest', label: 'Latest' },
            { id: 'trending', label: 'Trending' },
            { id: 'popular', label: 'Most reacted' },
            { id: 'unanswered', label: 'Unanswered' },
            { id: 'solved', label: 'Solved' },
          ]}
        />
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError message={state.message} />}
        {state.status === 'success' && (
          <>
            {state.data.items.length === 0 ? (
              <EmptyState title="Nothing here yet" action={<Link className="community-button" to="/community/new-discussion">Start a discussion</Link>}>
                {sort === 'unanswered'
                  ? 'Every question has at least one reply.'
                  : sort === 'solved'
                    ? 'No discussion has an accepted solution yet.'
                    : 'No discussions have been posted yet.'}
              </EmptyState>
            ) : (
              <div className="community-stack">
                {state.data.items.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} />)}
              </div>
            )}
            <Pagination page={state.data.page} pageSize={state.data.pageSize} total={state.data.total} onChange={(next) => update({ page: next })} />
          </>
        )}
      </div>
    </div>
  );
}

export function CommunityCategoryPage() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1) || 1;
  const state = useApiResource<{ category: CommunityCategory; discussions: PageResult<DiscussionSummary> }>(
    `/api/v1/community/categories/${encodeURIComponent(slug)}?page=${page}`
  );
  const title = state.status === 'success' ? state.data.category.name : 'Community category';
  usePageMeta(title, state.status === 'success' ? state.data.category.description : undefined);

  return (
    <div className="community-page">
      <div className="community-wrap">
        <CommunityBreadcrumb trail={[{ label: 'Categories', to: '/community/categories' }, { label: title }]} />
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError message={state.message} />}
        {state.status === 'success' && (
          <>
            <header className="community-thread__head">
              <p className="community-eyebrow">{PURPOSE_LABEL[state.data.category.purpose] ?? 'Discussion'}</p>
              <h1>{state.data.category.name}</h1>
              <p className="community-form__hint">{state.data.category.description}</p>
              <div className="community-thread__meta">
                <span>{formatCount(state.data.category.discussionCount)} discussions</span>
                <span>{formatCount(state.data.category.solvedCount)} accepted solutions</span>
                {state.data.category.staffOnlyPosting && <span>Only CloudHost247 staff can post here</span>}
              </div>
              <div className="community-thread__actions">
                <Link className="community-button" to={`/community/new-discussion?category=${state.data.category.id}`}>
                  New discussion
                </Link>
              </div>
            </header>
            <section className="community-section">
              {state.data.discussions.items.length === 0 ? (
                <EmptyState title="No discussions in this category yet" action={<Link className="community-button" to={`/community/new-discussion?category=${state.data.category.id}`}>Start one</Link>}>
                  Ask the first question here. Include the error you see and what you have already tried — that is
                  what makes an answer possible.
                </EmptyState>
              ) : (
                <div className="community-stack">
                  {state.data.discussions.items.map((discussion) => (
                    <DiscussionCard key={discussion.id} discussion={discussion} showCategory={false} />
                  ))}
                </div>
              )}
              <Pagination
                page={state.data.discussions.page}
                pageSize={state.data.discussions.pageSize}
                total={state.data.discussions.total}
                onChange={(next) => setParams({ page: String(next) }, { replace: true })}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export function CommunitySearchPage() {
  usePageMeta('Search the community', 'Search CloudHost247 community discussions and technical answers.');
  const [params, setParams] = useSearchParams();
  const term = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 1) || 1;
  const state = useApiResource<{ discussions: DiscussionSummary[]; total: number; page: number; pageSize: number }>(
    `/api/v1/community/search?q=${encodeURIComponent(term)}&page=${page}`
  );
  const [draft, setDraft] = useState(term);

  return (
    <div className="community-page">
      <div className="community-wrap">
        <CommunityBreadcrumb trail={[{ label: 'Search' }]} />
        <header>
          <p className="community-eyebrow">Community</p>
          <h1>Search discussions</h1>
        </header>
        <form
          className="community-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setParams(draft.trim() ? { q: draft.trim() } : {}, { replace: true });
          }}
        >
          <label className="sr-only" htmlFor="community-search-input">Search term</label>
          <input
            id="community-search-input"
            type="search"
            value={draft}
            maxLength={120}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="e.g. cPanel SSL, DNS TTL, WordPress permalinks"
          />
          <button type="submit" className="community-button">Search</button>
        </form>
        <section className="community-section">
          {term.trim().length < 2 && (
            <EmptyState title="Type at least two characters">
              Search looks at discussion titles, bodies and tags. Accepted solutions and verified answers are
              included in the results.
            </EmptyState>
          )}
          {term.trim().length >= 2 && state.status === 'loading' && <Loading />}
          {state.status === 'error' && <LoadError message={state.message} />}
          {term.trim().length >= 2 && state.status === 'success' && (
            <>
              <p className="community-form__hint">
                {state.data.total === 0
                  ? `No discussion matches “${term}”.`
                  : `${formatCount(state.data.total)} discussion${state.data.total === 1 ? '' : 's'} match “${term}”.`}
              </p>
              <div className="community-stack">
                {state.data.discussions.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} />)}
              </div>
              <Pagination
                page={state.data.page}
                pageSize={state.data.pageSize}
                total={state.data.total}
                onChange={(next) => setParams({ q: term, page: String(next) }, { replace: true })}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export function CommunityMembersPage() {
  usePageMeta('Community members', 'CloudHost247 community members, their reputation and contributions.');
  const [sort, setSort] = useState<'reputation' | 'active' | 'new'>('reputation');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const state = useApiResource<PageResult<MemberSummary>>(
    `/api/v1/community/members?sort=${sort}&page=${page}${searchTerm ? `&q=${encodeURIComponent(searchTerm)}` : ''}`
  );

  return (
    <div className="community-page">
      <div className="community-wrap">
        <CommunityBreadcrumb trail={[{ label: 'Members' }]} />
        <header>
          <p className="community-eyebrow">Community</p>
          <h1>Members</h1>
          <p className="community-form__hint">
            Members appear here after their first contribution. Members can hide themselves from this directory in
            their community settings; their discussions stay attributed either way.
          </p>
        </header>
        <form
          className="community-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearchTerm(query.trim());
          }}
        >
          <label className="sr-only" htmlFor="community-member-search">Find a member</label>
          <input
            id="community-member-search"
            type="search"
            value={query}
            maxLength={80}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a member by name or username"
          />
          <button type="submit" className="community-button">Search</button>
        </form>
        <CommunityTabs
          label="Sort members"
          active={sort}
          onChange={(id) => {
            setSort(id);
            setPage(1);
          }}
          items={[
            { id: 'reputation', label: 'Top reputation' },
            { id: 'active', label: 'Recently active' },
            { id: 'new', label: 'Newest' },
          ]}
        />
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError message={state.message} />}
        {state.status === 'success' && (
          <>
            {state.data.items.length === 0 ? (
              <EmptyState title="No members to show yet">
                Nobody has contributed to the forum yet, so there is no one to list. Posting a discussion or reply
                creates a community profile automatically.
              </EmptyState>
            ) : (
              <div className="community-members">
                {state.data.items.map((member) => (
                  <article key={member.id} className="community-member-card">
                    <Link to={`/community/member/${encodeURIComponent(member.username)}`}>{member.displayName}</Link>
                    <p>@{member.username} · {standingLabel(member.standing)}</p>
                    <span className="community-member-card__stats">
                      <span>{formatCount(member.reputation)} reputation</span>
                      <span>{formatCount(member.acceptedAnswers)} solutions</span>
                      <span>{formatCount(member.discussionCount + member.replyCount)} posts</span>
                    </span>
                    {member.badges.length > 0 && (
                      <ul className="community-badges">
                        {member.badges.map((badge) => (
                          <li key={badge.slug} className="community-badge-chip"><span aria-hidden="true">{badge.icon}</span>{badge.name}</li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            )}
            <Pagination page={state.data.page} pageSize={state.data.pageSize} total={state.data.total} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

export function CommunityMemberPage() {
  const { username = '' } = useParams();
  const state = useApiResource<MemberProfile>(`/api/v1/community/members/${encodeURIComponent(username)}`);
  const title = state.status === 'success' ? state.data.member.displayName : 'Community member';
  usePageMeta(`${title} · Community`, state.status === 'success' ? `Community profile of ${title}.` : undefined);

  const initial = useMemo(() => title.trim().charAt(0).toUpperCase() || '·', [title]);

  return (
    <div className="community-page">
      <div className="community-wrap">
        <CommunityBreadcrumb trail={[{ label: 'Members', to: '/community/members' }, { label: title }]} />
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError message={state.message} />}
        {state.status === 'success' && (
          <>
            <header className="community-profile__head">
              <span className="community-profile__avatar" aria-hidden="true">{initial}</span>
              <div>
                <h1>{state.data.member.displayName}</h1>
                <p className="community-form__hint">
                  @{state.data.member.username} · {standingLabel(state.data.member.standing)} · joined{' '}
                  {relativeTime(state.data.member.joinedAt)}
                </p>
                {state.data.member.bio && <p>{state.data.member.bio}</p>}
                {state.data.member.location && <p className="community-form__hint">{state.data.member.location}</p>}
                {state.data.member.websiteUrl && (
                  <p className="community-form__hint">
                    <a href={state.data.member.websiteUrl} target="_blank" rel="noopener noreferrer nofollow">
                      {state.data.member.websiteUrl}
                    </a>
                  </p>
                )}
                {state.data.member.badges.length > 0 && (
                  <ul className="community-badges">
                    {state.data.member.badges.map((badge) => (
                      <li key={badge.slug} className="community-badge-chip" title={badge.name}>
                        <span aria-hidden="true">{badge.icon}</span>{badge.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </header>

            <div className="community-admin-grid community-section">
              <dl className="community-metric"><dt>Reputation</dt><dd>{formatCount(state.data.member.reputation)}</dd></dl>
              <dl className="community-metric"><dt>Accepted solutions</dt><dd>{formatCount(state.data.member.acceptedAnswers)}</dd></dl>
              <dl className="community-metric"><dt>Discussions</dt><dd>{formatCount(state.data.member.discussionCount)}</dd></dl>
              <dl className="community-metric"><dt>Replies</dt><dd>{formatCount(state.data.member.replyCount)}</dd></dl>
            </div>

            <section className="community-section" aria-labelledby="member-discussions">
              <div className="community-section__head"><h2 id="member-discussions">Discussions started</h2></div>
              {state.data.discussions.length === 0 ? (
                <EmptyState title="No discussions yet">This member has not started a discussion.</EmptyState>
              ) : (
                <div className="community-stack">
                  {state.data.discussions.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} />)}
                </div>
              )}
            </section>

            <section className="community-section" aria-labelledby="member-replies">
              <div className="community-section__head"><h2 id="member-replies">Recent replies</h2></div>
              {state.data.replies.length === 0 ? (
                <EmptyState title="No replies yet">This member has not replied to a discussion.</EmptyState>
              ) : (
                <ol className="community-notifications">
                  {state.data.replies.map((reply) => (
                    <li key={reply.id} className="community-notification">
                      <strong>
                        <Link to={`/community/discussion/${reply.discussionSlug}`}>{reply.discussionTitle}</Link>
                        {reply.isAccepted && <span className="community-flag community-flag--solved" style={{ marginLeft: 8 }}>✓ Solution</span>}
                      </strong>
                      <p>{reply.preview}</p>
                      <small>{relativeTime(reply.createdAt)}</small>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export function CommunityDevelopersPage() {
  usePageMeta('Developer corner', 'API discussion, server administration and open-source projects from CloudHost247 developers.');
  const state = useApiResource<{
    categories: CommunityCategory[];
    discussions: DiscussionSummary[];
    developers: MemberSummary[];
    members: MemberSummary[];
  }>('/api/v1/community/developers');

  return (
    <div className="community-page">
      <div className="community-wrap">
        <CommunityBreadcrumb trail={[{ label: 'Developer corner' }]} />
        <header className="community-thread__head">
          <p className="community-eyebrow">Developers</p>
          <h1>Developer corner</h1>
          <p className="community-form__hint">
            API discussions, integrations, Linux and hosting configuration, database work, security practice and
            open-source projects. Code belongs in fenced blocks — it is rendered in the thread with syntax-coloured
            monospace and never interpreted as HTML.
          </p>
          <div className="community-thread__actions">
            <Link className="community-button" to="/community/new-discussion?category=developer-corner">
              Start a developer discussion
            </Link>
          </div>
        </header>

        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError message={state.message} />}
        {state.status === 'success' && (
          <>
            <section className="community-section" aria-labelledby="developer-forums">
              <div className="community-section__head"><h2 id="developer-forums">Technical forums</h2></div>
              <CategoryGrid categories={state.data.categories} />
            </section>

            <div className="community-columns community-section">
              <section aria-labelledby="developer-discussions">
                <div className="community-section__head"><h2 id="developer-discussions">Developer corner discussions</h2></div>
                {state.data.discussions.length === 0 ? (
                  <EmptyState title="No developer discussions yet" action={<Link className="community-button" to="/community/new-discussion?category=developer-corner">Be the first</Link>}>
                    Share a project, a configuration problem or an API question. Include the versions and the exact
                    error you see.
                  </EmptyState>
                ) : (
                  <div className="community-stack">
                    {state.data.discussions.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} showCategory={false} />)}
                  </div>
                )}
              </section>
              <aside className="community-stack" aria-label="Developer contributors">
                <section className="community-panel">
                  <h2>Verified developers</h2>
                  {state.data.developers.length === 0 ? (
                    <p className="community-form__hint">
                      No member holds a verified developer designation yet. Only a CloudHost247 super administrator can
                      grant one — it is never self-assigned.
                    </p>
                  ) : (
                    <ul className="community-notifications">
                      {state.data.developers.map((member) => (
                        <li key={member.id} className="community-notification">
                          <strong><Link to={`/community/member/${encodeURIComponent(member.username)}`}>{member.displayName}</Link></strong>
                          <small>{standingLabel(member.standing)} · {formatCount(member.acceptedAnswers)} solutions</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="community-panel">
                  <h2>Top contributors</h2>
                  {state.data.members.length === 0 ? (
                    <p className="community-form__hint">Contribution rankings appear once members start answering.</p>
                  ) : (
                    <ul className="community-notifications">
                      {state.data.members.map((member) => (
                        <li key={member.id} className="community-notification">
                          <strong><Link to={`/community/member/${encodeURIComponent(member.username)}`}>{member.displayName}</Link></strong>
                          <small>{formatCount(member.reputation)} reputation</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
