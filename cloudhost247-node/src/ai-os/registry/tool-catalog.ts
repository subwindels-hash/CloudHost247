/**
 * AI Tool Registry (spec §19).
 *
 * EVERY action any agent can perform is registered here with: description, input contract,
 * required agent permission, risk level, approval requirement and audit requirement. The
 * executor refuses any call for a tool missing from this catalog and independently verifies the
 * calling agent's registry row lists both the tool AND its permission — an agent can never
 * hard-code its own access.
 *
 * approval:
 *   'none'     — executes immediately (read-only or low-risk work products like drafts)
 *   'policy'   — executes immediately for agents with approval_policy=automatic, otherwise a
 *                Human Decision Inbox (approval) row gates execution
 *   'always'   — NEVER executes without an explicit human approval decision, regardless of
 *                the agent's own policy (spec §21 high-impact actions)
 */
import type { AiPermission } from '../permissions';
import type { RiskLevel } from '../types';

export interface ToolArgumentSpec {
  type: 'string' | 'uuid' | 'integer' | 'boolean' | 'date';
  required?: boolean;
  description: string;
  maxLength?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  permission: AiPermission;
  riskLevel: RiskLevel;
  approval: 'none' | 'policy' | 'always';
  mutating: boolean;
  /** True when the tool can run inside a customer workspace (customer assistant) — arguments are
   *  then forcibly scoped to the authenticated customer server-side. */
  customerUsable?: boolean;
  arguments: Record<string, ToolArgumentSpec>;
}

export const TOOL_CATALOG: readonly ToolDefinition[] = [
  // ---------------------------------------------------------------- reads: platform overview
  {
    name: 'get_platform_overview',
    description: 'Live counts and aggregates across customers, tickets, invoices, payments, servers, subscriptions and incidents. All values are read from the real platform tables at call time.',
    category: 'analytics',
    permission: 'ai.observability.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: {},
  },
  {
    name: 'get_customer',
    description: 'A single customer account (email, name, role, status, created date).',
    category: 'customer',
    permission: 'ai.customer.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: { userId: { type: 'uuid', required: true, description: 'Customer account id' } },
  },
  {
    name: 'get_customer_profile',
    description: 'Unified customer profile: real counts/totals of services, domains, orders, invoices, payments, subscriptions, tickets and AI activity for one customer. No inferred/fictional data.',
    category: 'customer',
    permission: 'ai.customer.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    customerUsable: true,
    arguments: { userId: { type: 'uuid', required: true, description: 'Customer account id' } },
  },

  // ---------------------------------------------------------------- reads: billing
  {
    name: 'list_overdue_invoices',
    description: 'Unpaid invoices whose due date has passed, oldest first, with the owning customer.',
    category: 'billing',
    permission: 'ai.billing.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: { limit: { type: 'integer', description: 'Max rows (default 25, max 100)' } },
  },
  {
    name: 'get_invoice',
    description: 'One invoice with its payments, from the billing tables. Amounts are exactly as stored — never recalculated or invented.',
    category: 'billing',
    permission: 'ai.billing.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    customerUsable: true,
    arguments: { invoiceId: { type: 'uuid', required: true, description: 'Invoice id' } },
  },
  {
    name: 'list_invoices',
    description: 'Invoices for a customer (or a status filter), newest first.',
    category: 'billing',
    permission: 'ai.billing.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    customerUsable: true,
    arguments: {
      userId: { type: 'uuid', description: 'Customer account id (omit for platform-wide status listing)' },
      status: { type: 'string', description: 'unpaid|paid|void|refunded|partially_refunded' },
      limit: { type: 'integer', description: 'Max rows (default 25, max 100)' },
    },
  },
  {
    name: 'list_failed_payments',
    description: 'Failed payment attempts in a lookback window, with the invoice/customer they belong to.',
    category: 'billing',
    permission: 'ai.billing.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: { days: { type: 'integer', description: 'Lookback window in days (default 1, max 90)' } },
  },
  {
    name: 'get_revenue_snapshot',
    description: 'Revenue strictly from real rows: paid invoice totals in 1/7/30-day windows, failed-payment counts and amounts, refund totals, active vs at-risk subscription counts. Methodology is returned alongside the numbers.',
    category: 'billing',
    permission: 'ai.billing.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: {},
  },
  {
    name: 'list_subscriptions',
    description: 'Subscriptions by lifecycle status (active, past_due, grace_period, suspended, cancellable-at-period-end). Inside a customer workspace it is forcibly scoped to that customer.',
    category: 'billing',
    permission: 'ai.billing.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    customerUsable: true,
    arguments: {
      status: { type: 'string', description: 'Optional status filter' },
      userId: { type: 'uuid', description: 'Scope to one customer' },
      limit: { type: 'integer', description: 'Max rows' },
    },
  },

  // ---------------------------------------------------------------- reads: support
  {
    name: 'list_open_tickets',
    description: 'Support tickets not yet closed, with age and priority, oldest first.',
    category: 'support',
    permission: 'ai.support.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: { limit: { type: 'integer', description: 'Max rows' } },
  },
  {
    name: 'get_ticket',
    description: 'One support ticket plus its message thread.',
    category: 'support',
    permission: 'ai.support.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    customerUsable: true,
    arguments: { ticketId: { type: 'uuid', required: true, description: 'Ticket id' } },
  },

  // ---------------------------------------------------------------- reads: infrastructure
  {
    name: 'list_server_health',
    description: 'Every non-retired server joined with its latest real telemetry row (CPU%, memory, disk, agent last-seen). Flags only thresholds crossed in the returned data — never invents a health state.',
    category: 'infrastructure',
    permission: 'ai.server.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: { limit: { type: 'integer', description: 'Max rows' } },
  },
  {
    name: 'get_server',
    description: 'One server plus its latest metrics rows and recent deployments.',
    category: 'infrastructure',
    permission: 'ai.server.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: { serverId: { type: 'uuid', required: true, description: 'Server id' } },
  },
  {
    name: 'list_stuck_deployments',
    description: 'Provisioning/deployment jobs that have been queued or running far beyond the platform threshold — the stuck-provisioning detector.',
    category: 'infrastructure',
    permission: 'ai.infrastructure.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: { minutes: { type: 'integer', description: 'Stuck threshold in minutes (default 60)' } },
  },
  {
    name: 'list_failed_deployments',
    description: 'Failed deployments in a lookback window with their recorded error codes — real failure facts only.',
    category: 'infrastructure',
    permission: 'ai.infrastructure.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: { days: { type: 'integer', description: 'Lookback window (default 1, max 30)' } },
  },
  {
    name: 'list_expiring_ssl',
    description: 'SSL certificates by real expiry timestamp (expired or expiring within the window).',
    category: 'infrastructure',
    permission: 'ai.infrastructure.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    customerUsable: true,
    arguments: { days: { type: 'integer', description: 'Window in days (default 30)' }, userId: { type: 'uuid', description: 'Scope to one customer' } },
  },
  {
    name: 'list_expiring_domains',
    description: 'Customer domains by real expiry date (expired or expiring within the window).',
    category: 'infrastructure',
    permission: 'ai.infrastructure.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    customerUsable: true,
    arguments: { days: { type: 'integer', description: 'Window in days (default 30)' }, userId: { type: 'uuid', description: 'Scope to one customer' } },
  },
  {
    name: 'list_auth_anomalies',
    description: 'Failed-login clusters from the real auth audit log: per-account and per-IP counts in a lookback window — input facts for security triage, not verdicts.',
    category: 'security',
    permission: 'ai.security.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: { hours: { type: 'integer', description: 'Lookback window in hours (default 24, max 168)' } },
  },

  // ---------------------------------------------------------------- reads: knowledge
  {
    name: 'search_knowledge',
    description: 'Searches the registered CloudHost247 knowledge base; returns chunks with their source document + version so every answer stays citation-traceable. Returns nothing (never an invented answer) when there is no matching chunk.',
    category: 'knowledge',
    permission: 'ai.knowledge.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    customerUsable: true,
    arguments: {
      query: { type: 'string', required: true, description: 'Search query', maxLength: 400 },
      limit: { type: 'integer', description: 'Max chunks (default 5, max 10)' },
    },
  },
  {
    name: 'list_incidents',
    description: 'AI incident register (open/investigating/mitigated first).',
    category: 'incident',
    permission: 'ai.incident.manage',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: { limit: { type: 'integer', description: 'Max rows' } },
  },
  {
    name: 'get_ai_activity',
    description: 'What the AI workforce did for one customer: tasks, findings and approvals touching them. Powers customer-facing AI transparency (/account/ai).',
    category: 'customer',
    permission: 'ai.customer.read',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    customerUsable: true,
    arguments: { userId: { type: 'uuid', required: true, description: 'Customer account id' }, limit: { type: 'integer', description: 'Max rows per section' } },
  },

  // ---------------------------------------------------------------- writes: support / comms
  {
    name: 'create_ticket',
    description: 'Opens a real support ticket (with first message) for a customer — used when an agent must hand work to humans.',
    category: 'support',
    permission: 'ai.support.write',
    riskLevel: 'medium',
    approval: 'policy',
    mutating: true,
    customerUsable: true,
    arguments: {
      userId: { type: 'uuid', required: true, description: 'Ticket owner (customer account id)' },
      subject: { type: 'string', required: true, description: 'Ticket subject', maxLength: 255 },
      body: { type: 'string', required: true, description: 'First message body', maxLength: 10000 },
      priority: { type: 'string', description: 'low|normal|high (default normal)' },
    },
  },
  {
    name: 'send_notification',
    description: 'Delivers a real in-app notification to a customer AND queues its email copy through the platform notification outbox (idempotent per type+resource). The message must be fully specified by the caller — the tool never invents customer-facing content.',
    category: 'support',
    permission: 'ai.support.write',
    riskLevel: 'high',
    approval: 'always',
    mutating: true,
    arguments: {
      userId: { type: 'uuid', required: true, description: 'Recipient customer account id' },
      type: { type: 'string', required: true, description: 'Notification type slug (e.g. AI_COLLECTIONS_REMINDER)', maxLength: 48 },
      title: { type: 'string', required: true, description: 'Notification title', maxLength: 255 },
      message: { type: 'string', required: true, description: 'Fully-composed message text', maxLength: 10000 },
      resourceType: { type: 'string', description: 'Optional resource type for idempotency', maxLength: 48 },
      resourceId: { type: 'uuid', description: 'Optional resource id for idempotency' },
    },
  },
  {
    name: 'acknowledge_ticket',
    description: "Sets a support ticket's status (pending_staff / pending_customer / closed) — the only ticket mutation agents may perform directly. Resolved-status claims still belong to humans.",
    category: 'support',
    permission: 'ai.support.write',
    riskLevel: 'medium',
    approval: 'policy',
    mutating: true,
    arguments: {
      ticketId: { type: 'uuid', required: true, description: 'Ticket id' },
      status: { type: 'string', required: true, description: 'pending_staff|pending_customer|closed' },
    },
  },

  // ---------------------------------------------------------------- writes: incidents
  {
    name: 'create_incident',
    description: 'Creates a real AI incident from correlated findings/events. Also emits incident.created onto the AI event bus.',
    category: 'incident',
    permission: 'ai.incident.manage',
    riskLevel: 'medium',
    approval: 'policy',
    mutating: true,
    arguments: {
      title: { type: 'string', required: true, description: 'Incident title', maxLength: 255 },
      severity: { type: 'string', required: true, description: 'low|medium|high|critical' },
      summary: { type: 'string', required: true, description: 'What is known, with evidence — no speculation stated as fact', maxLength: 10000 },
    },
  },
  {
    name: 'update_incident',
    description: 'Appends a timeline entry and optionally changes incident status. Resolving is approval-gated at the policy level because it closes customer-impacting records.',
    category: 'incident',
    permission: 'ai.incident.manage',
    riskLevel: 'medium',
    approval: 'policy',
    mutating: true,
    arguments: {
      incidentId: { type: 'uuid', required: true, description: 'Incident id' },
      status: { type: 'string', description: 'open|investigating|mitigated|resolved' },
      note: { type: 'string', required: true, description: 'Timeline note with evidence', maxLength: 5000 },
    },
  },

  // ---------------------------------------------------------------- writes: infrastructure execution (destructive)
  {
    name: 'restart_installation',
    description: 'Enqueues a REAL restart deployment for a customer application installation via the platform deployment engine (same queue the dunning sweeps use). High-risk: always approval-gated. Execution is asynchronous — success is only claimed after the deployment row reports it.',
    category: 'infrastructure',
    permission: 'ai.infrastructure.execute',
    riskLevel: 'high',
    approval: 'always',
    mutating: true,
    arguments: {
      installationId: { type: 'uuid', required: true, description: 'Application installation id' },
      reason: { type: 'string', required: true, description: 'Why this restart is needed (evidence-based)', maxLength: 2000 },
    },
  },
  {
    name: 'suspend_installation',
    description: 'Enqueues a REAL suspend deployment for an installation. Critical/destructive: always approval-gated.',
    category: 'infrastructure',
    permission: 'ai.infrastructure.execute',
    riskLevel: 'critical',
    approval: 'always',
    mutating: true,
    arguments: {
      installationId: { type: 'uuid', required: true, description: 'Application installation id' },
      reason: { type: 'string', required: true, description: 'Why suspension is required (evidence-based)', maxLength: 2000 },
    },
  },

  // ---------------------------------------------------------------- writes: work products (non-destructive)
  {
    name: 'draft_customer_message',
    description: 'Produces a reviewed draft (subject+body) grounded in cited real records. A draft is stored as task output only — nothing is sent. Sending always goes through send_notification with its own human approval.',
    category: 'marketing',
    permission: 'ai.marketing.draft',
    riskLevel: 'low',
    approval: 'none',
    mutating: false,
    arguments: {
      purpose: { type: 'string', required: true, description: 'What the message is for', maxLength: 400 },
      facts: { type: 'string', required: true, description: 'Grounding facts (from real records) to include', maxLength: 4000 },
      tone: { type: 'string', description: 'friendly|formal (default friendly)' },
    },
  },
  {
    name: 'set_agent_enabled',
    description: 'Enables or disables an agent in the registry. Governance change — always approval-gated.',
    category: 'copilot',
    permission: 'ai.admin.execute',
    riskLevel: 'high',
    approval: 'always',
    mutating: true,
    arguments: {
      agentSlug: { type: 'string', required: true, description: 'Agent slug', maxLength: 64 },
      enabled: { type: 'boolean', required: true, description: 'Target state' },
    },
  },
  {
    name: 'record_evaluation',
    description: 'Records a measurable evaluation signal for an agent (accuracy, false positive, hallucination report, rating…). Staff feedback loop for spec §31.',
    category: 'analytics',
    permission: 'ai.admin.execute',
    riskLevel: 'low',
    approval: 'none',
    mutating: true,
    customerUsable: false,
    arguments: {
      metric: { type: 'string', required: true, description: 'Metric slug', maxLength: 40 },
      value: { type: 'integer', required: true, description: 'Numeric value (e.g. rating 1-5, count)' },
      notes: { type: 'string', description: 'Optional notes', maxLength: 2000 },
    },
  },
];

const BY_NAME = new Map(TOOL_CATALOG.map((t) => [t.name, t]));

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

/** Validates raw arguments against the tool contract. Throws with a human-readable message. */
export function validateToolArguments(tool: ToolDefinition, args: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(tool.arguments)) {
    const raw = args?.[key];
    if (raw === undefined || raw === null) {
      if (spec.required) throw new Error(`Missing required argument '${key}' (${spec.description})`);
      continue;
    }
    switch (spec.type) {
      case 'string': {
        if (typeof raw !== 'string') throw new Error(`Argument '${key}' must be a string`);
        const value = raw.trim();
        if (spec.required && value.length === 0) throw new Error(`Argument '${key}' must not be empty`);
        const max = spec.maxLength ?? 4000;
        cleaned[key] = value.slice(0, max);
        break;
      }
      case 'uuid': {
        if (typeof raw !== 'string' || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(raw.trim())) {
          throw new Error(`Argument '${key}' must be a UUID`);
        }
        cleaned[key] = raw.trim();
        break;
      }
      case 'integer': {
        const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
        if (!Number.isFinite(n)) throw new Error(`Argument '${key}' must be an integer`);
        cleaned[key] = Math.max(0, Math.min(10000, Math.trunc(n)));
        break;
      }
      case 'boolean': {
        if (typeof raw === 'boolean') cleaned[key] = raw;
        else if (raw === 'true' || raw === 'false') cleaned[key] = raw === 'true';
        else throw new Error(`Argument '${key}' must be a boolean`);
        break;
      }
      case 'date': {
        if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) throw new Error(`Argument '${key}' must be a date string`);
        cleaned[key] = raw.trim();
        break;
      }
    }
  }
  return cleaned;
}

/**
 * REDACTION (spec §22): arguments/results are stripped of anything that looks like a secret
 * before they are persisted to audit/tool-call storage, and truncated. Deterministic and total —
 * agents never see the redacted copy, only the store does.
 */
const SECRET_KEY = /secret|password|passwd|token|api[_-]?key|authorization|credential|private[_-]?key/i;

export function redactForStorage(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactForStorage(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : redactForStorage(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}
