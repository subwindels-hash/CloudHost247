import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { usePageMeta } from '../../lib/usePageMeta';
import { useAuthState } from '../../layout/useAuthState';
import {
  aiOsApi,
  AiAgent,
  AiApproval,
  AiDelayedApproval,
  AiAcknowledgedIncompleteRun,
  AiAuditEntry,
  AiEventRow,
  AiHeldEventClaim,
  AiFinding,
  AiIncident,
  AiKnowledgeSource,
  AiModelConfig,
  AiTask,
  AiWorkflow,
  AiWorkflowRun,
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
    succeeded: 'bg-amber-100 text-amber-700',
    failed: 'bg-red-100 text-red-700',
    cancelled: 'bg-slate-200 text-slate-500',
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-amber-100 text-amber-700',
    rejected: 'bg-red-100 text-red-700',
    expired: 'bg-slate-200 text-slate-500',
    executed: 'bg-amber-100 text-amber-700',
    open: 'bg-red-100 text-red-700',
    acknowledged: 'bg-amber-100 text-amber-800',
    closed: 'bg-slate-200 text-slate-600',
    investigating: 'bg-amber-100 text-amber-800',
    mitigated: 'bg-blue-100 text-blue-700',
    resolved: 'bg-amber-100 text-amber-700',
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
  const [uncertainDecision, setUncertainDecision] = useState(false);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">AI Command Center</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Operational snapshots of AI tasks, approvals and workflows. Statuses are not independent proof of downstream outcomes;
          investigate uncertain activity before taking further action.
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
      {tab === 'approvals' && <ApprovalsTab authRole={authUser?.role} uncertainDecision={uncertainDecision} setUncertainDecision={setUncertainDecision} />}
      {tab === 'board' && <BoardTab />}
      {tab === 'findings' && <FindingsTab />}
      {tab === 'ops' && <OpsTab authRole={authUser?.role} />}
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
    ['Unprocessed events', totals.eventsUnprocessed, 'may include held or incomplete work'],
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

      <Card title="Recorded tool calls">
        <p className="text-2xl font-bold text-slate-900">{totals.toolCalls}</p>
        <p className="text-xs text-slate-500">Recorded count only; it does not establish complete audit coverage or verify downstream effects.</p>
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
                        agent.enabled ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-500'
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

function ApprovalsTab({ authRole, uncertainDecision, setUncertainDecision }: { authRole?: string; uncertainDecision: boolean; setUncertainDecision: (value: boolean) => void }) {
  const [approvals, setApprovals] = useState<AiApproval[] | null>(null);
  const [history, setHistory] = useState<AiApproval[] | null>(null);
  const [pendingError, setPendingError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const generation = useRef(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const canManage = authRole === 'admin' || authRole === 'super_admin';

  async function load() {
    const current = ++generation.current;
    setApprovals(null);
    setHistory(null);
    setReviewed({});
    setPendingError('');
    setHistoryError('');
    const pendingRequest = aiOsApi.listApprovals('pending').then((result) => {
        if (current === generation.current) setApprovals(result.approvals);
      }).catch(() => {
        if (current === generation.current) setPendingError('Pending approvals unavailable. Refresh before making a decision.');
      });
    void aiOsApi.listApprovals('executed').then((result) => {
        if (current === generation.current) setHistory(result.approvals.slice(0, 10));
      }).catch(() => {
        if (current === generation.current) setHistoryError('Executed approval history unavailable.');
      });
    await pendingRequest;
  }

  useEffect(() => {
    void load();
    return () => { generation.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(approval: AiApproval, decision: 'approved' | 'rejected') {
    const { id, reviewFingerprint } = approval;
    if (busyId || !canManage || uncertainDecision || !reviewFingerprint || reviewed[id] !== reviewFingerprint || (decision === 'approved' && approval.arguments_verified !== true)) return;
    setBusyId(id);
    setError('');
    setInfo('');
    try {
      const res = await aiOsApi.decideApproval(id, decision, reviewFingerprint);
      setInfo(
        decision === 'approved'
          ? res.executed
            ? 'The tool reported success. Review the audit trail; downstream outcomes may require separate verification.'
            : `Approved but execution did not report success: ${res.executionError ?? 'unknown'}. Investigate before taking further action; effects may be uncertain.`
          : 'Rejected. Review prior activity separately if the outcome is uncertain.'
      );
      await load();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Request failed';
      setUncertainDecision(true);
      setError(`${detail} — decision or execution outcome may be unknown. Reload the page and investigate before taking further action.`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card title={approvals ? `Decision Inbox — ${approvals.length} shown` : "Decision Inbox"}>
        <p className="mb-4 text-xs text-slate-500">
          This snapshot shows up to 100 pending proposals, newest first; it is not a complete queue. Approving attempts tool execution
          after the decision. Rejection does not establish whether any earlier effect occurred. {!canManage ? 'You can view the inbox but only administrators may decide.' : ''}
        </p>
        <button onClick={() => void load()} disabled={Boolean(busyId)} className="mb-3 rounded-lg border border-slate-300 px-3 py-1 text-sm disabled:opacity-40">Refresh decision inbox</button>
        {pendingError ? <ErrorBox text={pendingError} /> : !approvals ? <p className="text-sm text-slate-500">Loading pending approvals…</p> : approvals.length === 0 ? (
          <Empty text="No pending approvals in this snapshot." />
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
                <p className="mt-2 text-xs text-slate-600">Review the stored proposal below. {a.arguments_verified ? 'Arguments passed the local preservation check; it does not verify intent, authorization or sensitive content.' : 'Original arguments cannot be verified. Reject or investigate; approval is disabled.'}</p>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white p-3 text-xs text-slate-600 border border-amber-100">
                  {JSON.stringify({ action: a.action, arguments: a.arguments, affectedCustomerId: a.affected_customer_id, affectedResource: a.affected_resource, taskId: a.task_id, runId: a.run_id, evidence: a.evidence }, null, 2)}
                </pre>
                <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={Boolean(a.reviewFingerprint && reviewed[a.id] === a.reviewFingerprint)} disabled={!canManage || Boolean(busyId) || uncertainDecision || !a.reviewFingerprint}
                    onChange={(event) => setReviewed((current) => ({ ...current, [a.id]: event.target.checked ? a.reviewFingerprint : '' }))} />
                  I reviewed this stored proposal and its scope.
                </label>
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={!canManage || Boolean(busyId) || uncertainDecision || !a.reviewFingerprint || reviewed[a.id] !== a.reviewFingerprint || a.arguments_verified !== true}
                    onClick={() => void decide(a, 'approved')}
                    className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {busyId === a.id ? '…' : 'Approve & execute'}
                  </button>
                  <button
                    disabled={!canManage || Boolean(busyId) || uncertainDecision || !a.reviewFingerprint || reviewed[a.id] !== a.reviewFingerprint}
                    onClick={() => void decide(a, 'rejected')}
                    className="rounded-lg border border-red-300 bg-white px-4 py-1.5 text-sm font-medium text-red-700 disabled:opacity-40"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <ErrorBox text={error || (uncertainDecision ? 'A previous decision outcome may be unknown. Investigate before taking further action; decisions remain disabled in this page until reload.' : '')} />
        {info ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{info}</p> : null}
      </Card>

      <DelayedApprovalsPanel />

      <Card title="Executed approval snapshot">
        <p className="mb-3 text-xs text-slate-600">Up to 10 of the most recently created executed approvals returned by the API; this is not complete history or independent outcome verification.</p>
        {historyError ? <ErrorBox text={historyError} /> : !history ? <p className="text-sm text-slate-500">Loading executed approvals…</p> : history.length === 0 ? <Empty text="No executed approvals in this snapshot." /> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {history.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2">
                <Pill text={a.status} tone={statusPill(a.status)} />
                <span className="font-mono text-xs">{a.tool}</span>
                <span className="text-xs text-slate-500 truncate">{a.reason.slice(0, 90)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DelayedApprovalsPanel() {
  const [items, setItems] = useState<AiDelayedApproval[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  async function refresh() {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const result = await aiOsApi.listDelayedApprovals();
      if (current === generation.current) setItems(result.approvals);
    } catch (cause) {
      if (current === generation.current) {
        setItems(null);
        setError(cause instanceof Error ? cause.message : 'Delayed approvals unavailable');
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => { generation.current++; };
  }, []);

  return (
    <Card title="Delayed approval activity">
      <p className="mb-3 text-xs text-slate-600">
        Approved or executing approvals unchanged for at least five minutes, oldest first (up to 100).
        A worker may still be active; elapsed time does not prove failure or an effect's outcome.
        Investigate the referenced task, run and audit trail. Do not replay or reset an uncertain action.
        This is a bounded snapshot, not a complete history or a resolution queue.
      </p>
      <button onClick={() => void refresh()} className="mb-3 rounded-lg border border-slate-300 px-3 py-1 text-sm">Refresh delayed approvals</button>
      {loading ? <p className="text-sm text-slate-500">Loading delayed approvals…</p> : null}
      {!loading && error ? <ErrorBox text={error} /> : null}
      {!loading && !error && items?.length === 0 ? <Empty text="No delayed approvals in this view." /> : null}
      {!loading && !error && items && items.length > 0 ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {items.map((item) => (
            <li key={item.id} className="space-y-1 py-3">
              <div className="flex flex-wrap items-center gap-2"><Pill text={item.status} tone={statusPill(item.status)} />
                <span className="font-mono text-xs">{item.tool}</span>
                <span className="text-xs text-slate-500">Last updated {new Date(item.updated_at).toLocaleString()}</span></div>
              <p className="break-all text-xs text-slate-500">Approval {item.id}{item.task_id ? ` · task ${item.task_id}` : ''}{item.run_id ? ` · run ${item.run_id}` : ''}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
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
        {message ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</p> : null}
        <ErrorBox text={error} />
      </Card>

      {board ? (
        <Card title={`Seats — ${board.seats.length} permanent members · ${board.openHighSeverityFindings} open high-severity finding(s)`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {board.seats.map((seat) => (
              <div key={seat.seat} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{seat.seat}</p>
                <p className={`text-xs ${seat.enabled ? 'text-amber-600' : 'text-red-500'}`}>
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
                    <button onClick={() => void resolve(i)} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm text-white">Resolve</button>
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

function OpsTab({ authRole }: { authRole?: string }) {
  const [events, setEvents] = useState<AiEventRow[] | null>(null);
  const [workflows, setWorkflows] = useState<AiWorkflow[] | null>(null);
  const [claims, setClaims] = useState<AiHeldEventClaim[] | null>(null);
  const [eventsError, setEventsError] = useState('');
  const [workflowsError, setWorkflowsError] = useState('');
  const [claimsError, setClaimsError] = useState('');
  const claimsRequest = useRef(0);
  const eventsRequest = useRef(0);
  const workflowsRequest = useRef(0);
  const referencesRequest = useRef(0);
  const referencesByEvent = useRef<Record<string, number>>({});
  const [history, setHistory] = useState<AiAcknowledgedIncompleteRun[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyInfo, setHistoryInfo] = useState('');
  const [historyBusyId, setHistoryBusyId] = useState('');
  const historyRequest = useRef(0);
  const [runsByEvent, setRunsByEvent] = useState<Record<string, AiWorkflowRun[]>>({});
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const canInvestigate = authRole === 'admin' || authRole === 'super_admin';

  async function loadClaims() {
    const request = ++claimsRequest.current;
    referencesRequest.current++;
    setRunsByEvent({});
    setClaims(null);
    setClaimsError('');
    try {
      const result = await aiOsApi.listHeldEventClaims();
      if (request === claimsRequest.current) setClaims(result.claims);
    } catch (cause) {
      if (request === claimsRequest.current) setClaimsError(cause instanceof Error ? cause.message : 'Held claims unavailable');
    }
  }

  async function loadEvents() {
    const request = ++eventsRequest.current;
    setEvents(null);
    setEventsError('');
    try {
      const result = await aiOsApi.listEvents();
      if (request === eventsRequest.current) setEvents(result.events);
    } catch (cause) {
      if (request === eventsRequest.current) setEventsError(cause instanceof Error ? cause.message : 'Events unavailable');
    }
  }

  async function loadWorkflows() {
    const request = ++workflowsRequest.current;
    setWorkflows(null);
    setWorkflowsError('');
    try {
      const result = await aiOsApi.listWorkflows();
      if (request === workflowsRequest.current) setWorkflows(result.workflows);
    } catch (cause) {
      if (request === workflowsRequest.current) setWorkflowsError(cause instanceof Error ? cause.message : 'Workflows unavailable');
    }
  }

  async function loadHistory() {
    const request = ++historyRequest.current;
    setHistory(null);
    setHistoryError('');
    try {
      const result = await aiOsApi.listAcknowledgedIncompleteRuns();
      if (request === historyRequest.current) setHistory(result.runs);
    } catch (cause) {
      if (request === historyRequest.current) setHistoryError(cause instanceof Error ? cause.message : 'Could not load acknowledged incomplete runs');
    }
  }

  async function openAcknowledgedInvestigation(run: AiAcknowledgedIncompleteRun) {
    if (!window.confirm('Record attention for this acknowledged incomplete run? The worker may still be active. This does not verify an outcome, cancel, retry, assign or notify anyone.')) return;
    setHistoryBusyId(run.run_id);
    setHistoryError('');
    setHistoryInfo('');
    try {
      const result = await aiOsApi.openAcknowledgedRunInvestigation(run);
      setHistoryInfo(result.created ? 'Investigation recorded. No outcome was verified and no one was notified.' : 'An investigation was already recorded for this acknowledgement.');
      await loadHistory();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not record investigation';
      historyRequest.current++;
      setHistory(null);
      setHistoryError(`${message}. The result may be unknown. Refresh acknowledged runs and investigate before trying again.`);
    } finally { setHistoryBusyId(''); }
  }

  async function showRunReferences(eventId: string) {
    const generation = referencesRequest.current;
    const request = (referencesByEvent.current[eventId] ?? 0) + 1;
    referencesByEvent.current[eventId] = request;
    const isCurrent = () => generation === referencesRequest.current && referencesByEvent.current[eventId] === request;
    setRunsByEvent((current) => { const next = { ...current }; delete next[eventId]; return next; });
    try {
      setError('');
      const result = await aiOsApi.listWorkflowRunsForEvent(eventId);
      if (isCurrent()) setRunsByEvent((current) => ({ ...current, [eventId]: result.runs }));
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : 'Could not load workflow references');
    }
  }

  async function openInvestigation(claim: AiHeldEventClaim) {
    if (!window.confirm('Record an investigation for this delayed claim? The worker may still be active. This does not cancel, retry, assign, or notify anyone.')) return;
    try {
      setBusyId(claim.event_id);
      setError('');
      setInfo('');
      const result = await aiOsApi.openEventInvestigation(claim.event_id);
      setInfo(result.created ? 'Investigation recorded. No claim was released and no one was notified.' : 'This claim already has an investigation record.');
      await loadClaims();
    } catch (cause) {
      claimsRequest.current++;
      referencesRequest.current++;
      setClaims(null);
      setRunsByEvent({});
      setClaimsError(`${cause instanceof Error ? cause.message : 'Could not record investigation'}. The result may be unknown. Refresh claims and investigate before trying again.`);
    } finally { setBusyId(''); }
  }

  useEffect(() => {
    void loadClaims();
    void loadEvents();
    void loadWorkflows();
    void loadHistory();
    return () => { historyRequest.current++; claimsRequest.current++; eventsRequest.current++; workflowsRequest.current++; referencesRequest.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <Card title="Held event claims — investigation">
        <p className="mb-3 text-sm text-slate-600">A delayed claim may still have a live worker or an unknown external outcome. Incomplete workflows, including approval pauses, retain their claims; deciding an approval does not automatically resume or release the event. An approved action may still execute separately. Recording an investigation does not cancel, retry, assign, or notify anyone. Review the event, workflow runs and task audit before taking any further action. This view shows up to 100 oldest held claims.</p>
        <button type="button" onClick={() => void loadClaims()} disabled={Boolean(busyId)} className="mb-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Refresh claims</button>
        {info ? <p role="status" className="mb-3 text-sm text-slate-700">{info}</p> : null}
        <ErrorBox text={error} />
        <ErrorBox text={claimsError} />
        {claims === null ? (claimsError ? null : <p className="text-sm text-slate-500">Loading held claims…</p>) : claims.length === 0 ? <Empty text="No held event claims in this view." /> : (
          <ul className="space-y-3">
            {claims.map((claim) => (
              <li key={claim.event_id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill text={claim.delayed ? 'Delayed — investigate' : 'Claim held'} tone={claim.delayed ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'} />
                  <span className="font-mono text-xs text-slate-700">{claim.event_type}</span>
                  <time className="ml-auto text-xs text-slate-500" dateTime={claim.claimed_at}>Claimed {new Date(claim.claimed_at).toLocaleString()}</time>
                </div>
                <p className="mt-2 break-all font-mono text-xs text-slate-500">Event {claim.event_id}</p>
                <button type="button" onClick={() => void showRunReferences(claim.event_id)} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Show workflow references</button>
                {runsByEvent[claim.event_id] ? (
                  <div className="mt-2 text-xs text-slate-600">
                    {runsByEvent[claim.event_id]!.length === 0 ? <p>No run recorded; this does not establish whether work occurred.</p> : runsByEvent[claim.event_id]!.map((run) => (
                      <div key={run.id} className="mb-2 break-all">
                        <p>Workflow {run.workflow_slug} · {run.status} · run {run.id}</p>
                        {(Array.isArray(run.steps) ? run.steps : []).map((step, index) => <p key={index}>Step {typeof step?.step === 'string' ? step.step : 'unknown'} · {typeof step?.status === 'string' ? step.status : 'unknown'} · task {typeof step?.taskId === 'string' ? step.taskId : 'not recorded'}</p>)}
                      </div>
                    ))}
                    <p>Recorded state is not proof of an external outcome. At most 50 recent runs are shown.</p>
                  </div>
                ) : null}
                {claim.investigation_id ? (
                  <p className="mt-2 text-xs text-slate-600">Investigation recorded {claim.investigation_opened_at ? new Date(claim.investigation_opened_at).toLocaleString() : ''}. No outcome has been verified.</p>
                ) : canInvestigate && claim.delayed ? (
                  <button type="button" disabled={Boolean(busyId)} onClick={() => void openInvestigation(claim)} className="mt-2 rounded-lg border border-amber-600 px-3 py-1.5 text-sm text-amber-800 disabled:opacity-50">{busyId === claim.event_id ? 'Recording…' : 'Record investigation'}</button>
                ) : <p className="mt-2 text-xs text-slate-500">A claim becomes eligible for an investigation record after five minutes; age is not proof of interruption.</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Acknowledged events with incomplete workflow runs">
        <p className="mb-3 text-sm text-slate-600">An acknowledged event may still have incomplete or uncertain work. This view shows up to 100 recent incomplete runs whose event still exists; it is not a complete history or a list of unresolved cases. Empty results do not prove that no action needs review. An acknowledgement does not verify an external outcome. Recording attention does not cancel, retry, assign, notify or verify anything.</p>
        <button type="button" onClick={() => void loadHistory()} disabled={Boolean(historyBusyId)} className="mb-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Refresh acknowledged runs</button>
        {historyInfo ? <p role="status" className="mb-3 text-sm text-slate-700">{historyInfo}</p> : null}
        <ErrorBox text={historyError} />
        {history === null ? (historyError ? null : <p className="text-sm text-slate-500">Loading acknowledged runs…</p>) : history.length === 0 ? <Empty text="No matching runs in this view." /> : (
          <ul className="space-y-3">
            {history.map((run) => (
              <li key={run.run_id} className="rounded-lg border border-slate-200 p-3 text-xs text-slate-600">
                <p><span className="font-medium">{run.workflow_slug}</span> · {run.status} · {run.event_type}</p>
                <p className="mt-1 break-all font-mono">Event {run.event_id} · run {run.run_id}</p>
                <p className="mt-1">Started {new Date(run.started_at).toLocaleString()} · event acknowledged {new Date(run.processed_at).toLocaleString()}</p>
                {run.investigation_id ? (
                  <p className="mt-2">Investigation recorded {run.investigation_opened_at ? new Date(run.investigation_opened_at).toLocaleString() : ''} when status was {run.investigation_observed_status}. No outcome has been verified.</p>
                ) : canInvestigate ? (
                  <button type="button" disabled={Boolean(historyBusyId)} onClick={() => void openAcknowledgedInvestigation(run)} className="mt-2 rounded-lg border border-amber-600 px-3 py-1.5 text-sm text-amber-800 disabled:opacity-50">{historyBusyId === run.run_id ? 'Recording…' : 'Record run investigation'}</button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Workflows — event → agent chains">
        <button type="button" onClick={() => void loadWorkflows()} className="mb-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Refresh workflows</button>
        {workflowsError ? <ErrorBox text={workflowsError} /> : workflows === null ? <p className="text-sm text-slate-500">Loading workflows…</p> : workflows.length === 0 ? <Empty text="No workflows in this view." /> : (
          <ul className="space-y-3">
            {workflows.map((w) => (
              <li key={w.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <Pill text={w.enabled ? 'on' : 'off'} tone={w.enabled ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-500'} />
                  <span className="font-medium text-slate-900">{w.name}</span>
                  <span className="ml-auto font-mono text-xs text-slate-500">WHEN {w.event_type}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{w.description}</p>
                <p className="mt-1 text-xs text-slate-400">Steps: {w.definition.map((d) => d.agent_slug).join(' → ')}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Platform events — recent snapshot">
        <p className="mb-3 text-xs text-slate-600">Up to 100 events; fingerprint deduplication is best-effort. Processing status is not proof of an external outcome.</p>
        <button type="button" onClick={() => void loadEvents()} className="mb-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Refresh events</button>
        {eventsError ? <ErrorBox text={eventsError} /> : events === null ? <p className="text-sm text-slate-500">Loading events…</p> : events.length === 0 ? <Empty text="No events in this snapshot." /> : (
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
                    <td className="whitespace-nowrap py-2 pr-4 text-xs text-slate-400">{new Date(e.occurred_at).toLocaleString()}</td>
                    <td className="py-2 text-xs">{e.processed_at ? <span className="text-amber-600">acknowledged</span> : <span className="text-amber-500">pending</span>}</td>
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
            {info ? <span className="text-xs text-amber-700">{info}</span> : null}
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
                  className={`rounded-full px-3 py-1 text-xs font-medium ${m.enabled ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-500'} disabled:opacity-40`}
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
                  <td className="py-2 pr-4"><Pill text={e.status} tone={e.status === 'ok' ? 'bg-amber-100 text-amber-700' : e.status === 'denied' ? 'bg-red-100 text-red-700' : statusPill(e.status)} /></td>
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
