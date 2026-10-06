import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { usePageMeta } from '../../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import { EmptyState, Feedback, Pill, statusTone, useAction } from '../../components/platform/ui';
import { formatDate, titleCase, type InboxConversation, type InboxConversationDetail } from '../../lib/platform-api';

/**
 * Unified Inbox — staff workspace.
 *
 * Staff see every conversation across channels, with labels, assignment, internal notes and the full
 * history. Two things are deliberate:
 *
 *   - an internal note is stored with `visibility = 'internal'` and is filtered out server-side for
 *     every customer read, so it cannot be leaked by a UI mistake;
 *   - a reply's delivery status is whatever the platform actually observed. On a channel with no
 *     outbound transport the message is recorded as `manual` — the UI never claims it was sent.
 */

interface ChannelRow {
  id: string;
  kind: string;
  name: string;
  provider_key: string;
  status: string;
  last_health_check_at: string | null;
  last_error_message: string | null;
}

interface ConnectorRow {
  kind: string;
  label: string;
  providerKey: string;
  description: string;
  requiredConfiguration: string[];
}

interface LabelRow {
  id: string;
  name: string;
  color: string | null;
}

export default function AdminUnifiedInboxPage() {
  usePageMeta('Unified inbox', 'Every conversation across channels, with labels and assignment.', { noIndex: true });
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [emailTransportConfigured, setEmailTransportConfigured] = useState(false);
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [conversations, setConversations] = useState<InboxConversation[] | null>(null);
  const [counts, setCounts] = useState<{ open: number; unassigned: number; unread: number } | null>(null);
  const [filters, setFilters] = useState({ status: 'all', assignee: '', search: '' });
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState<InboxConversationDetail | null>(null);
  const [reply, setReply] = useState({ body: '', visibility: 'public' as 'public' | 'internal' });
  const [staff, setStaff] = useState<Array<{ id: string; label: string }>>([]);
  const [channelDraft, setChannelDraft] = useState({ kind: '', name: '' });
  const [labelDraft, setLabelDraft] = useState({ name: '', color: '#0756d8' });
  const [error, setError] = useState('');
  const action = useAction();

  const loadChannels = useCallback(() => {
    apiFetch<{ channels: ChannelRow[]; connectors: ConnectorRow[]; emailTransportConfigured: boolean }>('/api/v1/inbox/channels')
      .then((response) => {
        setChannels(response.channels);
        setConnectors(response.connectors);
        setEmailTransportConfigured(response.emailTransportConfigured);
        setChannelDraft((current) => ({ ...current, kind: current.kind || response.connectors[0]?.kind || '' }));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const loadConversations = useCallback(() => {
    const query = new URLSearchParams();
    if (filters.status && filters.status !== 'all') query.set('status', filters.status);
    if (filters.assignee) query.set('assignee', filters.assignee);
    if (filters.search) query.set('search', filters.search);
    apiFetch<{ conversations: InboxConversation[]; counts: { open: number; unassigned: number; unread: number } }>(
      `/api/v1/inbox/conversations${query.toString() ? `?${query.toString()}` : ''}`
    )
      .then((response) => {
        setConversations(response.conversations);
        setCounts(response.counts);
      })
      .catch((err: Error) => setError(err.message));
  }, [filters]);

  useEffect(() => loadChannels(), [loadChannels]);
  useEffect(() => loadConversations(), [loadConversations]);
  useEffect(() => {
    apiFetch<{ labels: LabelRow[] }>('/api/v1/inbox/labels')
      .then((response) => setLabels(response.labels))
      .catch(() => setLabels([]));
    apiFetch<{ users: Array<{ id: string; email: string; fullName: string | null }> }>('/api/v1/admin/users?role=staff&limit=50')
      .then((response) => setStaff(response.users.map((user) => ({ id: user.id, label: user.fullName || user.email }))))
      .catch(() => setStaff([]));
  }, []);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    apiFetch<InboxConversationDetail>(`/api/v1/inbox/conversations/${openId}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [openId]);

  const reloadDetail = () => {
    if (openId) {
      apiFetch<InboxConversationDetail>(`/api/v1/inbox/conversations/${openId}`)
        .then(setDetail)
        .catch(() => undefined);
    }
    loadConversations();
  };

  return (
    <div className="ch247-page ch247-page--wide">
      <h1>Unified inbox</h1>
      <p className="ch247-page__hint">
        Website form submissions arrive here automatically. Other channels appear once an operator connects them — a
        channel that is not configured says so, so an empty list is never mistaken for silence.
      </p>
      <Feedback error={action.error} message={action.message} />
      {error ? <CatalogErrorBanner message={error} /> : null}

      <section className="ch247-card">
        <h2>Channels</h2>
        <p className="ch247-page__hint">
          Outbound email transport:{' '}
          {emailTransportConfigured ? 'configured — replies are sent by email.' : 'not configured — replies are stored as manual.'}
        </p>
        <div className="ch247-table-scroll">
          <table className="ch247-table">
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">Kind</th>
                <th scope="col">Provider</th>
                <th scope="col">Status</th>
                <th scope="col">Last checked</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => (
                <tr key={channel.id}>
                  <td>{channel.name}</td>
                  <td>{titleCase(channel.kind)}</td>
                  <td>{channel.provider_key}</td>
                  <td>
                    <Pill tone={statusTone(channel.status)}>{titleCase(channel.status)}</Pill>
                    {channel.last_error_message ? <div className="ch247-page__hint">{channel.last_error_message}</div> : null}
                  </td>
                  <td>{formatDate(channel.last_health_check_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="ch247-button ch247-button--ghost ch247-button--small"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          const response = await apiFetch<{ channel: ChannelRow }>(`/api/v1/inbox/channels/${channel.id}/refresh`, { method: 'POST' });
                          loadChannels();
                          return `${response.channel.name} is ${titleCase(response.channel.status)}.`;
                        })
                      }
                    >
                      Re-check
                    </button>
                  </td>
                </tr>
              ))}
              {channels.length === 0 ? (
                <tr>
                  <td colSpan={6}>No channel rows yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <h3>Connect a channel</h3>
        <div className="ch247-form">
          <label className="ch247-field">
            <span className="ch247-field-label">Channel type</span>
            <select value={channelDraft.kind} onChange={(event) => setChannelDraft({ ...channelDraft, kind: event.target.value })}>
              {connectors.map((connector) => (
                <option key={connector.kind} value={connector.kind}>
                  {connector.label}
                </option>
              ))}
            </select>
          </label>
          {(() => {
            const connector = connectors.find((entry) => entry.kind === channelDraft.kind);
            return connector ? (
              <p className="ch247-note">
                {connector.description}
                {connector.requiredConfiguration.length
                  ? ` Required configuration: ${connector.requiredConfiguration.join(', ')}.`
                  : ' No credential is required.'}
              </p>
            ) : null;
          })()}
          <label className="ch247-field">
            <span className="ch247-field-label">Display name</span>
            <input value={channelDraft.name} maxLength={120} onChange={(event) => setChannelDraft({ ...channelDraft, name: event.target.value })} />
          </label>
          <button
            type="button"
            className="ch247-button"
            disabled={action.busy || !channelDraft.kind || channelDraft.name.trim().length < 1}
            onClick={() =>
              void action.run(async () => {
                const response = await apiFetch<{ channel: ChannelRow }>('/api/v1/inbox/channels', {
                  method: 'POST',
                  body: JSON.stringify({ kind: channelDraft.kind, name: channelDraft.name.trim() }),
                });
                setChannelDraft({ ...channelDraft, name: '' });
                loadChannels();
                return `${response.channel.name} created with status “${titleCase(response.channel.status)}”.`;
              })
            }
          >
            Create channel
          </button>
        </div>
      </section>

      <section className="ch247-card">
        <h2>
          Conversations
          {counts ? (
            <span className="ch247-page__hint">
              {' '}
              · {counts.open} open · {counts.unassigned} unassigned · {counts.unread} unread
            </span>
          ) : null}
        </h2>
        <div className="ch247-inlineform">
          <label className="ch247-field">
            <span className="ch247-field-label">Status</span>
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              {['all', 'open', 'pending', 'snoozed', 'closed'].map((status) => (
                <option key={status} value={status}>
                  {titleCase(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Assignee</span>
            <select value={filters.assignee} onChange={(event) => setFilters({ ...filters, assignee: event.target.value })}>
              <option value="">Anyone</option>
              <option value="unassigned">Unassigned</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Search</span>
            <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          </label>
        </div>

        {conversations === null ? (
          <CatalogLoadingBanner />
        ) : conversations.length === 0 ? (
          <EmptyState>No conversation matches this filter.</EmptyState>
        ) : (
          <div className="ch247-table-scroll">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th scope="col">Subject</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Channel</th>
                  <th scope="col">Status</th>
                  <th scope="col">Labels</th>
                  <th scope="col">Last message</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {conversations.map((conversation) => (
                  <tr key={conversation.id}>
                    <td>
                      {conversation.is_starred ? '★ ' : ''}
                      {conversation.subject || '(no subject)'}
                      {conversation.unread_for_staff > 0 ? <Pill tone="warn">{conversation.unread_for_staff}</Pill> : null}
                    </td>
                    <td>
                      {conversation.contact_name || '—'}
                      <div className="ch247-page__hint">{conversation.contact_email}</div>
                    </td>
                    <td>{conversation.channel_name}</td>
                    <td>
                      <Pill tone={statusTone(conversation.status)}>{titleCase(conversation.status)}</Pill>
                    </td>
                    <td>{conversation.labels?.join(', ') || '—'}</td>
                    <td>{formatDate(conversation.last_message_at)}</td>
                    <td>
                      <button type="button" className="ch247-button ch247-button--ghost ch247-button--small" onClick={() => setOpenId(conversation.id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ch247-card">
        <h2>Labels</h2>
        <p className="ch247-page__hint">Labels are shared across the inbox and used for filtering.</p>
        <ul className="ch247-plainlist">
          {labels.map((label) => (
            <li key={label.id}>
              <span className="ch247-label-chip" style={label.color ? { borderColor: label.color } : undefined}>
                {label.name}
              </span>
            </li>
          ))}
          {labels.length === 0 ? <li>No labels yet.</li> : null}
        </ul>
        <div className="ch247-inlineform">
          <label className="ch247-field">
            <span className="ch247-field-label">New label</span>
            <input value={labelDraft.name} maxLength={60} onChange={(event) => setLabelDraft({ ...labelDraft, name: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Colour</span>
            <input type="color" value={labelDraft.color} onChange={(event) => setLabelDraft({ ...labelDraft, color: event.target.value })} />
          </label>
          <button
            type="button"
            className="ch247-button"
            disabled={action.busy || labelDraft.name.trim().length < 1}
            onClick={() =>
              void action.run(async () => {
                await apiFetch('/api/v1/inbox/labels', {
                  method: 'POST',
                  body: JSON.stringify({ name: labelDraft.name.trim(), color: labelDraft.color }),
                });
                setLabelDraft({ ...labelDraft, name: '' });
                const response = await apiFetch<{ labels: LabelRow[] }>('/api/v1/inbox/labels');
                setLabels(response.labels);
                return 'Label created.';
              })
            }
          >
            Create label
          </button>
        </div>
      </section>

      {openId && detail ? (
        <section className="ch247-card">
          <h2>{detail.conversation.subject || '(no subject)'}</h2>
          <p className="ch247-page__hint">
            {detail.conversation.channel_name} · {detail.conversation.contact_name || '—'}{' '}
            {detail.conversation.contact_email ? `<${detail.conversation.contact_email}>` : ''} ·{' '}
            <Pill tone={statusTone(detail.conversation.status)}>{titleCase(detail.conversation.status)}</Pill>
          </p>

          <div className="ch247-inline-actions">
            <label className="ch247-field">
              <span className="ch247-field-label">Status</span>
              <select
                value={detail.conversation.status}
                onChange={(event) =>
                  void action.run(async () => {
                    await apiFetch(`/api/v1/inbox/conversations/${openId}`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) });
                    reloadDetail();
                    return 'Conversation updated.';
                  })
                }
              >
                {['open', 'pending', 'snoozed', 'closed'].map((status) => (
                  <option key={status} value={status}>
                    {titleCase(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Assignee</span>
              <select
                value={detail.conversation.assignee_id ?? ''}
                onChange={(event) =>
                  void action.run(async () => {
                    await apiFetch(`/api/v1/inbox/conversations/${openId}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ assigneeId: event.target.value || null, note: 'Assignment changed from the admin inbox' }),
                    });
                    reloadDetail();
                    return 'Assignment updated.';
                  })
                }
              >
                <option value="">Unassigned</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Priority</span>
              <select
                value={detail.conversation.priority}
                onChange={(event) =>
                  void action.run(async () => {
                    await apiFetch(`/api/v1/inbox/conversations/${openId}`, { method: 'PATCH', body: JSON.stringify({ priority: event.target.value }) });
                    reloadDetail();
                    return 'Priority updated.';
                  })
                }
              >
                {['low', 'normal', 'high', 'urgent'].map((priority) => (
                  <option key={priority} value={priority}>
                    {titleCase(priority)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ch247-button ch247-button--ghost"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await apiFetch(`/api/v1/inbox/conversations/${openId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ isStarred: !detail.conversation.is_starred }),
                  });
                  reloadDetail();
                  return detail.conversation.is_starred ? 'Star removed.' : 'Starred.';
                })
              }
            >
              {detail.conversation.is_starred ? 'Unstar' : 'Star'}
            </button>
          </div>

          <h3>Labels</h3>
          <div className="ch247-inline-actions">
            {labels.map((label) => {
              const attached = detail.labels.some((entry) => entry.id === label.id);
              return (
                <button
                  key={label.id}
                  type="button"
                  className={`ch247-button ch247-button--small ${attached ? '' : 'ch247-button--ghost'}`}
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await apiFetch(`/api/v1/inbox/conversations/${openId}/labels`, {
                        method: 'POST',
                        body: JSON.stringify({ labelId: label.id, attach: !attached }),
                      });
                      reloadDetail();
                      return attached ? `Removed ${label.name}.` : `Added ${label.name}.`;
                    })
                  }
                >
                  {label.name}
                </button>
              );
            })}
            {labels.length === 0 ? <span className="ch247-page__hint">Create a label first.</span> : null}
          </div>

          <h3>Conversation</h3>
          <div className="ch247-thread-list">
            {detail.messages.map((message) => (
              <div
                key={message.id}
                className={`ch247-message ch247-message--${message.visibility === 'internal' ? 'internal' : message.direction === 'outbound' ? 'staff' : 'customer'}`}
              >
                <div className="ch247-message__meta">
                  {message.author_name || (message.direction === 'outbound' ? 'Team' : 'Contact')} ·{' '}
                  {message.visibility === 'internal' ? 'internal note' : message.direction} · {formatDate(message.created_at)} ·{' '}
                  {titleCase(message.delivery_status)}
                  {message.delivery_error ? ` — ${message.delivery_error}` : ''}
                </div>
                <div className="ch247-pre-wrap">{message.body}</div>
              </div>
            ))}
          </div>

          <h3>Reply</h3>
          <div className="ch247-form">
            <label className="ch247-field">
              <span className="ch247-field-label">Message</span>
              <textarea rows={4} maxLength={20000} value={reply.body} onChange={(event) => setReply({ ...reply, body: event.target.value })} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Visibility</span>
              <select value={reply.visibility} onChange={(event) => setReply({ ...reply, visibility: event.target.value as 'public' | 'internal' })}>
                <option value="public">Reply to the contact</option>
                <option value="internal">Internal note (never shown to the customer)</option>
              </select>
            </label>
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || reply.body.trim().length < 1}
              onClick={() =>
                void action.run(async () => {
                  const response = await apiFetch<{ deliveryStatus: string; deliveryNote?: string }>(`/api/v1/inbox/conversations/${openId}/messages`, {
                    method: 'POST',
                    body: JSON.stringify({ body: reply.body.trim(), visibility: reply.visibility }),
                  });
                  setReply({ ...reply, body: '' });
                  reloadDetail();
                  return response.deliveryStatus === 'sent'
                    ? 'Reply sent.'
                    : `Recorded as ${response.deliveryStatus}${response.deliveryNote ? ` — ${response.deliveryNote}` : ''}.`;
                })
              }
            >
              Save reply
            </button>
          </div>

          <h3>Assignment history</h3>
          <ol className="ch247-timeline">
            {detail.assignments.map((entry) => (
              <li key={entry.id}>
                <span className="ch247-timeline__time">{formatDate(entry.created_at)}</span>
                <span>{entry.note || (entry.to_assignee_id ? 'Assigned' : 'Unassigned')}</span>
              </li>
            ))}
            {detail.assignments.length === 0 ? <li>No assignment changes yet.</li> : null}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
