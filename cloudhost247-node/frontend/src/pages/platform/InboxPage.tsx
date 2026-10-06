import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { getToken } from '../../lib/auth';
import { usePageMeta } from '../../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import { EmptyState, Pill, statusTone } from '../../components/platform/ui';
import { formatDate, titleCase, type InboxConversation, type InboxConversationDetail } from '../../lib/platform-api';

/**
 * Unified Inbox — the customer's side of the shared conversation history.
 *
 * A message that arrives through one of the customer's channels (a Website Builder form, a support
 * ticket, or a connected mailbox/chat account once an operator connects one) lands in one thread
 * list here. Internal staff notes exist in the same conversations but are filtered out by the server
 * for every customer read, so this page cannot display one even by accident.
 *
 * Replying adds a message to the platform's newest channel-agnostic surface, so it is offered from
 * Support (where a ticket is created and answered) rather than being faked here.
 */
export default function InboxPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const token = getToken();
  usePageMeta('Unified Inbox', 'Every conversation with CloudHost247 in one place.', { canonical: '/marketing/inbox', noIndex: true });
  const [conversations, setConversations] = useState<InboxConversation[] | null>(null);
  const [detail, setDetail] = useState<InboxConversationDetail | null>(null);
  const [error, setError] = useState('');

  const loadList = useCallback(() => {
    if (!token) return;
    apiFetch<{ conversations: InboxConversation[] }>('/api/v1/inbox/my-conversations')
      .then((response) => setConversations(response.conversations))
      .catch((err: Error) => setError(err.message));
  }, [token]);

  useEffect(() => loadList(), [loadList]);

  useEffect(() => {
    if (!token || !conversationId) {
      setDetail(null);
      return;
    }
    apiFetch<InboxConversationDetail>(`/api/v1/inbox/my-conversations/${conversationId}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [conversationId, token]);

  if (!token) {
    return (
      <div className="ch247-page">
        <h1>Unified Inbox</h1>
        <div className="ch247-state-banner">
          <p>Your conversations are private to your account.</p>
          <Link className="ch247-button" to="/login?next=/marketing/inbox">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="ch247-page ch247-page--wide">
      <h1>Unified Inbox</h1>
      <p className="ch247-page__hint">
        Website form submissions, ticket replies and connected channels appear here as one conversation each, with the
        channel that carried them. Unread counts are per account and clear when you open a thread.
      </p>
      {error ? <CatalogErrorBanner message={error} /> : null}

      {conversations === null ? (
        <CatalogLoadingBanner />
      ) : conversations.length === 0 ? (
        <EmptyState>
          No conversations yet. When a visitor writes through a form on one of your websites — or when a channel an
          administrator has connected receives a message — it appears here.
        </EmptyState>
      ) : (
        <div className="ch247-inbox-grid">
          <ul className="ch247-thread-list">
            {conversations.map((conversation) => (
              <li key={conversation.id} className={conversation.id === conversationId ? 'is-active' : ''}>
                <Link to={`/marketing/inbox/${conversation.id}`}>
                  <span className="ch247-thread-list__subject">
                    {conversation.subject || '(no subject)'}
                    {(conversation.unread_for_customer ?? 0) > 0 ? <Pill tone="warn">{conversation.unread_for_customer} new</Pill> : null}
                  </span>
                  <span className="ch247-page__hint">
                    {conversation.channel_name} · {titleCase(conversation.status)} · {formatDate(conversation.last_message_at)}
                  </span>
                  <span className="ch247-thread-list__preview">{conversation.last_message_preview}</span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="ch247-card">
            {!conversationId ? (
              <p>Choose a conversation to read it.</p>
            ) : !detail ? (
              <CatalogLoadingBanner label="Loading the conversation…" />
            ) : (
              <>
                <h2>{detail.conversation.subject || '(no subject)'}</h2>
                <p className="ch247-page__hint">
                  {detail.conversation.channel_name} · <Pill tone={statusTone(detail.conversation.status)}>{titleCase(detail.conversation.status)}</Pill>
                  {detail.labels.length ? ` · ${detail.labels.map((label) => label.name).join(', ')}` : ''}
                </p>
                <div className="ch247-thread-list">
                  {detail.messages.map((message) => (
                    <div key={message.id} className={`ch247-message ch247-message--${message.direction === 'outbound' ? 'staff' : 'customer'}`}>
                      <div className="ch247-message__meta">
                        {message.author_name || (message.direction === 'outbound' ? 'CloudHost247 team' : 'You')} · {formatDate(message.created_at)}
                      </div>
                      <div className="ch247-pre-wrap">{message.body}</div>
                    </div>
                  ))}
                </div>
                <p className="ch247-note">
                  This view is the shared record. To add something new,{' '}
                  <Link to="/support">open a support ticket</Link> — it is linked to this conversation rather than copied.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
