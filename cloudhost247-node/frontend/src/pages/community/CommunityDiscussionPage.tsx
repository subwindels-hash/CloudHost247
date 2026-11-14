import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { communityApi, type DiscussionDetail, type ReplyView } from '../../lib/community-api';
import { Markdown } from '../../lib/markdown';
import { useAuthState } from '../../layout/useAuthState';
import {
  AuthorLine,
  CommunityBreadcrumb,
  EmptyState,
  formatCount,
  LoadError,
  Loading,
  MarkdownBody,
  plural,
  relativeTime,
  useCommunityMe,
} from '../../components/community/CommunityUI';

/**
 * `/community/discussion/:slug` — one thread.
 *
 * Server-provided capabilities decide which controls exist: `viewer.canEdit`, `canModerate`,
 * `canAcceptSolution`, `isBookmarked`. The client never guesses; if a control is missing from the
 * payload it is not rendered, and if a member forces the request anyway the API answers 403 (pinned
 * by tests/integration/community-api.test.ts).
 */

interface ComposerState {
  body: string;
  parentId: string | null;
  preview: boolean;
  busy: boolean;
  error: string | null;
  attachment: { fileName: string; mimeType: string; dataBase64: string } | null;
}

const EMPTY_COMPOSER: ComposerState = { body: '', parentId: null, preview: false, busy: false, error: null, attachment: null };

const MAX_ATTACHMENT_BYTES = 1_572_864;

function readAttachment(file: File): Promise<{ fileName: string; mimeType: string; dataBase64: string }> {
  return new Promise((resolve, reject) => {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      reject(new Error('Only PNG, JPEG, WebP and GIF screenshots can be attached.'));
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      reject(new Error('Attachments are limited to 1.5 MB.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      resolve({ fileName: file.name, mimeType: file.type, dataBase64: base64 });
    };
    reader.readAsDataURL(file);
  });
}

function ReplyCard({
  reply,
  viewer,
  acceptedId,
  onAccept,
  onUnaccept,
  onReply,
  onReact,
  onDelete,
  onReport,
}: {
  reply: ReplyView;
  viewer: DiscussionDetail['viewer'];
  acceptedId: string | null;
  onAccept: (replyId: string) => void;
  onUnaccept: () => void;
  onReply: (replyId: string) => void;
  onReact: (replyId: string) => void;
  onDelete: (replyId: string) => void;
  onReport: (replyId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const isAccepted = acceptedId === reply.id || reply.isAccepted;
  return (
    <article className={`community-post${isAccepted ? ' is-solution' : ''}`} id={`reply-${reply.id}`}>
      <div className="community-post__head">
        <AuthorLine author={reply.author} at={reply.createdAt} />
        <div className="community-post__actions">
          {isAccepted && <span className="community-flag community-flag--solved">✓ Accepted solution</span>}
          {reply.editedAt && <span className="community-post__signature">edited {relativeTime(reply.editedAt)}</span>}
          {viewer?.canAcceptSolution && !acceptedId && (
            <button type="button" className="community-button community-button--quiet community-button--sm" onClick={() => onAccept(reply.id)}>
              Accept as solution
            </button>
          )}
          {viewer && acceptedId === reply.id && (viewer.canModerate || viewer.isAuthor) && (
            <button type="button" className="community-button community-button--quiet community-button--sm" onClick={onUnaccept}>
              Unaccept
            </button>
          )}
          {viewer && (
            <button
              type="button"
              className={`community-button community-button--quiet community-button--sm${reply.viewerReacted ? ' is-active' : ''}`}
              aria-pressed={reply.viewerReacted}
              onClick={() => onReact(reply.id)}
            >
              ♥ {formatCount(reply.reactionCount)}
            </button>
          )}
          {viewer && <button type="button" className="community-button community-button--quiet community-button--sm" onClick={() => onReply(reply.id)}>Quote</button>}
          {viewer && <button type="button" className="community-button community-button--quiet community-button--sm" onClick={() => onReport(reply.id)}>Report</button>}
          {viewer?.canModerate && !confirming && (
            <button type="button" className="community-button community-button--danger community-button--sm" onClick={() => setConfirming(true)}>
              Remove
            </button>
          )}
          {viewer?.canModerate && confirming && (
            <span className="community-admin-actions">
              <button type="button" className="community-button community-button--danger community-button--sm" onClick={() => onDelete(reply.id)}>
                Confirm removal
              </button>
              <button type="button" className="community-button community-button--quiet community-button--sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          )}
        </div>
      </div>
      {reply.quotedReply && (
        <p className="community-post__quoted">
          Replying to <strong>@{reply.quotedReply.author.username}</strong>: {reply.quotedReply.preview}
        </p>
      )}
      <MarkdownBody source={reply.body} />
      {reply.attachments.length > 0 && (
        <ul className="community-attachments">
          {reply.attachments.map((attachment) => (
            <li key={attachment.id}>
              <a href={attachment.url} target="_blank" rel="noreferrer">
                <img src={attachment.url} alt={attachment.fileName} width={148} height={108} loading="lazy" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {reply.children.length > 0 && (
        <div className="community-replies">
          {reply.children.map((child) => (
            <ReplyCard
              key={child.id}
              reply={child}
              viewer={viewer}
              acceptedId={acceptedId}
              onAccept={onAccept}
              onUnaccept={onUnaccept}
              onReply={onReply}
              onReact={onReact}
              onDelete={onDelete}
              onReport={onReport}
            />
          ))}
        </div>
      )}
    </article>
  );
}

export default function CommunityDiscussionPage() {
  const { slug = '' } = useParams();
  const { token } = useAuthState();
  const { identity } = useCommunityMe();
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'success'; data?: DiscussionDetail; message?: string }>({ status: 'loading' });
  const [composer, setComposer] = useState<ComposerState>(EMPTY_COMPOSER);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ body: string; busy: boolean } | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await communityApi.discussion(slug);
      setState({ status: 'success', data });
    } catch (loadError) {
      setState({ status: 'error', message: loadError instanceof Error ? loadError.message : 'That discussion could not be loaded.' });
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Count the view once per mount. The endpoint is idempotent-ish (a counter), so a refresh adds
    // one more, which is the same behaviour every forum has.
    if (state.status === 'success' && state.data) {
      communityApi.recordView(state.data.discussion.slug).catch(() => undefined);
    }
  }, [state.status, state.data]);

  const discussion = state.status === 'success' ? state.data!.discussion : null;
  usePageMeta(
    discussion ? discussion.title : 'Community discussion',
    discussion ? discussion.preview : undefined
  );

  const act = async (action: () => Promise<unknown>, message: string) => {
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

  const onReact = (targetType: 'discussion' | 'reply', targetId: string) =>
    act(() => communityApi.react(targetType, targetId), 'Reaction saved.');

  const submitReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!discussion) return;
    setComposer((current) => ({ ...current, busy: true, error: null }));
    try {
      const created = await communityApi.createReply(discussion.id, { body: composer.body, parentId: composer.parentId });
      if (composer.attachment) {
        try {
          await communityApi.uploadAttachment({
            discussionId: discussion.id,
            replyId: created.id,
            fileName: composer.attachment.fileName,
            mimeType: composer.attachment.mimeType,
            dataBase64: composer.attachment.dataBase64,
          });
        } catch (uploadError) {
          setError(uploadError instanceof Error ? `Reply posted, but the screenshot was not attached: ${uploadError.message}` : 'Reply posted, but the screenshot was not attached.');
        }
      }
      setComposer(EMPTY_COMPOSER);
      setNotice('Your reply is published.');
      await load();
    } catch (submitError) {
      setComposer((current) => ({
        ...current,
        busy: false,
        error: submitError instanceof Error ? submitError.message : 'Your reply could not be published.',
      }));
    }
  };

  const attach = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const attachment = await readAttachment(file);
      setComposer((current) => ({ ...current, attachment, error: null }));
    } catch (attachError) {
      setComposer((current) => ({ ...current, attachment: null, error: attachError instanceof Error ? attachError.message : 'That file cannot be attached.' }));
    }
  };

  const report = (targetType: 'discussion' | 'reply', targetId: string) => {
    const reason = window.prompt('Why are you reporting this? Type: spam, abuse, off_topic, inaccurate, security or other.', 'spam');
    if (!reason) return;
    const allowed = ['spam', 'abuse', 'off_topic', 'inaccurate', 'security', 'other'];
    const normalised = reason.trim().toLowerCase().replace(/[^a-z_]/g, '_');
    if (!allowed.includes(normalised)) {
      setError(`Unknown report reason. Use one of: ${allowed.join(', ')}.`);
      return;
    }
    void act(() => communityApi.report({ targetType, targetId, reason: normalised }), 'Thanks — a moderator will review this report.');
  };

  const saveEdit = async () => {
    if (!discussion || !editing) return;
    setEditing({ ...editing, busy: true });
    try {
      await communityApi.updateDiscussion(discussion.id, { body: editing.body });
      setEditing(null);
      setNotice('Your changes are saved.');
      await load();
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : 'That edit could not be saved.');
      setEditing({ ...editing, busy: false });
    }
  };

  const moderatable = useMemo(() => Boolean(state.status === 'success' && state.data?.viewer?.canModerate), [state]);

  if (state.status === 'loading') {
    return (
      <div className="community-page">
        <div className="community-wrap"><Loading label="Loading discussion…" /></div>
      </div>
    );
  }
  if (state.status === 'error' || !state.data) {
    return (
      <div className="community-page">
        <div className="community-wrap">
          <LoadError message={state.message ?? 'That discussion could not be loaded.'} onRetry={() => void load()} />
          <Link className="community-button community-button--quiet" to="/community">Back to the community</Link>
        </div>
      </div>
    );
  }
  const data = state.data;
  const thread = data.discussion;

  return (
    <div className="community-page">
      <div className="community-wrap">
        <CommunityBreadcrumb
          trail={[
            { label: data.category.name, to: `/community/category/${data.category.slug}` },
            { label: thread.title },
          ]}
        />

        {notice && <p className="community-note" role="status">{notice}</p>}
        {error && <LoadError message={error} />}

        <header className="community-thread__head">
          <div className="community-card__flags">
            {thread.isPinned && <span className="community-flag community-flag--pinned">Pinned</span>}
            {thread.isSolved && <span className="community-flag community-flag--solved">✓ Solved</span>}
            {thread.isLocked && <span className="community-flag">Locked</span>}
            {thread.aiPublishedAt && <span className="community-flag community-flag--pinned">Verified for AI answers</span>}
            <Link className="community-flag community-flag--category" to={`/community/category/${data.category.slug}`}>
              {data.category.name}
            </Link>
          </div>
          <h1>{thread.title}</h1>
          <div className="community-thread__meta">
            <AuthorLine author={thread.author} at={thread.createdAt} />
            <span>{formatCount(thread.viewCount)} {plural(thread.viewCount, 'view')}</span>
            <span>{formatCount(thread.replyCount)} {plural(thread.replyCount, 'reply', 'replies')}</span>
            {thread.editedAt && <span>edited {relativeTime(thread.editedAt)}</span>}
          </div>
          {thread.tags.length > 0 && (
            <div className="community-card__flags">
              {thread.tags.map((tag) => <span key={tag} className="community-flag">#{tag}</span>)}
            </div>
          )}
          <div className="community-thread__actions">
            {token && (
              <>
                <button
                  type="button"
                  className={`community-button community-button--quiet community-button--sm${data.viewer?.isBookmarked ? ' is-active' : ''}`}
                  onClick={() => act(() => communityApi.bookmark(thread.id), 'Bookmark updated.')}
                >
                  {data.viewer?.isBookmarked ? '★ Bookmarked' : '☆ Bookmark'}
                </button>
                <button
                  type="button"
                  className="community-button community-button--quiet community-button--sm"
                  onClick={() => act(() => communityApi.subscribe(thread.id), 'Notification preference saved.')}
                >
                  {data.viewer?.isSubscribed ? '🔔 Following' : '🔕 Follow thread'}
                </button>
                <button
                  type="button"
                  className="community-button community-button--quiet community-button--sm"
                  aria-pressed={false}
                  onClick={() => onReact('discussion', thread.id)}
                >
                  ♥ React ({formatCount(thread.reactionCount)})
                </button>
              </>
            )}
            {data.viewer?.canEdit && !editing && (
              <button type="button" className="community-button community-button--quiet community-button--sm" onClick={() => setEditing({ body: thread.body, busy: false })}>
                Edit
              </button>
            )}
            {moderatable && (
              <>
                <button
                  type="button"
                  className="community-button community-button--quiet community-button--sm"
                  onClick={() =>
                    act(
                      () => communityApi.admin.setFlags(thread.id, { pinned: !thread.isPinned }),
                      thread.isPinned ? 'Discussion unpinned.' : 'Discussion pinned.'
                    )
                  }
                >
                  {thread.isPinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                  type="button"
                  className="community-button community-button--quiet community-button--sm"
                  onClick={() =>
                    act(
                      () => communityApi.admin.setFlags(thread.id, { locked: !thread.isLocked }),
                      thread.isLocked ? 'Discussion unlocked.' : 'Discussion locked.'
                    )
                  }
                >
                  {thread.isLocked ? 'Unlock' : 'Lock'}
                </button>
                {thread.isSolved && identity?.isSuperAdmin && (
                  <button
                    type="button"
                    className="community-button community-button--quiet community-button--sm"
                    onClick={() => {
                      if (thread.aiPublishedAt) {
                        void act(() => communityApi.admin.revokeSolution(thread.id, 'Withdrawn by a super administrator'), 'Solution withdrawn from the knowledge base.');
                      } else {
                        void act(() => communityApi.admin.publishSolution(thread.id), 'Solution verified and published to the AI knowledge base.');
                      }
                    }}
                  >
                    {thread.aiPublishedAt ? 'Withdraw AI answer' : 'Verify for AI answers'}
                  </button>
                )}
              </>
            )}
            {token && <button type="button" className="community-button community-button--quiet community-button--sm" onClick={() => report('discussion', thread.id)}>Report</button>}
          </div>
        </header>

        <section className="community-section" aria-label="Discussion body">
          <div className="community-post">
            {editing ? (
              <div className="community-composer">
                <label htmlFor="community-edit-body">Edit your discussion</label>
                <textarea
                  id="community-edit-body"
                  value={editing.body}
                  onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                />
                <div className="community-form__actions">
                  <button type="button" className="community-button" onClick={() => void saveEdit()} disabled={editing.busy}>
                    {editing.busy ? 'Saving…' : 'Save changes'}
                  </button>
                  <button type="button" className="community-button community-button--quiet" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <MarkdownBody source={thread.body} />
            )}
            {data.attachments.length > 0 && (
              <ul className="community-attachments">
                {data.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <a href={attachment.url} target="_blank" rel="noreferrer">
                      <img src={attachment.url} alt={attachment.fileName} width={148} height={108} loading="lazy" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="community-section" aria-labelledby="community-replies-title">
          <div className="community-section__head">
            <h2 id="community-replies-title">{formatCount(data.replies.length)} {plural(data.replies.length, 'reply', 'replies')}</h2>
            {data.acceptedReplyId && <p>This question has an accepted solution.</p>}
          </div>
          {data.replies.length === 0 ? (
            <EmptyState title="No replies yet">
              {thread.isLocked ? 'This discussion is locked.' : 'Be the first to answer. Specific, tested steps are worth more than a guess.'}
            </EmptyState>
          ) : (
            <div className="community-replies">
              {data.replies.map((reply) => (
                <ReplyCard
                  key={reply.id}
                  reply={reply}
                  viewer={data.viewer}
                  acceptedId={data.acceptedReplyId}
                  onAccept={(replyId) => act(() => communityApi.acceptSolution(thread.id, replyId), 'Accepted solution saved.')}
                  onUnaccept={() => act(() => communityApi.removeSolution(thread.id), 'Accepted solution cleared.')}
                  onReply={(replyId) => setComposer((current) => ({ ...current, parentId: current.parentId === replyId ? null : replyId }))}
                  onReact={(replyId) => onReact('reply', replyId)}
                  onDelete={(replyId) => act(() => communityApi.admin.removeReply(replyId, 'Removed by a moderator'), 'Reply removed.')}
                  onReport={(replyId) => report('reply', replyId)}
                />
              ))}
            </div>
          )}
        </section>

        {token ? (
          <form className="community-composer" onSubmit={submitReply}>
            <h2>{composer.parentId ? 'Write your reply' : 'Add a reply'}</h2>
            {composer.parentId && (
              <p className="community-post__quoted">
                Quoting a reply. <button type="button" className="community-button community-button--quiet community-button--sm" onClick={() => setComposer((current) => ({ ...current, parentId: null }))}>Clear quote</button>
              </p>
            )}
            {thread.isLocked ? (
              <p className="community-note">This discussion is locked. New replies are closed, but everything stays readable.</p>
            ) : (
              <>
                <label htmlFor="community-reply-body">Your reply (Markdown)</label>
                <textarea
                  id="community-reply-body"
                  value={composer.body}
                  maxLength={20_000}
                  onChange={(event) => setComposer((current) => ({ ...current, body: event.target.value }))}
                  placeholder={'Describe what worked.\n\n```\n# code blocks are rendered as code\n```'}
                  required
                />
                <p className="community-composer__hint">
                  Markdown is supported: **bold**, `code`, fenced code blocks, lists, tables and &gt; quotes. HTML is shown
                  as text, never executed. Mention another member with @username.
                </p>
                {composer.preview && (
                  <div className="community-composer__preview" aria-live="polite">
                    <Markdown source={composer.body || '_Nothing to preview yet._'} />
                  </div>
                )}
                {composer.attachment && (
                  <p className="community-composer__hint">
                    Attached: {composer.attachment.fileName}{' '}
                    <button type="button" className="community-button community-button--quiet community-button--sm" onClick={() => setComposer((current) => ({ ...current, attachment: null }))}>
                      Remove
                    </button>
                  </p>
                )}
                {composer.error && <p className="community-error" role="alert">{composer.error}</p>}
                <div className="community-composer__footer">
                  <span className="community-composer__tabs">
                    <button type="button" className="community-button community-button--quiet community-button--sm" onClick={() => setComposer((current) => ({ ...current, preview: !current.preview }))}>
                      {composer.preview ? 'Hide preview' : 'Preview'}
                    </button>
                    <label className="community-button community-button--quiet community-button--sm" style={{ cursor: 'pointer' }}>
                      Attach screenshot
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(event) => void attach(event)} />
                    </label>
                  </span>
                  <button type="submit" className="community-button" disabled={composer.busy || composer.body.trim().length < 2}>
                    {composer.busy ? 'Publishing…' : 'Post reply'}
                  </button>
                </div>
              </>
            )}
          </form>
        ) : (
          <div className="community-composer">
            <h2>Join the discussion</h2>
            <p className="community-composer__hint">
              Sign in with your CloudHost247 account to reply — the same account you use for billing, servers and the
              client area. There is no separate forum registration.
            </p>
            <div className="community-form__actions">
              <Link className="community-button" to="/login">Sign in</Link>
              <Link className="community-button community-button--quiet" to="/register">Create an account</Link>
            </div>
          </div>
        )}

        {data.related.length > 0 && (
          <section className="community-section" aria-labelledby="community-related-title">
            <div className="community-section__head"><h2 id="community-related-title">Related in {data.category.name}</h2></div>
            <ul className="community-notifications">
              {data.related.map((entry) => (
                <li key={entry.id} className="community-notification">
                  <strong><Link to={`/community/discussion/${entry.slug}`}>{entry.title}</Link></strong>
                  <small>{formatCount(entry.replyCount)} replies</small>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
