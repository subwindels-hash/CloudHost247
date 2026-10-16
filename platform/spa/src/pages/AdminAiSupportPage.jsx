import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate, humanizeStatus, statusClass } from '../lib/format.js';

const CONVERSATION_STATUSES = ['AI_ACTIVE', 'WAITING_FOR_HUMAN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'];

/**
 * Admin AI support console. The assistant's answers come from a reviewed, code-owned catalogue
 * (read-only here — the panel says so and shows the API's own note); this screen is where staff
 * take over conversations: reply, assign, set priority, resolve/close or hand back to the
 * assistant, and set their own presence/capacity. Every conversation shows why the assistant
 * answered as it did (intent, confidence, knowledge sources) so the inheriting agent sees the
 * reasoning, not just the text.
 */
export default function AdminAiSupportPage() {
  const [overview, setOverview] = useState(null);
  const [conversations, setConversations] = useState(null);
  const [agents, setAgents] = useState([]);
  const [knowledge, setKnowledge] = useState(null);
  const [subscriptions, setSubscriptions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [reply, setReply] = useState('');
  const [presence, setPresence] = useState({ status: 'ONLINE', capacity: '3' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const params = {};
      if (status) params.status = status;
      if (search) params.search = search;
      const [ovRes, convRes, agentRes, knowRes, newsRes] = await Promise.all([
        adminApi.aiOverview(), adminApi.aiConversations(params), adminApi.aiAgents(),
        adminApi.aiKnowledge(), adminApi.newsletterSubscriptions(),
      ]);
      setOverview(ovRes);
      setConversations(convRes.conversations ?? []);
      setAgents(agentRes.agents ?? []);
      setKnowledge(knowRes);
      setSubscriptions(newsRes.subscriptions ?? []);
    } catch (e) {
      setConversations([]);
      setError(describeError(e));
    }
  }, [status, search]);

  useEffect(() => { load(); }, [load]);

  const open = async (conversation) => {
    setError(''); setNotice('');
    try {
      const res = await adminApi.aiConversation(conversation.id);
      setSelected(res);
      setReply('');
    } catch (e) {
      setError(describeError(e));
    }
  };

  const run = async (fn, message) => {
    setError(''); setNotice('');
    try {
      await fn();
      setNotice(message);
      if (selected) {
        const res = await adminApi.aiConversation(selected.conversation.id);
        setSelected(res);
      }
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>AI support</h1>
          <p className="muted">Assistant conversations, human hand-off and the reviewed answer catalogue.</p>
        </div>
        <div className="actions">
          <label>
            <span className="sr-only">Presence</span>
            <select value={presence.status}
              onChange={(e) => {
                const next = { ...presence, status: e.target.value };
                setPresence(next);
                run(() => adminApi.setAgentPresence({ status: next.status, capacity: Number(next.capacity) }), 'Presence updated.');
              }}>
              <option value="ONLINE">Online</option>
              <option value="BUSY">Busy</option>
              <option value="OFFLINE">Offline</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Capacity</span>
            <input type="number" min="1" max="20" value={presence.capacity} style={{ width: 64 }}
              onChange={(e) => setPresence({ ...presence, capacity: e.target.value })}
              onBlur={() => run(() => adminApi.setAgentPresence({ status: presence.status, capacity: Number(presence.capacity) }), 'Presence updated.')} />
          </label>
        </div>
      </div>

      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {overview && (
        <section className="card">
          <h2>Overview</h2>
          <div className="stat-row">
            <div className="stat"><span className="stat-value">{overview.aiHandledConversations ?? 0}</span><span className="stat-label">AI handled</span></div>
            <div className="stat"><span className="stat-value">{overview.humanHandledConversations ?? 0}</span><span className="stat-label">Human handled</span></div>
            <div className="stat"><span className="stat-value">{overview.humanEscalations ?? 0}</span><span className="stat-label">Escalations</span></div>
            <div className="stat"><span className="stat-value">{overview.newsletterSubscriptions ?? 0}</span><span className="stat-label">Newsletter actives</span></div>
          </div>
          {Object.keys(overview.byReason ?? {}).length > 0 && (
            <div className="muted small">
              Escalation reasons:{' '}
              {Object.entries(overview.byReason).map(([reason, count]) => `${reason} (${count})`).join(' · ')}
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2>Conversations</h2>
        <div className="form-row">
          <label>
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {CONVERSATION_STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
            </select>
          </label>
          <label>
            <span>Search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Visitor name, email or id…" />
          </label>
        </div>
        {conversations === null ? (
          <p className="muted">Loading conversations…</p>
        ) : conversations.length === 0 ? (
          <p className="muted">No conversations match this filter.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Visitor</th>
                  <th scope="col">Status</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Assigned</th>
                  <th scope="col">Escalation</th>
                  <th scope="col">Last message</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.visitorName ?? c.customerAccountName ?? 'Anonymous'}</strong>
                      <div className="muted small">{c.visitorEmail ?? c.customerAccountEmail ?? '—'}</div>
                    </td>
                    <td><span className={statusClass(c.status)}>{humanizeStatus(c.status)}</span></td>
                    <td>{c.priority ?? 'normal'}</td>
                    <td>{c.assignedAgentName ?? '—'}</td>
                    <td className="muted">{c.escalationReason ?? '—'}</td>
                    <td>{formatDate(c.lastMessageAt ?? c.updatedAt, { withTime: true })}</td>
                    <td><button className="btn btn-ghost" type="button" onClick={() => open(c)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <section className="card">
          <h2>
            {selected.conversation.visitorName ?? selected.conversation.customerAccountName ?? 'Conversation'}
          </h2>
          <div className="form-row">
            <label>
              <span>Status</span>
              <select value={selected.conversation.status}
                onChange={(e) => run(() => adminApi.updateAiConversation(selected.conversation.id, { status: e.target.value }), 'Conversation updated.')}>
                {CONVERSATION_STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select value={selected.conversation.priority ?? 'normal'}
                onChange={(e) => run(() => adminApi.updateAiConversation(selected.conversation.id, { priority: e.target.value }), 'Conversation updated.')}>
                <option value="low">low</option>
                <option value="normal">normal</option>
                <option value="high">high</option>
              </select>
            </label>
            <label>
              <span>Assign to</span>
              <select value={selected.conversation.assigned_agent_id ?? ''}
                onChange={(e) => run(() => adminApi.updateAiConversation(selected.conversation.id, { assignedAgentId: e.target.value || null }), 'Conversation assigned.')}>
                <option value="">Unassigned</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.fullName ?? a.email}</option>)}
              </select>
            </label>
          </div>

          <ul className="list">
            {(selected.messages ?? []).map((m) => (
              <li key={m.id} className="row row-wrap">
                <span className={statusClass(m.senderType)}>{m.senderType}</span>
                <span>{m.message}</span>
                <span className="muted small">{formatDate(m.createdAt, { withTime: true })}</span>
                {m.intent && (
                  <div className="muted small">
                    intent: {m.intent}{m.confidence !== null ? ` · confidence ${m.confidence}` : ''}
                    {(m.sources ?? []).length > 0 ? ` · sources: ${m.sources.join(', ')}` : ''}
                  </div>
                )}
              </li>
            ))}
          </ul>

          <form className="nested-form" onSubmit={(e) => {
            e.preventDefault();
            if (!reply.trim()) return;
            return run(async () => {
              await adminApi.aiReply(selected.conversation.id, reply.trim());
              setReply('');
            }, 'Reply sent.');
          }}>
            <label>
              <span>Reply as agent</span>
              <textarea rows="3" value={reply} onChange={(e) => setReply(e.target.value)} />
            </label>
            <div className="actions">
              <button className="btn btn-primary" disabled={!reply.trim()}>Send reply</button>
              <button className="btn btn-ghost" type="button"
                onClick={() => run(() => adminApi.updateAiConversation(selected.conversation.id, { status: 'RESOLVED' }), 'Conversation resolved.')}>Resolve</button>
              <button className="btn btn-ghost" type="button"
                onClick={() => run(() => adminApi.updateAiConversation(selected.conversation.id, { status: 'AI_ACTIVE' }), 'Handed back to the assistant.')}>Return to assistant</button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <h2>Answer catalogue</h2>
        {knowledge === null ? (
          <p className="muted">Loading catalogue…</p>
        ) : (
          <>
            <p className="muted">{knowledge.note}</p>
            {knowledge.editable === false && (
              <p className="muted small">Read-only in this console: entries are editable only through code review.</p>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Intent</th>
                    <th scope="col">Title</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {(knowledge.knowledge ?? []).map((entry) => (
                    <tr key={entry.id}>
                      <td className="mono">{entry.intent}</td>
                      <td><strong>{entry.title}</strong><div className="muted small">{entry.summary}</div></td>
                      <td className="muted">{entry.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Newsletter subscriptions</h2>
        {subscriptions === null ? (
          <p className="muted">Loading subscriptions…</p>
        ) : subscriptions.length === 0 ? (
          <p className="muted">No newsletter subscriptions.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Source</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name ?? '—'}</td>
                    <td>{s.email}</td>
                    <td className="muted">{s.source ?? '—'}</td>
                    <td><span className={statusClass(s.status)}>{humanizeStatus(s.status)}</span></td>
                    <td>{formatDate(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
