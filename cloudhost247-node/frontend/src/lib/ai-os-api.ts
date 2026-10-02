/**
 * AI Control Plane API client — typed wrappers over /api/v1/admin/ai/* and /api/v1/account/ai/*.
 * Uses the shared apiFetch (same-origin, bearer token) like every other module client.
 *
 * Contract notes (mirrored from the server, NOT trusted here — the server re-verifies):
 *   - Every mutating tool is approval-gated; approving an inbox item EXECUTES the sealed tool.
 *   - The customer assistant only ever sees the caller's own account (server-side scoping).
 */
import { apiFetch } from './api';

const ADMIN = '/api/v1/admin/ai';
const ACCOUNT = '/api/v1/account/ai';

// -------------------------------------------------------------------------------------------------
// Shared row shapes (snake_case — direct mirrors of the API payloads)
// -------------------------------------------------------------------------------------------------

export interface AiAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  board_seat: string | null;
  enabled: boolean;
  engine: string;
  approval_policy: 'automatic' | 'standard' | 'strict';
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  permissions: string[];
  tools: string[];
  task_types: string[];
}

export interface AiTask {
  id: string;
  agent_id: string;
  agent_slug?: string;
  agent_name?: string;
  task_type: string;
  status: 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled';
  context: Record<string, unknown>;
  result: Record<string, unknown> | null;
  result_summary: string | null;
  customer_id: string | null;
  created_at: string;
}

export interface AiApproval {
  id: string;
  agent_id: string;
  agent_slug?: string;
  agent_name?: string;
  tool: string;
  risk_level: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed';
  expires_at: string;
  preview?: Record<string, unknown>;
  requested_at?: string;
  created_at: string;
}

export interface AiFinding {
  id: string;
  finding_type: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string | null;
  subject_type: string | null;
  subject_id: string | null;
  status: 'open' | 'acknowledged' | 'closed';
  evidence: Array<{ table: string; id?: string; description?: string }>;
  emitter_agent_id: string | null;
  created_at: string;
}

export interface AiIncident {
  id: string;
  incident_number: string;
  severity: string;
  title: string;
  status: 'open' | 'investigating' | 'mitigated' | 'resolved';
  timeline: Array<{ at: string; note: string; by: string }>;
  opened_by_type: string;
  resolved_at: string | null;
  created_at: string;
}

export interface AiEventRow {
  id: string;
  event_type: string;
  source: string;
  payload: Record<string, unknown>;
  fingerprint: string;
  emitted_at: string;
  processed_at: string | null;
}

export interface AiWorkflow {
  id: string;
  slug: string;
  name: string;
  description: string;
  event_type: string;
  enabled: boolean;
  definition: Array<{ agent_slug: string; task_type: string }>;
}

export interface AiAuditEntry {
  id: string;
  action: string;
  agent_id: string | null;
  agent_slug?: string;
  user_id: string | null;
  tool: string | null;
  decision: string | null;
  status: string;
  error_code: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface AiModelConfig {
  engine: string;
  provider: string | null;
  model: string | null;
  endpoint: string | null;
  enabled: boolean;
  notes: string | null;
}

export interface AiKnowledgeSource {
  id: string;
  title: string;
  source_type: string;
  version: string;
  status: string;
  created_at: string;
}

export interface AiKnowledgeSearchResult {
  content: string;
  citation: { source: string; version: string };
  score: number;
}

export interface BoardSeatView {
  slug: string;
  name: string;
  seat: string;
  enabled: boolean;
  status: string;
  latestDigest: { seat?: string; headline?: string; producedAt: string } | null;
}

export interface BoardOverview {
  seats: BoardSeatView[];
  pendingApprovals: number;
  openHighSeverityFindings: number;
  note: string;
}

export interface BriefingSection {
  seat: string;
  headline: string;
  bullets: string[];
  metrics: Record<string, unknown>;
}

export interface ExecutiveReport {
  id: string;
  report_type: 'daily' | 'weekly' | 'monthly' | 'adhoc';
  status: string;
  period_start: string;
  period_end: string;
  sections: BriefingSection[];
  metrics: Record<string, unknown>;
  presentation: string | null;
  finding_ids?: string[];
  created_at: string;
}

export interface OverviewResponse {
  summary: {
    totals: {
      agents: number;
      enabledAgents: number;
      tasks: number;
      runs: number;
      toolCalls: number;
      failedRuns: number;
      findingsOpen: number;
      approvalsPending: number;
      eventsUnprocessed: number;
      incidentsOpen: number;
      knowledgeSources: number;
      knowledgeChunks: number;
    };
    perAgent: Array<{
      agentId: string;
      slug: string;
      name: string;
      category: string;
      runs: number;
      succeeded: number;
      failed: number;
      awaitingApproval: number;
      toolCalls: number;
      failedToolCalls: number;
      avgDurationMs: number | null;
      findings: number;
      pendingApprovals: number;
    }>;
    recentErrors: Array<{ id: string; agent: string; action: string; errorCode: string | null; createdAt: string }>;
  };
  pendingApprovals: number;
  boardSeats: number;
}

export interface CopilotResponse {
  taskId: string;
  runStatus: string;
  answer: string;
  intent: string | null;
  supportedCommands: string[] | null;
  pendingApprovals: string[];
  note: string;
}

export interface TaskDispatchResponse {
  task: AiTask;
  runStatus: string;
  pendingApprovals: string[];
}

export interface BriefingGenerateResponse {
  report: ExecutiveReport;
  created: boolean;
  taskId: string;
}

export interface AssistantResponse {
  answer: string;
  intent: string | null;
  taskId: string;
  supported: string[] | null;
  note: string;
}

export interface AiActivityResponse {
  tasks: Array<Record<string, unknown>>;
  findings: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  customerId: string;
}

// -------------------------------------------------------------------------------------------------
// Admin endpoints
// -------------------------------------------------------------------------------------------------

export const aiOsApi = {
  overview: () => apiFetch<OverviewResponse>(`${ADMIN}/overview`),

  observability: () => apiFetch<Record<string, unknown>>(`${ADMIN}/observability`),

  listAgents: (opts: { boardOnly?: boolean; category?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.boardOnly) q.set('boardOnly', 'true');
    if (opts.category) q.set('category', opts.category);
    const suffix = q.toString();
    return apiFetch<{ count: number; agents: AiAgent[] }>(`${ADMIN}/agents${suffix ? `?${suffix}` : ''}`);
  },

  setAgentEnabled: (id: string, enabled: boolean) =>
    apiFetch<TaskDispatchResponse | { task: AiTask }>(`${ADMIN}/agents/${id}/enabled`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),

  listTasks: (opts: { status?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.status) q.set('status', opts.status);
    if (opts.limit) q.set('limit', String(opts.limit));
    const suffix = q.toString();
    return apiFetch<{ count: number; tasks: AiTask[] }>(`${ADMIN}/tasks${suffix ? `?${suffix}` : ''}`);
  },

  dispatchTask: (body: { agentSlug: string; taskType: string; input?: Record<string, unknown>; priority?: string }) =>
    apiFetch<TaskDispatchResponse>(`${ADMIN}/tasks`, { method: 'POST', body: JSON.stringify(body) }),

  listApprovals: (status = 'pending') =>
    apiFetch<{ count: number; approvals: AiApproval[] }>(`${ADMIN}/approvals?status=${encodeURIComponent(status)}&limit=100`),

  decideApproval: (id: string, decision: 'approved' | 'rejected', note?: string) =>
    apiFetch<{ approval: AiApproval; executed: boolean; executionError: string | null }>(
      `${ADMIN}/approvals/${id}/decision`,
      { method: 'POST', body: JSON.stringify({ decision, ...(note ? { note } : {}) }) }
    ),

  listFindings: (opts: { status?: string; severity?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.status) q.set('status', opts.status);
    if (opts.severity) q.set('severity', opts.severity);
    const suffix = q.toString();
    return apiFetch<{ count: number; findings: AiFinding[] }>(`${ADMIN}/findings${suffix ? `?${suffix}` : ''}`);
  },

  listIncidents: () => apiFetch<{ count: number; incidents: AiIncident[] }>(`${ADMIN}/incidents`),

  createIncident: (body: { title: string; severity: 'low' | 'medium' | 'high' | 'critical'; summary: string }) =>
    apiFetch<{ incident: AiIncident }>(`${ADMIN}/incidents`, { method: 'POST', body: JSON.stringify(body) }),

  addIncidentNote: (id: string, note: string, status?: string) =>
    apiFetch<{ incident: AiIncident }>(`${ADMIN}/incidents/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note, ...(status ? { status } : {}) }),
    }),

  listEvents: (limit = 100) =>
    apiFetch<{ count: number; events: AiEventRow[]; knownTypes: string[] }>(`${ADMIN}/events?limit=${limit}`),

  listWorkflows: () => apiFetch<{ count: number; workflows: AiWorkflow[] }>(`${ADMIN}/workflows`),

  listAudit: (limit = 100) => apiFetch<{ count: number; entries: AiAuditEntry[] }>(`${ADMIN}/audit?limit=${limit}`),

  listModels: () => apiFetch<{ count: number; models: AiModelConfig[]; note: string }>(`${ADMIN}/models`),

  updateModel: (engine: string, body: { enabled: boolean; provider?: string | null; model?: string | null; endpoint?: string | null; notes?: string | null }) =>
    apiFetch<{ config: AiModelConfig }>(`${ADMIN}/models/${engine}`, { method: 'PUT', body: JSON.stringify(body) }),

  getBoard: () => apiFetch<BoardOverview>(`${ADMIN}/board`),

  generateBriefing: (type: 'daily' | 'weekly' | 'monthly') =>
    apiFetch<BriefingGenerateResponse>(`${ADMIN}/board/briefings`, { method: 'POST', body: JSON.stringify({ type }) }),

  listBriefings: () => apiFetch<{ count: number; reports: ExecutiveReport[] }>(`${ADMIN}/board/briefings`),

  getBriefing: (id: string) => apiFetch<{ report: ExecutiveReport }>(`${ADMIN}/board/briefings/${id}`),

  copilot: (command: string) => apiFetch<CopilotResponse>(`${ADMIN}/copilot`, { method: 'POST', body: JSON.stringify({ command }) }),

  listKnowledge: () => apiFetch<{ count: number; sources: AiKnowledgeSource[] }>(`${ADMIN}/knowledge`),

  createKnowledge: (body: { title: string; sourceType: string; content: string; keywords?: string[] }) =>
    apiFetch<{ source: AiKnowledgeSource }>(`${ADMIN}/knowledge`, { method: 'POST', body: JSON.stringify(body) }),

  searchKnowledge: (q: string) =>
    apiFetch<{ count: number; results: AiKnowledgeSearchResult[] }>(`${ADMIN}/knowledge/search?q=${encodeURIComponent(q)}`),
};

// -------------------------------------------------------------------------------------------------
// Customer endpoints (server-side scoped to the caller)
// -------------------------------------------------------------------------------------------------

export const aiCustomerApi = {
  ask: (message: string) => apiFetch<AssistantResponse>(`${ACCOUNT}/assistant`, { method: 'POST', body: JSON.stringify({ message }) }),

  activity: () => apiFetch<AiActivityResponse>(`${ACCOUNT}/activity`),

  profile: () => apiFetch<Record<string, unknown>>(`${ACCOUNT}/profile`),
};
