import { FormEvent, Fragment, useEffect, useMemo, useState } from 'react';
import { usePageMeta } from '../../lib/usePageMeta';
import { useAuthState } from '../../layout/useAuthState';
import {
  aiOsApi,
  AiAgent,
  AiApproval,
  AiAuditEntry,
  AiEventRow,
  AiFinding,
  AiIncident,
  AiKnowledgeSource,
  AiModelConfig,
  AiTask,
  AiWorkflow,
  BoardOverview,
  ExecutiveReport,
  OverviewResponse,
} from '../../lib/ai-os-api';

/* ------------------------------------------------------------------------------------------------
 * Admin AI Command Center — single-page, tabbed console over the AI Control Plane API.
 * Every action hits the real API; nothing is simulated client-side. Briefing clicks are idempotent.
 * ------------------------------------------------------------------------------------------------ */

type TabId = 'overview' | 'copilot' | 'agents' | 'tasks' | 'approvals' | 'board' | 'findings' | 'ops' | 'knowledge' | 'models' | 'audit';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'copilot', label: 'Admin Copilot' },
  { id: 'agents', label: 'Agents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'approvals', label: 'Decision Inbox' },
  { id: 'board', label: 'Executive Board' },
  { id: 'findings', label: 'Findings & Incidents' },
  { id: 'ops', label: 'Events & Workflows' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'models', label: 'Models' },
  { id: 'audit', label: 'Audit Trail' },
];

const statusPill = (status: string) =>
  ({
    queued: 'bg-slate-100 text-slate-700',
    running: 'bg-blue-100 text-blue-700',
    awaiting_approval: 'bg-amber-100 text-amber-800',
    succeeded: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
    cancelled: 'bg-slate-200 text-slate-500',
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-red-100 text-red-700',
    expired: 'bg-slate-200 text-slate-500',
    executed: 'bg-emerald-100 text-emerald-700',
    open: 'bg-red-100 text-red-700',
    acknowledged: 'bg-amber-100 text-amber-800',
    closed: 'bg-slate-200 text-slate-600',
    investigating: 'bg-amber-100 text-amber-800',
    mitigated: 'bg-blue-100 text-blue-700',
    resolved: 'bg-emerald-100 text-emerald-700',
    new: 'bg-slate-100 text-slate-700',
  }[status] ?? 'bg-slate-100 text-slate-700');

const severityPill = (severity: string) =>
  ({
    info: 'bg-slate-100 text-slate-600',
    low: 'bg-blue-100 text-blue-700',
    medium: 'bg-amber-100 text-amber-800',
    high: 'bg-orange-100 text-orange-800',
    critical: 'bg-red-100 text-red-800 font-semibold',
  }[severity] ?? 'bg-slate-100 text-slate-600');

function Pill({ text, tone }: { text: string; tone: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${tone}`}>{text}</span>;
}

function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {title ? <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2> : null}
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">{text}</p>;
}

function ErrorBox({ text }: { text: string }) {
  if (!text) return null;
  return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{text}</p>;
}

export default function AdminAiCommandPage() {
  usePageMeta('AI Command Center', 'Registry-gated AI workforce: agents, tasks, approvals, findings and briefings over real platform data.');
  const { user: authUser } = useAuthState();
  const [tab, setTab] = useState<TabId>('overview');

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">AI Command Center</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Registry-gated AI workforce. Agents only read platform data through declared tools; every external-impact action is sealed
          behind a human decision. The deterministic engine is the default — no external model is enabled until configured here.
        </p>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === t.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'copilot' && <CopilotTab />}
      {tab === 'agents' && <AgentsTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'approvals' && <ApprovalsTab authRole={authUser?.role} />}
      {tab === 'board' && <BoardTab />}
      {tab === 'findings' && <FindingsTab />}
      {tab === 'ops' && <OpsTab />}
      {tab === 'knowledge' && <KnowledgeTab />}
      {tab === 'models' && <ModelsTab authRole={authUser?.role} />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

/* ------------------------------------------------------------------------------------ Overview */

function OverviewTab() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [board, setBoard] = useState<BoardOverview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [overview, boardData] = await Promise.all([aiOsApi.overview(), aiOsApi.getBoard()]);
        setData(overview);
        setBoard(boardData);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Load failed');
      }
    })();
  }, []);

  if (error) return <ErrorBox text={error} />;
  if (!data) return <p className="text-sm text-slate-500">Loading command center…</p>;

  const { summary } = data;
  const { totals } = summary;
  const statItems: Array<[string, string | number, string]> = [
    ['Registered agents', `${totals.enabledAgents}/${totals.agents}`, 'enabled / total'],
    ['Pending approvals', data.pendingApprovals, 'awaiting human decision'],
    ['Findings (open)', totals.findingsOpen, 'evidence-linked'],
    ['Incidents (open)', totals.incidentsOpen, 'timeline-fed'],
    ['Runs (all time)', totals.runs, `${totals.failedRuns} failed`],
    ['Events awaiting dispatch', totals.eventsUnprocessed, 'sweep drains these'],
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {statItems.map(([label, value, hint]) => (
          <Card key={label} className="!p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-xs text-slate-500">{hint}</p>
          </Card>
        ))}
      </div>

      <Card title="Tool calls (all audited)">
        <p className="text-2xl font-bold text-slate-900">{totals.toolCalls}</p>
        <p className="text-xs text-slate-500">Every call is admission-gated (registry + permissions + workspace) before it can read anything.</p>
      </Card>

      {summary.recentErrors.length > 0 ? (
        <Card title="Recent errors">
          <ul className="divide-y divide-slate-100 text-sm">
            {summary.recentErrors.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-2 py-2 text-xs">
                <span className="text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
                <span className="font-medium text-slate-700">{e.agent}</span>
                <span className="font-mono text-slate-500">{e.action}</span>
                {e.errorCode ? <Pill text={e.errorCode} tone="bg-red-100 text-red-700" /> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {board ? (
        <Card title={`Executive Board — ${board.seats.length} permanent seats`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {board.seats.map((seat) => (
              <div key={seat.seat} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{seat.seat}</p>
                <p className="truncate text-sm font-medium text-slate-800">{seat.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {seat.enabled ? 'active' : 'disabled'} · {seat.latestDigest ? `digest ${String(seat.latestDigest.producedAt).slice(0, 10)}` : 'no digest yet'}
                </p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------- Copilot */

function CopilotTab() {
  const [command, setCommand] = useState('');
  const [answer, setAnswer] = useState<{ answer: string; intent: string | null; pendingApprovals: string[] } | null>(null);
  const [history, setHistory] = useState<Array<{ command: string; answer: string; intent: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!command.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await aiOsApi.copilot(command.trim());
      setAnswer(res);
      setHistory((h) => [{ command: command.trim(), answer: res.answer, intent: res.intent }, ...h].slice(0, 10));
      setCommand('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Copilot call failed');
    } finally {
      setBusy(false);
    }
  }

  const examples = [
    "Show today's failed payments",
    'find customers with overdue invoices',
    'show servers with abnormal cpu',
    'summarize unresolved support tickets',
    'show stuck provisioning',
    'show expiring ssl certificates',
    'platform overview',
  ];

  return (
    <div className="space-y-6">
      <Card title="Admin Copilot — asks are answered from tools, not from guesses">
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="e.g. show today's failed payments"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <button disabled={busy || command.trim().length < 3} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            {busy ? 'Running…' : 'Ask'}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {examples.map((ex) => (
            <button
              key={ex}
              onClick={() => setCommand(ex)}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {ex}
            </button>
          ))}
        </div>
        <ErrorBox text={error} />
        {answer ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
              {answer.intent ? <Pill text={answer.intent} tone="bg-slate-200 text-slate-700" /> : null}
              {answer.pendingApprovals.length > 0 ? <Pill text={`${answer.pendingApprovals.length} approval(s) requested`} tone={statusPill('pending')} /> : null}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800">{answer.answer}</pre>
          </div>
        ) : null}
      </Card>
      {history.length > 1 ? (
        <Card title="Recent asks">
          <ul className="divide-y divide-slate-100">
            {history.slice(1).map((h, i) => (
              <li key={i} className="py-2">
                <p className="text-sm font-medium text-slate-800">{h.command}</p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{h.answer.slice(0, 220)}{h.answer.length > 220 ? '…' : ''}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------------------- Agents */

function AgentsTab() {
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [boardOnly, setBoardOnly] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      setError('');
      const res = await aiOsApi.listAgents({ boardOnly });
      setAgents(res.agents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Load failed');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardOnly]);

  async function toggle(agent: AiAgent) {
    if (busyId) return;
    setBusyId(agent.id);
    setError('');
    try {
      await aiOsApi.setAgentEnabled(agent.id, !agent.enabled);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Toggle failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">{agents.length} registered agent(s). Tool grants come from the code catalog; enabling/disabling is the operator kill switch.</p>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={boardOnly} onChange={(e) => setBoardOnly(e.target.checked)} />
          Board seats only
        </label>
      </div>
      <ErrorBox text={error} />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Risk</th>
              <th className="px-4 py-3">Policy</th>
              <th className="px-4 py-3">Task types</th>
              <th className="px-4 py-3">Tools</th>
              <th className="px-4 py-3">Enabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agents.map((agent) => (
              <Fragment key={agent.id}>
                <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(expanded === agent.id ? null : agent.id)}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">
                      {agent.board_seat ? <span className="mr-1 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-bold text-indigo-700">{agent.board_seat}</span> : null}
                      {agent.name}
                    </p>
                    <p className="text-xs text-slate-500">{agent.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{agent.category}</td>
                  <td className="px-4 py-3"><Pill text={agent.risk_level} tone={severityPill(agent.risk_level)} /></td>
                  <td className="px-4 py-3 text-slate-600">{agent.approval_policy}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{agent.task_types.length}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{agent.tools.length}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggle(agent);
                      }}
                      disabled={busyId === agent.id}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        agent.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                      } disabled:opacity-40`}
                    >
                      {busyId === agent.id ? '…' : agent.enabled ? 'on' : 'off'}
                    </button>
                  </td>
                </tr>
                {expanded === agent.id ? (
                  <tr key={`${agent.id}-detail`} className="bg-slate-50">
                    <td colSpan={7} className="px-4 py-3">
                      <p className="text-xs text-slate-600">{agent.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {agent.tools.map((t) => (
                          <span key={t} className="rounded bg-white px-2 py-0.5 text-xs text-slate-600 border border-slate-200">{t}</span>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {agent.task_types.map((t) => (
                          <span key={t} className="rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{t}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------------------- Tasks */

function TasksTab() {
  const [tasks, setTasks] = useState<AiTask[]>([]);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [agentSlug, setAgentSlug] = useState('');
  const [taskType, setTaskType] = useState('');
  const [inputJson, setInputJson] = useState('{}');
  const [statusFilter, setStatusFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      setError('');
      const [taskList, agentList] = await Promise.all([aiOsApi.listTasks({ status: statusFilter || undefined, limit: 50 }), aiOsApi.listAgents()]);
      setTasks(taskList.tasks);
      setAgents(agentList.agents.filter((a) => a.enabled));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Load failed');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const selectedAgent = useMemo(() => agents.find((a) => a.slug === agentSlug), [agents, agentSlug]);

  async function dispatch(e: FormEvent) {
    e.preventDefault();
    if (!agentSlug || !taskType || busy) return;
    let input: Record<string, unknown> = {};
    try {
      input = inputJson.trim() ? (JSON.parse(inputJson) as Record<string, unknown>) : {};
    } catch {
      setError('Input must be valid JSON');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await aiOsApi.dispatchTask({ agentSlug, taskType, input });
      setMessage(
        `Task ${res.task.id.slice(0, 8)}… finished '${res.runStatus}'` +
          (res.pendingApprovals.length ? ` · ${res.pendingApprovals.length} action(s) landed in the Decision Inbox.` : '') +
          (res.task.result_summary ? ` — ${res.task.result_summary}` : '')
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dispatch failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Dispatch a task">
        <form onSubmit={dispatch} className="grid gap-3 sm:grid-cols-2">
          <select value={agentSlug} onChange={(e) => { setAgentSlug(e.target.value); setTaskType(''); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Select agent…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.slug}>
                {a.board_seat ? `[${a.board_seat}] ` : ''}{a.name}
              </option>
            ))}
          </select>
          <select value={taskType} onChange={(e) => setTaskType(e.target.value)} disabled={!selectedAgent} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">
            <option value="">Select task type…</option>
            {selectedAgent?.task_types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <textarea
            value={inputJson}
            onChange={(e) => setInputJson(e.target.value)}
            rows={3}
            placeholder='{"limit": 10}'
            className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs sm:col-span-2"
          />
          <div className="sm:col-span-2 flex items-center gap-3">
            <button disabled={busy || !agentSlug || !taskType} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              {busy ? 'Running…' : 'Run task'}
            </button>
            {message ? <p className="text-xs text-slate-600">{message}</p> : null}
          </div>
        </form>
        <ErrorBox text={error} />
      </Card>

      <Card title="Recent tasks">
        <div className="mb-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            <option value="">All statuses</option>
            {['queued', 'running', 'awaiting_approval', 'succeeded', 'failed'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        {tasks.length === 0 ? (
          <Empty text="No tasks yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="pr-4 pb-2">Task</th><th className="pr-4 pb-2">Agent</th><th className="pr-4 pb-2">Status</th><th className="pr-4 pb-2">Summary</th><th className="pb-2">Created</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((t) => (
                  <tr key={t.id} className="align-top">
                    <td className="py-2 pr-4 font-mono text-xs text-slate-600">{t.task_type}</td>
                    <td className="py-2 pr-4 text-xs">{t.agent_name ?? t.agent_slug ?? t.agent_id.slice(0, 8)}</td>
                    <td className="py-2 pr-4"><Pill text={t.status} tone={statusPill(t.status)} /></td>
                    <td className="max-w-md py-2 pr-4 text-xs text-slate-600">{t.result_summary ?? '—'}</td>
                    <td className="whitespace-nowrap py-2 text-xs text-slate-400">{new Date(t.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------------------------- Approvals */

function ApprovalsTab({ authRole }: { authRole?: string }) {
  const [approvals, setApprovals] = useState<AiApproval[]>([]);
  const [history, setHistory] = useState<AiApproval[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const canManage = authRole === 'admin' || authRole === 'super_admin';

  async function load() {
    try {
      setError('');
      const [pending, done] = await Promise.all([aiOsApi.listApprovals('pending'), aiOsApi.listApprovals('executed').catch(() => ({ approvals: [] as AiApproval[] }))]);
      setApprovals(pending.approvals);
      setHistory(done.approvals.slice(0, 10));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Load failed');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(id: string, decision: 'approved' | 'rejected') {
    if (busyId || !canManage) return;
    setBusyId(id);
    setError('');
    setInfo('');
    try {
      const res = await aiOsApi.decideApproval(id, decision);
      setInfo(
        decision === 'approved'
          ? res.executed
            ? 'Approved and executed — the sealed tool ran exactly as sealed. See the audit trail.'
            : `Approved but execution reported an error: ${res.executionError ?? 'unknown'}. The sealed action did NOT silently succeed.`
          : 'Rejected — the sealed action was never executed.'
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Decision failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card title={`Decision Inbox — ${approvals.length} pending`}>
        <p className="mb-4 text-xs text-slate-500">
          Sealed actions are stored, not impressed. Approving EXECUTES the tool afterwards with you as the acting human; rejecting
          seals it off permanently. Decisions are single-use. {!canManage ? 'You can view the inbox but only administrators may decide.' : ''}
        </p>
        {approvals.length === 0 ? (
          <Empty text="Nothing awaits a human decision. Every risky tool call stays here until someone decides." />
        ) : (
          <ul className="space-y-4">
            {approvals.map((a) => (
              <li key={a.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-900">{a.tool}</span>
                  <Pill text={a.risk_level} tone={severityPill(a.risk_level)} />
                  <Pill text={a.status} tone={statusPill(a.status)} />
                  <span className="text-xs text-slate-500">by {a.agent_name ?? a.agent_slug ?? 'agent'}</span>
                  <span className="ml-auto text-xs text-slate-400">expires {new Date(a.expires_at).toLocaleString()}</span>
                </div>
                <p className="mt-2 text-sm text-slate-700">{a.reason}</p>
                {a.preview ? (
                  <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-white p-3 text-xs text-slate-600 border border-amber-100">
                    {JSON.stringify(a.preview, null, 2)}
                  </pre>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={!canManage || busyId === a.id}
                    onClick={() => void decide(a.id, 'approved')}
                    className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {busyId === a.id ? '…' : 'Approve & execute'}
                  </button>
                  <button
                    disabled={!canManage || busyId === a.id}
                    onClick={() => void decide(a.id, 'rejected')}
                    className="rounded-lg border border-red-300 bg-white px-4 py-1.5 text-sm font-medium text-red-700 disabled:opacity-40"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <ErrorBox text={error} />
        {info ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{info}</p> : null}
      </Card>

      {history.length > 0 ? (
        <Card title="Recently executed approvals">
          <ul className="divide-y divide-slate-100 text-sm">
            {history.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2">
                <Pill text={a.status} tone={statusPill(a.status)} />
                <span className="font-mono text-xs">{a.tool}</span>
                <span className="text-xs text-slate-500 truncate">{a.reason.slice(0, 90)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------------------- Board */

function BoardTab() {
  const [board, setBoard] = useState<BoardOverview | null>(null);
  const [reports, setReports] = useState<ExecutiveReport[]>([]);
  const [selected, setSelected] = useState<ExecutiveReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      setError('');
      const [boardData, briefingList] = await Promise.all([aiOsApi.getBoard(), aiOsApi.listBriefings()]);
      setBoard(boardData);
      setReports(briefingList.reports);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Load failed');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate(type: 'daily' | 'weekly' | 'monthly') {
    if (busy) return;
    setBusy(type);
    setError('');
    setMessage('');
    try {
      const res = await aiOsApi.generateBriefing(type);
      setMessage(
        res.created
          ? `New ${type} briefing generated (id ${res.report.id.slice(0, 8)}…). Each seat contributed its own digest — unavailable seats are marked, never ghosted.`
          : `A final ${type} briefing already exists for this period (id ${res.report.id.slice(0, 8)}…) — generation is idempotent. Showing that report.`
      );
      setSelected(res.report);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not generate ${type} briefing`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Generate a briefing">
        <div className="flex flex-wrap gap-2">
          {(['daily', 'weekly', 'monthly'] as const).map((type) => (
            <button
              key={type}
              onClick={() => void generate(type)}
              disabled={busy !== null}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium capitalize text-white disabled:opacity-40"
            >
              {busy === type ? 'Assembling seats…' : `${type} briefing`}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Every seat runs its own audited digest task; the CEO stitches them live. Repeat clicks return the same final report.</p>
        {message ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}
        <ErrorBox text={error} />
      </Card>

      {board ? (
        <Card title={`Seats — ${board.seats.length} permanent members · ${board.openHighSeverityFindings} open high-severity finding(s)`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {board.seats.map((seat) => (
              <div key={seat.seat} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{seat.seat}</p>
                <p className={`text-xs ${seat.enabled ? 'text-emerald-600' : 'text-red-500'}`}>
                  {seat.enabled ? 'active' : 'disabled — digests marked UNAVAILABLE in briefings'}
                </p>
                {seat.latestDigest?.headline ? (
                  <p className="mt-1 line-clamp-3 text-xs text-slate-500">"{seat.latestDigest.headline}"</p>
                ) : (
                  <p className="mt-1 text-xs italic text-slate-400">no digest produced yet — quoted as null, never invented</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Recent briefings" className="lg:col-span-1">
          {reports.length === 0 ? <Empty text="No briefings yet." /> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {reports.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelected(r)}
                    className={`w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50 ${selected?.id === r.id ? 'bg-indigo-50' : ''}`}
                  >
                    <span className="font-medium capitalize">{r.report_type}</span>
                    <span className="ml-2 text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={selected ? `${selected.report_type} briefing — ${new Date(selected.created_at).toLocaleString()}` : 'Select a briefing'} className="lg:col-span-2">
          {!selected ? (
            <Empty text="Pick a briefing from the list or generate one." />
          ) : (
            <div className="space-y-5">
              {selected.sections?.map((section) => (
                <div key={section.seat}>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">{section.seat}</h3>
                  <p className="mt-0.5 text-sm font-medium text-slate-900">{section.headline}</p>
                  {section.bullets?.length ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                      {section.bullets.map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
              {selected.finding_ids && selected.finding_ids.length > 0 ? (
                <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                  Attached evidence: {selected.finding_ids.length} open high/critical finding(s) — inspect them under Findings & Incidents.
                </p>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- Findings & incidents */

function FindingsTab() {
  const [findings, setFindings] = useState<AiFinding[]>([]);
  const [incidents, setIncidents] = useState<AiIncident[]>([]);
  const [severity, setSeverity] = useState('');
  const [error, setError] = useState('');
  const [incidentForm, setIncidentForm] = useState({ title: '', severity: 'medium' as string, summary: '' });
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setError('');
      const [f, i] = await Promise.all([aiOsApi.listFindings({ severity: severity || undefined }), aiOsApi.listIncidents()]);
      setFindings(f.findings);
      setIncidents(i.incidents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Load failed');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity]);

  async function openIncident(e: FormEvent) {
    e.preventDefault();
    if (busy || incidentForm.title.trim().length < 3) return;
    setBusy(true);
    try {
      await aiOsApi.createIncident({
        title: incidentForm.title.trim(),
        severity: incidentForm.severity as 'low' | 'medium' | 'high' | 'critical',
        summary: incidentForm.summary,
      });
      setIncidentForm({ title: '', severity: 'medium', summary: '' });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open incident');
    } finally {
      setBusy(false);
    }
  }

  async function addNote(incident: AiIncident) {
    const note = (noteById[incident.id] ?? '').trim();
    if (!note) return;
    try {
      setError('');
      await aiOsApi.addIncidentNote(incident.id, note, incident.status === 'resolved' ? undefined : undefined);
      setNoteById((m) => ({ ...m, [incident.id]: '' }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Note failed');
    }
  }

  async function resolve(incident: AiIncident) {
    try {
      setError('');
      await aiOsApi.addIncidentNote(incident.id, noteById[incident.id]?.trim() || 'Resolved by operator', 'resolved');
      setNoteById((m) => ({ ...m, [incident.id]: '' }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Resolve failed');
    }
  }

  return (
    <div className="space-y-6">
      <Card title={`Findings — evidence-linked, ${findings.length} shown`}>
        <div className="mb-3 flex gap-2">
          {['', 'info', 'low', 'medium', 'high', 'critical'].map((s) => (
            <button key={s || 'all'} onClick={() => setSeverity(s)} className={`rounded-full px-3 py-1 text-xs ${severity === s ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600'}`}>
              {s || 'all'}
            </button>
          ))}
        </div>
        {findings.length === 0 ? <Empty text="No findings recorded. Agents emit findings only when real data crosses real thresholds." /> : (
          <ul className="space-y-3">
            {findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill text={f.severity} tone={severityPill(f.severity)} />
                  <Pill text={f.status} tone={statusPill(f.status)} />
                  <span className="font-mono text-xs text-slate-400">{f.finding_type}</span>
                  <span className="ml-auto text-xs text-slate-400">{new Date(f.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-900">{f.title}</p>
                {f.description ? <p className="mt-1 text-xs text-slate-600">{f.description}</p> : null}
                <p className="mt-1 text-xs text-slate-400">
                  Evidence: {(f.evidence ?? []).map((e) => `${e.table}${e.id ? `#${String(e.id).slice(0, 8)}` : ''}`).join(', ') || '—'}
                </p>
              </li>
            ))}
          </ul>
        )}
        <ErrorBox text={error} />
      </Card>

      <Card title="Incidents">
        <form onSubmit={openIncident} className="mb-4 grid gap-2 sm:grid-cols-4">
          <input value={incidentForm.title} onChange={(e) => setIncidentForm((f) => ({ ...f, title: e.target.value }))} placeholder="Incident title" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <select value={incidentForm.severity} onChange={(e) => setIncidentForm((f) => ({ ...f, severity: e.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button disabled={busy || incidentForm.title.trim().length < 3} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Open incident</button>
          <textarea value={incidentForm.summary} onChange={(e) => setIncidentForm((f) => ({ ...f, summary: e.target.value }))} placeholder="Summary (optional)" rows={2} className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-4" />
        </form>
        {incidents.length === 0 ? <Empty text="No incidents open. The Incident Commander opens them from correlated findings — humans can open one here." /> : (
          <ul className="space-y-3">
            {incidents.map((i) => (
              <li key={i.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{i.incident_number}</span>
                  <Pill text={i.severity} tone={severityPill(i.severity)} />
                  <Pill text={i.status} tone={statusPill(i.status)} />
                  <span className="ml-auto text-xs text-slate-400">opened {new Date(i.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-900">{i.title}</p>
                <ul className="mt-2 space-y-1">
                  {(i.timeline ?? []).map((t, idx) => (
                    <li key={idx} className="text-xs text-slate-500">· [{String(t.at).slice(0, 16)}] {t.note} — {t.by}</li>
                  ))}
                </ul>
                {i.status !== 'resolved' ? (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={noteById[i.id] ?? ''}
                      onChange={(e) => setNoteById((m) => ({ ...m, [i.id]: e.target.value }))}
                      placeholder="Timeline note"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    />
                    <button onClick={() => void addNote(i)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Add note</button>
                    <button onClick={() => void resolve(i)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white">Resolve</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- Ops */

function OpsTab() {
  const [events, setEvents] = useState<AiEventRow[]>([]);
  const [workflows, setWorkflows] = useState<AiWorkflow[]>([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      setError('');
      const [e, w] = await Promise.all([aiOsApi.listEvents(), aiOsApi.listWorkflows()]);
      setEvents(e.events);
      setWorkflows(w.workflows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Load failed');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <Card title="Workflows — event → agent chains">
        {workflows.length === 0 ? <Empty text="No workflows registered." /> : (
          <ul className="space-y-3">
            {workflows.map((w) => (
              <li key={w.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <Pill text={w.enabled ? 'on' : 'off'} tone={w.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'} />
                  <span className="font-medium text-slate-900">{w.name}</span>
                  <span className="ml-auto font-mono text-xs text-slate-500">WHEN {w.event_type}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{w.description}</p>
                <p className="mt-1 text-xs text-slate-400">Steps: {w.definition.map((d) => d.agent_slug).join(' → ')}</p>
              </li>
            ))}
          </ul>
        )}
        <ErrorBox text={error} />
      </Card>

      <Card title={`Platform events — fingerprint-deduplicated, ${events.length} recent`}>
        {events.length === 0 ? <Empty text="No events yet. Detectors emit events only for rows that actually exist." /> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="pr-4 pb-2">Type</th><th className="pr-4 pb-2">Source</th><th className="pr-4 pb-2">Fingerprint</th><th className="pr-4 pb-2">Emitted</th><th className="pb-2">Processed</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-700">{e.event_type}</td>
                    <td className="py-2 pr-4 text-xs text-slate-500">{e.source}</td>
                    <td className="max-w-xs truncate py-2 pr-4 font-mono text-xs text-slate-400">{e.fingerprint}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-xs text-slate-400">{new Date(e.emitted_at).toLocaleString()}</td>
                    <td className="py-2 text-xs">{e.processed_at ? <span className="text-emerald-600">✓</span> : <span className="text-amber-500">pending</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------------------- Knowledge */

function KnowledgeTab() {
  const [sources, setSources] = useState<AiKnowledgeSource[]>([]);
  const [form, setForm] = useState({ title: '', sourceType: 'runbook', content: '', keywords: '' });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ content: string; citation: { source: string; version: string }; score: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function load() {
    try {
      setError('');
      const res = await aiOsApi.listKnowledge();
      setSources(res.sources);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Load failed');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (busy || !form.title.trim() || form.content.trim().length < 10) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await aiOsApi.createKnowledge({
        title: form.title.trim(),
        sourceType: form.sourceType,
        content: form.content.trim(),
        keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean),
      });
      setForm({ title: '', sourceType: 'runbook', content: '', keywords: '' });
      setInfo('Knowledge source stored. Agents cite it by title+version when it matches a query.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    try {
      setError('');
      const res = await aiOsApi.searchKnowledge(query.trim());
      setResults(res.results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Search failed');
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Register knowledge (citation-first answers)">
        <form onSubmit={create} className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title (e.g. Restarting a VPS safely)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
            <select value={form.sourceType} onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {['runbook', 'doc', 'policy', 'manual', 'faq'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} placeholder="Content — agents quote and cite this verbatim; nothing is paraphrased into unsupported claims" rows={5} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={form.keywords} onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))} placeholder="Keywords, comma separated" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <div className="flex items-center gap-3">
            <button disabled={busy || !form.title.trim() || form.content.trim().length < 10} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              {busy ? 'Storing…' : 'Store'}
            </button>
            {info ? <span className="text-xs text-emerald-700">{info}</span> : null}
          </div>
        </form>
        <ErrorBox text={error} />
      </Card>

      <Card title="Retrieval probe (as agents see it)">
        <form onSubmit={search} className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Query, e.g. how do I restart a vps" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Search</button>
        </form>
        {results.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">{query ? 'No matching chunks — an agent would answer NOT DOCUMENTED instead of guessing.' : ''}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {results.map((r, i) => (
              <li key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="text-slate-800">{r.content}</p>
                <p className="mt-1 text-xs text-slate-500">— Source: {r.citation.source} (v{r.citation.version}) · score {r.score.toFixed(2)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Registered sources (${sources.length})`}>
        {sources.length === 0 ? <Empty text="Empty knowledge base — agents will refuse to answer unsupported questions." /> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <Pill text={s.source_type} tone="bg-indigo-50 text-indigo-700" />
                <span className="font-medium text-slate-800">{s.title}</span>
                <span className="text-xs text-slate-400">v{s.version}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------------------------------- Models */

function ModelsTab({ authRole }: { authRole?: string }) {
  const [models, setModels] = useState<AiModelConfig[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busyEngine, setBusyEngine] = useState<string | null>(null);
  const canManage = authRole === 'super_admin';

  async function load() {
    try {
      setError('');
      const res = await aiOsApi.listModels();
      setModels(res.models);
      setNote(res.note);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Load failed');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(m: AiModelConfig) {
    if (!canManage || busyEngine) return;
    setBusyEngine(m.engine);
    setError('');
    try {
      await aiOsApi.updateModel(m.engine, { enabled: !m.enabled, provider: m.provider, model: m.model, endpoint: m.endpoint, notes: m.notes });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Update failed');
    } finally {
      setBusyEngine(null);
    }
  }

  return (
    <Card title="Model routing — fails closed">
      <p className="mb-4 text-xs text-slate-500">{note}</p>
      {!canManage ? <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Read-only here — model configuration changes require super_admin.</p> : null}
      <ErrorBox text={error} />
      <table className="min-w-full text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-400">
          <th className="pr-4 pb-2">Engine</th><th className="pr-4 pb-2">Provider</th><th className="pr-4 pb-2">Model</th><th className="pr-4 pb-2">Enabled</th><th className="pb-2">Notes</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {models.map((m) => (
            <tr key={m.engine}>
              <td className="py-2 pr-4 font-mono text-xs font-semibold text-slate-800">{m.engine}</td>
              <td className="py-2 pr-4 text-xs text-slate-600">{m.provider ?? '—'}</td>
              <td className="py-2 pr-4 text-xs text-slate-600">{m.model ?? <span className="text-slate-400">unconfigured</span>}</td>
              <td className="py-2 pr-4">
                <button
                  onClick={() => void toggle(m)}
                  disabled={!canManage || busyEngine === m.engine}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${m.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'} disabled:opacity-40`}
                >
                  {busyEngine === m.engine ? '…' : m.enabled ? 'on' : 'off'}
                </button>
              </td>
              <td className="py-2 text-xs text-slate-500">{m.notes ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ---------------------------------------------------------------------------------------- Audit */

function AuditTab() {
  const [entries, setEntries] = useState<AiAuditEntry[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await aiOsApi.listAudit(150);
        setEntries(res.entries);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Load failed');
      }
    })();
  }, []);

  return (
    <Card title={`Append-only audit — ${entries.length} recent entries`}>
      <p className="mb-4 text-xs text-slate-500">Every tool admission, denial, approval decision and execution lands here. Storage is redacted of secrets automatically.</p>
      {error ? <ErrorBox text={error} /> : null}
      {entries.length === 0 ? <Empty text="No audit entries yet — anything the AI does would appear here first." /> : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="pr-4 pb-2">When</th><th className="pr-4 pb-2">Action</th><th className="pr-4 pb-2">Agent</th><th className="pr-4 pb-2">Tool</th><th className="pr-4 pb-2">Status</th><th className="pr-4 pb-2">Error</th><th className="pb-2">Duration</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap py-2 pr-4 text-xs text-slate-400">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-700">{e.action}</td>
                  <td className="py-2 pr-4 text-xs text-slate-500">{e.agent_slug ?? (e.agent_id ? `${e.agent_id.slice(0, 8)}…` : '—')}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-500">{e.tool ?? '—'}</td>
                  <td className="py-2 pr-4"><Pill text={e.status} tone={e.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : e.status === 'denied' ? 'bg-red-100 text-red-700' : statusPill(e.status)} /></td>
                  <td className="py-2 pr-4 text-xs text-slate-500">{e.error_code ?? ''}</td>
                  <td className="py-2 text-xs text-slate-400">{e.duration_ms != null ? `${e.duration_ms}ms` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
