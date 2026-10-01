import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuthState } from '../layout/useAuthState';
import { usePageMeta } from '../lib/usePageMeta';

type Conversation = {
  id: string;
  status: string;
  visitor_name: string | null;
  visitor_email: string | null;
  customer_account_name: string | null;
  customer_account_email: string | null;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  assigned_agent_email: string | null;
  escalation_reason: string | null;
  escalation_note: string | null;
  support_ticket_id: string | null;
  source: string;
  priority: string;
  created_at: string;
  updated_at: string;
};

type Message = { id: string; author_type: string; body: string; created_at: string; confidence?: number | null; knowledge_sources?: string[] };
type Agent = { id: string; full_name: string; email: string; role: string; presence_status: string; capacity: number };
type Overview = { counts: Record<string, number>; newsletterSubscriptions: number; aiHandledConversations: number; humanHandledConversations: number; humanEscalations: number; byReason: Record<string, number> };
type KnowledgeEntry = { id: string; title: string; source: string };
type Subscription = { id: string; name: string; email: string; status: string; source: string; created_at: string };

const statuses = ['AI_ACTIVE', 'WAITING_FOR_HUMAN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'];

export default function AdminAiSupportPage() {
  usePageMeta('AI Support', 'Manage AI conversations and human handoffs.');
  const { user } = useAuthState();
  const [items, setItems] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState('');
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [presence, setPresence] = useState('OFFLINE');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setError('');
      const suffix = new URLSearchParams({ ...(filter ? { status: filter } : {}), ...(search ? { search } : {}) }).toString();
      const [list, stats, agentList, knowledgeList] = await Promise.all([
        apiFetch<{ conversations: Conversation[] }>(`/api/v1/admin/ai-support/conversations${suffix ? `?${suffix}` : ''}`),
        apiFetch<Overview>('/api/v1/admin/ai-support/overview'),
        apiFetch<{ agents: Agent[] }>('/api/v1/admin/ai-support/agents'),
        apiFetch<{ knowledge: KnowledgeEntry[] }>('/api/v1/admin/ai-support/knowledge'),
      ]);
      setItems(list.conversations);
      setOverview(stats);
      setAgents(agentList.agents);
      setKnowledge(knowledgeList.knowledge);
      const current = agentList.agents.find((agent) => agent.id === user?.id);
      if (current) setPresence(current.presence_status);
      if (user?.role === 'admin' || user?.role === 'super_admin') {
        const newsletter = await apiFetch<{ subscriptions: Subscription[] }>('/api/v1/admin/newsletter-subscriptions');
        setSubscriptions(newsletter.subscriptions);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Load failed');
    }
  }

  useEffect(() => {
    void load();
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(conversation: Conversation) {
    setSelected(conversation);
    try {
      const data = await apiFetch<{ conversation: Conversation; messages: Message[] }>(`/api/v1/admin/ai-support/conversations/${conversation.id}`);
      setSelected(data.conversation);
      setMessages(data.messages);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load conversation');
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!selected || !reply.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/admin/ai-support/conversations/${selected.id}/reply`, { method: 'POST', body: JSON.stringify({ message: reply.trim() }) });
      setReply('');
      await open(selected);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reply failed');
    } finally {
      setBusy(false);
    }
  }

  async function update(patch: { status?: string; assignedAgentId?: string | null; priority?: string }) {
    if (!selected) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/admin/ai-support/conversations/${selected.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await load();
      const refreshed = items.find((item) => item.id === selected.id);
      if (refreshed) await open(refreshed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Conversation update failed');
    } finally {
      setBusy(false);
    }
  }

  async function updatePresence(next: string) {
    setPresence(next);
    try {
      await apiFetch('/api/v1/admin/ai-support/presence', { method: 'PUT', body: JSON.stringify({ status: next, capacity: 3 }) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Presence update failed');
    }
  }

  return (
    <div className="ch247-stack ch247-ai-admin">
      <section className="ch247-card">
        <div className="ch247-admin-heading">
          <div>
            <h1>AI Support Overview</h1>
            <p className="ch247-page__hint">Native deterministic assistance, verified knowledge, and human support handoffs.</p>
          </div>
          <label className="ch247-field-label">My support presence
            <select value={presence} onChange={(event) => void updatePresence(event.target.value)}>
              <option>ONLINE</option><option>BUSY</option><option>OFFLINE</option>
            </select>
          </label>
        </div>
        {overview && (
          <div className="ch247-metric-grid">
            <article><small>Active AI</small><strong>{overview.counts.AI_ACTIVE ?? 0}</strong></article>
            <article><small>Waiting for human</small><strong>{overview.counts.WAITING_FOR_HUMAN ?? 0}</strong></article>
            <article><small>Human escalations</small><strong>{overview.humanEscalations}</strong></article>
            <article><small>AI handled</small><strong>{overview.aiHandledConversations}</strong></article>
            <article><small>Human handled</small><strong>{overview.humanHandledConversations}</strong></article>
            <article><small>Newsletter subscribers</small><strong>{overview.newsletterSubscriptions}</strong></article>
          </div>
        )}
        {error && <p className="ch247-status-error" role="alert">{error}</p>}
      </section>

      <section className="ch247-card">
        <div className="ch247-admin-filters">
          <label className="ch247-field-label">Status
            <select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">All</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select>
          </label>
          <label className="ch247-field-label">Search
            <input value={search} placeholder="Customer, email, or conversation ID" onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(); }} />
          </label>
          <button type="button" onClick={() => void load()}>Search</button>
        </div>
        <div className="ch247-table-wrap">
          <table className="ch247-table"><thead><tr><th>Customer</th><th>Email</th><th>Status</th><th>Reason</th><th>Priority</th><th>Assigned</th><th>Updated</th></tr></thead>
            <tbody>{items.map((conversation) => <tr key={conversation.id} tabIndex={0} onClick={() => void open(conversation)} onKeyDown={(event) => { if (event.key === 'Enter') void open(conversation); }}>
              <td>{conversation.customer_account_name ?? conversation.visitor_name ?? 'Visitor'}</td>
              <td>{conversation.customer_account_email ?? conversation.visitor_email ?? 'Not provided'}</td>
              <td><span className="ch247-badge">{conversation.status}</span></td>
              <td>{conversation.escalation_reason ?? '—'}</td>
              <td>{conversation.priority}</td>
              <td>{conversation.assigned_agent_name ?? conversation.assigned_agent_email ?? 'Queue'}</td>
              <td>{new Date(conversation.updated_at).toLocaleString()}</td>
            </tr>)}</tbody>
          </table>
          {items.length === 0 && <p className="ch247-page__hint">No AI support conversations match this filter.</p>}
        </div>
      </section>

      {selected && (
        <section className="ch247-card">
          <div className="ch247-admin-heading"><div><h2>Conversation</h2><p className="ch247-page__hint">{selected.id} · {selected.source} · created {new Date(selected.created_at).toLocaleString()}</p></div><span className="ch247-badge">{selected.status}</span></div>
          <div className="ch247-support-meta"><strong>{selected.customer_account_name ?? selected.visitor_name ?? 'Visitor'}</strong><span>{selected.customer_account_email ?? selected.visitor_email ?? 'Email not provided'}</span><span>Reason: {selected.escalation_reason ?? 'AI conversation'}</span><span>Ticket: {selected.support_ticket_id ?? 'Conversation queue'}</span></div>
          <div className="ch247-ticket-thread">{messages.map((message) => <article key={message.id} className="ch247-ticket-message"><strong>{message.author_type === 'AGENT' ? 'CloudHost247 Support' : message.author_type === 'AI' ? 'AI Assistant' : message.author_type}</strong><p>{message.body}</p><small>{new Date(message.created_at).toLocaleString()}</small>{message.knowledge_sources && message.knowledge_sources.length > 0 && <small>Verified sources: {message.knowledge_sources.join(', ')}</small>}</article>)}</div>
          {!['RESOLVED', 'CLOSED'].includes(selected.status) && <form onSubmit={send} className="ch247-form ch247-form--wide"><label className="ch247-field-label">Reply to customer<textarea required rows={4} value={reply} onChange={(event) => setReply(event.target.value)} /></label><button disabled={busy}>Reply as support</button></form>}
          <div className="ch247-actions"><label className="ch247-field-label">Assign
            <select value={selected.assigned_agent_id ?? ''} onChange={(event) => void update({ assignedAgentId: event.target.value || null, status: event.target.value ? 'ASSIGNED' : 'WAITING_FOR_HUMAN' })}><option value="">Support queue</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name} · {agent.presence_status}</option>)}</select>
          </label><label className="ch247-field-label">Priority<select value={selected.priority} onChange={(event) => void update({ priority: event.target.value })}><option>low</option><option>normal</option><option>high</option></select></label><button disabled={busy} onClick={() => void update({ status: 'RESOLVED' })}>Resolve</button><button disabled={busy} onClick={() => void update({ status: 'AI_ACTIVE', assignedAgentId: null })}>Return to AI</button><button disabled={busy} onClick={() => void update({ status: 'CLOSED' })}>Close</button><button disabled={busy} onClick={() => void update({ status: 'WAITING_FOR_HUMAN' })}>Reopen queue</button></div>
        </section>
      )}

      <section className="ch247-card"><h2>Internal AI knowledge</h2><p className="ch247-page__hint">Answers are drawn only from this reviewed CloudHost247 knowledge set. Unknown or account-specific requests escalate.</p><div className="ch247-knowledge-list">{knowledge.map((entry) => <span key={entry.id} className="ch247-badge" title={entry.source}>{entry.title}</span>)}</div></section>

      {(user?.role === 'admin' || user?.role === 'super_admin') && <section className="ch247-card"><h2>Newsletter subscriptions</h2><p className="ch247-page__hint">Newsletter records are separate from customer support requests. Showing up to the latest 500.</p><div className="ch247-table-wrap"><table className="ch247-table"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Source</th><th>Created</th></tr></thead><tbody>{subscriptions.map((subscription) => <tr key={subscription.id}><td>{subscription.name}</td><td>{subscription.email}</td><td>{subscription.status}</td><td>{subscription.source}</td><td>{new Date(subscription.created_at).toLocaleString()}</td></tr>)}</tbody></table></div></section>}
    </div>
  );
}
