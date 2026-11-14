import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Markdown } from '../../lib/markdown';
import { communityApi, type CommunityAuthor, type CommunityIdentity, type DiscussionSummary } from '../../lib/community-api';
import { getToken } from '../../lib/auth';

/**
 * Shared Community Forum presentation.
 *
 * Everything here is a real component over real API data: there are no placeholder buttons, no
 * fabricated statistics and no "coming soon" cards. A control is rendered only when the server has
 * said the visitor may use it (the `viewer` block on a discussion, or `/me` for a signed-in
 * member), and when it is used it calls the endpoint that actually performs the action.
 */

const STANDING_LABEL: Record<string, string> = {
  staff: 'CloudHost247 staff',
  moderator: 'Moderator',
  developer: 'Verified developer',
  member: 'Member',
};

export function StandingBadge({ standing }: { standing: string }) {
  if (standing === 'member') return null;
  return (
    <span className={`community-standing community-standing--${standing}`}>
      {standing === 'staff' ? '◆ Staff' : standing === 'moderator' ? 'Moderator' : 'Developer'}
    </span>
  );
}

export function standingLabel(standing: string): string {
  return STANDING_LABEL[standing] ?? 'Member';
}

/** "3 minutes ago" without a date library, and without a wrong answer for a future timestamp. */
export function relativeTime(value: string | null | undefined): string {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((then - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (absolute < 60) return formatter.format(seconds, 'second');
  if (absolute < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (absolute < 86_400) return formatter.format(Math.round(seconds / 3600), 'hour');
  if (absolute < 2_592_000) return formatter.format(Math.round(seconds / 86_400), 'day');
  if (absolute < 31_536_000) return formatter.format(Math.round(seconds / 2_592_000), 'month');
  return formatter.format(Math.round(seconds / 31_536_000), 'year');
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en').format(value);
}

/** "1 reply" / "2 replies" — a count next to a label should never read "1 replies". */
export function plural(value: number, singular: string, pluralForm?: string): string {
  return value === 1 ? singular : pluralForm ?? `${singular}s`;
}

export function AuthorLine({ author, at, prefix }: { author: CommunityAuthor; at?: string | null; prefix?: string }) {
  return (
    <p className="community-author">
      <Link to={`/community/member/${encodeURIComponent(author.username)}`} className="community-author__name">
        {author.displayName}
      </Link>
      <span className="community-author__handle">@{author.username}</span>
      <StandingBadge standing={author.standing} />
      {at && (
        <>
          <span aria-hidden="true">·</span>
          <time dateTime={at}>{relativeTime(at)}</time>
        </>
      )}
      {prefix && <span className="community-author__prefix">{prefix}</span>}
    </p>
  );
}

export function MarkdownBody({ source }: { source: string }) {
  if (!source.trim()) return null;
  // The Markdown renderer returns React elements; raw HTML in a post therefore renders as text.
  return (
    <div className="community-markdown">
      <Markdown source={source} />
    </div>
  );
}

export function DiscussionCard({ discussion, showCategory = true }: { discussion: DiscussionSummary; showCategory?: boolean }) {
  return (
    <article className={`community-card${discussion.isPinned ? ' is-pinned' : ''}`}>
      <div className="community-card__main">
        <div className="community-card__flags">
          {discussion.isPinned && <span className="community-flag community-flag--pinned">Pinned</span>}
          {discussion.isSolved && <span className="community-flag community-flag--solved">✓ Solved</span>}
          {discussion.isLocked && <span className="community-flag">Locked</span>}
          {showCategory && (
            <Link className="community-flag community-flag--category" to={`/community/category/${discussion.category.slug}`}>
              {discussion.category.name}
            </Link>
          )}
        </div>
        <h3 className="community-card__title">
          <Link to={`/community/discussion/${discussion.slug}`}>{discussion.title}</Link>
        </h3>
        <p className="community-card__preview">{discussion.preview}</p>
        <AuthorLine author={discussion.author} at={discussion.createdAt} />
      </div>
      <dl className="community-card__stats">
        <div><dt>Replies</dt><dd>{formatCount(discussion.replyCount)}</dd></div>
        <div><dt>Reactions</dt><dd>{formatCount(discussion.reactionCount)}</dd></div>
        <div><dt>Views</dt><dd>{formatCount(discussion.viewCount)}</dd></div>
      </dl>
    </article>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="community-empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading community content…' }: { label?: string }) {
  return (
    <p className="community-status" role="status">
      <span className="community-spinner" aria-hidden="true" /> {label}
    </p>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="community-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="community-button community-button--quiet" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
  if (pages <= 1) return null;
  return (
    <nav className="community-pagination" aria-label="Pagination">
      <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        ← Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button type="button" onClick={() => onChange(page + 1)} disabled={page >= pages}>
        Next →
      </button>
    </nav>
  );
}

export function CommunityTabs<T extends string>({
  items,
  active,
  onChange,
  label,
}: {
  items: Array<{ id: T; label: string }>;
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="community-tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          className={`community-tab${active === item.id ? ' is-active' : ''}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The signed-in member's community identity, or null for an anonymous visitor.
 *
 * A 401 here is the normal anonymous case (the SPA has no token), so it resolves to null instead of
 * an error banner. Everything else surfaces, because a broken `/me` is not the same as "signed out".
 */
export function useCommunityMe(): { identity: CommunityIdentity | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ identity: CommunityIdentity | null; loading: boolean; error: string | null }>({
    identity: null,
    loading: true,
    error: null,
  });
  useEffect(() => {
    // No token means an anonymous visitor. Asking `/me` anyway would produce a guaranteed 401 on
    // every public thread — noise in the console and in the access log, for an answer we already
    // know.
    if (!getToken()) {
      setState({ identity: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    communityApi
      .me()
      .then((identity) => {
        if (!cancelled) setState({ identity, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const status = (error as { status?: number }).status;
        setState({
          identity: null,
          loading: false,
          error: status === 401 ? null : error instanceof Error ? error.message : 'Could not load your community profile.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function CommunityBreadcrumb({ trail }: { trail: Array<{ label: string; to?: string }> }) {
  return (
    <nav className="community-breadcrumb" aria-label="Breadcrumb">
      <Link to="/community">Community</Link>
      {trail.map((entry) => (
        <span key={entry.label}>
          <span aria-hidden="true">/</span>
          {entry.to ? <Link to={entry.to}>{entry.label}</Link> : <span aria-current="page">{entry.label}</span>}
        </span>
      ))}
    </nav>
  );
}
