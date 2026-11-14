import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { useApiResource } from '../../lib/useApiResource';
import type { CommunityHome } from '../../lib/community-api';
import { useAuthState } from '../../layout/useAuthState';
import {
  DiscussionCard,
  EmptyState,
  formatCount,
  LoadError,
  plural,
  Loading,
  relativeTime,
  standingLabel,
} from '../../components/community/CommunityUI';

const PURPOSE_LABEL: Record<string, string> = {
  question: 'Q&A',
  announcement: 'Announcements',
  showcase: 'Showcase',
  discussion: 'Discussion',
};

/**
 * `/community` — the Community home.
 *
 * Everything on this page comes from `/api/v1/community/home` in one request: real counts, real
 * threads, real members. A brand-new forum therefore renders its honest empty states ("no
 * discussions yet") instead of an invented demo board, and the statistics can never drift from the
 * lists they summarise because they are read in the same query.
 */
export default function CommunityHomePage() {
  usePageMeta(
    'Community Forum',
    'Ask questions, share hosting and developer knowledge, and find verified answers from the CloudHost247 community.'
  );
  const state = useApiResource<CommunityHome>('/api/v1/community/home');
  const { token } = useAuthState();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    navigate(term.trim() ? `/community/search?q=${encodeURIComponent(term.trim())}` : '/community/search');
  };

  return (
    <div className="community-page">
      <div className="community-wrap">
        <section className="community-hero" aria-labelledby="community-title">
          <div>
            <p className="community-eyebrow">Community Forum</p>
            <h1 id="community-title">Ask, answer, and build together.</h1>
            <p className="community-hero__lede">
              A place for CloudHost247 customers, developers and system administrators to solve real problems
              together — hosting support, domains and DNS, servers, WordPress, web development and verified
              technical guides.
            </p>
            <form className="community-search" role="search" onSubmit={onSearch}>
              <label className="sr-only" htmlFor="community-home-search">
                Search discussions
              </label>
              <input
                id="community-home-search"
                type="search"
                maxLength={120}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search discussions — DNS, cPanel, WordPress, SSL…"
              />
              <button type="submit" className="community-button">Search</button>
            </form>
            <div className="community-hero__actions">
              {token ? (
                <Link className="community-button community-button--gold" to="/community/new-discussion">
                  Start a discussion
                </Link>
              ) : (
                <>
                  <Link className="community-button community-button--gold" to="/register">
                    Join the community
                  </Link>
                  <Link className="community-button community-button--quiet" to="/login">
                    Sign in to post
                  </Link>
                </>
              )}
              <Link className="community-button community-button--quiet" to="/community/developers">
                Developer corner
              </Link>
            </div>
          </div>
          <dl className="community-hero__aside" aria-label="Community statistics">
            {state.status === 'success' ? (
              <>
                <div className="community-hero__stat"><dt>Members</dt><dd>{formatCount(state.data.stats.members)}</dd></div>
                <div className="community-hero__stat"><dt>Discussions</dt><dd>{formatCount(state.data.stats.discussions)}</dd></div>
                <div className="community-hero__stat"><dt>Replies</dt><dd>{formatCount(state.data.stats.replies)}</dd></div>
                <div className="community-hero__stat"><dt>Accepted solutions</dt><dd>{formatCount(state.data.stats.solved)}</dd></div>
              </>
            ) : (
              <div className="community-hero__stat"><dt>Community</dt><dd>…</dd></div>
            )}
          </dl>
        </section>

        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError message={state.message} />}

        {state.status === 'success' && (
          <>
            <section className="community-section" aria-labelledby="community-categories-title">
              <div className="community-section__head">
                <h2 id="community-categories-title">Popular categories</h2>
                <Link to="/community/categories">All twelve categories →</Link>
              </div>
              <div className="community-categories">
                {state.data.categories.slice(0, 8).map((category) => (
                  <Link key={category.id} className="community-category-card" to={`/community/category/${category.slug}`}>
                    <div className="community-category-card__top">
                      <h3>{category.name}</h3>
                      <span className="community-category-card__purpose">{PURPOSE_LABEL[category.purpose] ?? 'Discussion'}</span>
                    </div>
                    <p>{category.description}</p>
                    <span className="community-category-card__meta">
                      <span>{formatCount(category.discussionCount)} discussions</span>
                      <span>{formatCount(category.solvedCount)} solved</span>
                      {category.lastActivityAt && <span>active {relativeTime(category.lastActivityAt)}</span>}
                    </span>
                  </Link>
                ))}
              </div>
            </section>

            <div className="community-columns community-section">
              <section aria-labelledby="community-latest-title">
                <div className="community-section__head">
                  <h2 id="community-latest-title">Latest discussions</h2>
                  <Link to="/community/discussions">Browse everything →</Link>
                </div>
                <div className="community-stack">
                  {state.data.latest.length === 0 ? (
                    <EmptyState
                      title="No discussions yet"
                      action={
                        token ? (
                          <Link className="community-button" to="/community/new-discussion">Start the first discussion</Link>
                        ) : (
                          <Link className="community-button" to="/register">Create an account to post</Link>
                        )
                      }
                    >
                      The forum is new and the first question is still open. Ask about hosting, DNS, servers or
                      development — a CloudHost247 engineer or another member will answer.
                    </EmptyState>
                  ) : (
                    state.data.latest.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} />)
                  )}
                </div>
              </section>

              <aside className="community-stack" aria-label="Community highlights">
                <section className="community-panel">
                  <h2>Trending this week</h2>
                  {state.data.trending.length === 0 ? (
                    <p className="community-form__hint">Nothing is trending yet. Activity from the last seven days appears here.</p>
                  ) : (
                    <ol className="community-notifications">
                      {state.data.trending.map((discussion) => (
                        <li key={discussion.id} className="community-notification">
                          <strong><Link to={`/community/discussion/${discussion.slug}`}>{discussion.title}</Link></strong>
                          <small>{formatCount(discussion.replyCount)} replies · {formatCount(discussion.reactionCount)} reactions</small>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                <section className="community-panel">
                  <h2>Unanswered questions</h2>
                  {state.data.unanswered.length === 0 ? (
                    <p className="community-form__hint">Every question has at least one reply. Nothing is waiting for an answer.</p>
                  ) : (
                    <ul className="community-notifications">
                      {state.data.unanswered.map((discussion) => (
                        <li key={discussion.id} className="community-notification">
                          <strong><Link to={`/community/discussion/${discussion.slug}`}>{discussion.title}</Link></strong>
                          <small>{discussion.category.name} · asked {relativeTime(discussion.createdAt)}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="community-panel community-panel--tint">
                  <h2>Recently active members</h2>
                  {state.data.contributors.length === 0 ? (
                    <p className="community-form__hint">
                      Member profiles appear after their first contribution — the forum does not list accounts that
                      have not taken part.
                    </p>
                  ) : (
                    <ul className="community-notifications">
                      {state.data.contributors.map((member) => (
                        <li key={member.id} className="community-notification">
                          <strong>
                            <Link to={`/community/member/${encodeURIComponent(member.username)}`}>{member.displayName}</Link>
                          </strong>
                          <small>
                            {standingLabel(member.standing)} · {formatCount(member.reputation)} reputation ·{' '}
                            {formatCount(member.acceptedAnswers)} {plural(member.acceptedAnswers, 'solution')}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="community-form__actions" style={{ marginTop: 12 }}>
                    <Link className="community-button community-button--quiet community-button--sm" to="/community/members">
                      All members
                    </Link>
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
