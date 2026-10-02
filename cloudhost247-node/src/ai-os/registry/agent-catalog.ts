/**
 * AI Agent Registry — canonical catalog (spec §2–§17, §18).
 *
 * Every agent in the CloudHost247 AI workforce is declared here ONCE and seeded into the
 * ai_agents table by src/ai-os/registry/seed.ts (DB is the runtime authority for
 * enabled/status; this file is the authority for identity, tool grants and task types —
 * consistency is enforced by tests/integration/ai-control-plane.test.ts).
 *
 * Deliberately EXCLUDED (spec §35 — domain-mismatched generic agents): Care Navigator, Claims
 * Copilot, Intake Attorney, Citizen Desk, Tutor, Dispatch. They do not belong to a
 * hosting/cloud platform.
 *
 * Permissions here are AGENT permissions (§20 vocabulary). An agent whose tool's permission is
 * absent from this list is denied by the executor — agents cannot hard-code their own access.
 */
import type { AiPermission } from '../permissions';
import type { AgentCategory, RiskLevel } from '../types';

export interface AgentCatalogEntry {
  slug: string;
  name: string;
  category: AgentCategory;
  /** Executive Board seat (§2) — null for workforce agents. */
  boardSeat?: string;
  description: string;
  modelTier: 'native';
  riskLevel: RiskLevel;
  permissions: readonly AiPermission[];
  tools: readonly string[];
  taskTypes: readonly string[];
  approvalPolicy: 'automatic' | 'standard' | 'strict';
}

const READ_CUSTOMER: readonly AiPermission[] = ['ai.customer.read'];
const READ_BILLING: readonly AiPermission[] = ['ai.billing.read'];
const READ_SUPPORT: readonly AiPermission[] = ['ai.support.read'];
const READ_SERVER: readonly AiPermission[] = ['ai.server.read'];
const READ_INFRA: readonly AiPermission[] = ['ai.infrastructure.read'];
const READ_SECURITY: readonly AiPermission[] = ['ai.security.read'];
const READ_KB: readonly AiPermission[] = ['ai.knowledge.read'];
const READ_OBS: readonly AiPermission[] = ['ai.observability.read'];

export const AGENT_CATALOG: readonly AgentCatalogEntry[] = [
  // ============================================================== §2 — Executive Board
  {
    slug: 'ai-ceo',
    name: 'AI CEO — Chief Executive Agent',
    category: 'executive',
    boardSeat: 'CEO',
    description:
      'Coordinates the AI Executive Board and produces executive briefings by aggregating the other board seats\' own findings. Never concludes on another department\'s behalf: the CEO synthesis is an aggregation of cited findings plus platform metrics, never a fabrication of departmental conclusions.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_OBS, ...READ_BILLING, ...READ_SUPPORT, ...READ_SERVER, ...READ_SECURITY, 'ai.incident.manage', 'ai.knowledge.read'],
    tools: ['get_platform_overview', 'get_revenue_snapshot', 'list_incidents', 'search_knowledge'],
    taskTypes: ['board.executive_briefing'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'ai-coo',
    name: 'AI COO — Operations Director',
    category: 'executive',
    boardSeat: 'COO',
    description: 'Operational digest: support backlog, stuck provisioning, failed deployments, server estate status and open incidents — strictly from live operational tables.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_SUPPORT, ...READ_SERVER, ...READ_INFRA, ...READ_OBS, 'ai.incident.manage'],
    tools: ['get_platform_overview', 'list_open_tickets', 'list_server_health', 'list_stuck_deployments', 'list_failed_deployments', 'list_incidents'],
    taskTypes: ['board.department_digest'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'ai-cfo',
    name: 'AI CFO — Finance Director',
    category: 'executive',
    boardSeat: 'CFO',
    description: 'Financial digest: revenue snapshots, overdue invoices, failed payments and subscription state from the real billing tables. Financial actions are never executed by the CFO seat — they enter the approval workflow.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_BILLING, ...READ_OBS],
    tools: ['get_platform_overview', 'get_revenue_snapshot', 'list_overdue_invoices', 'list_failed_payments', 'list_subscriptions'],
    taskTypes: ['board.department_digest'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'ai-cto',
    name: 'AI CTO — Technology Director',
    category: 'executive',
    boardSeat: 'CTO',
    description: 'Technology digest: server estate health, deployment reliability and capacity signals from real telemetry and deployment records.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_SERVER, ...READ_INFRA, ...READ_OBS],
    tools: ['get_platform_overview', 'list_server_health', 'list_stuck_deployments', 'list_failed_deployments'],
    taskTypes: ['board.department_digest'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'ai-ciso',
    name: 'AI CISO — Security Director',
    category: 'executive',
    boardSeat: 'CISO',
    description: 'Security digest: authentication anomalies from the auth audit log and open security findings. Detection → evidence → risk classification — never automatic lockouts.',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_SECURITY, ...READ_OBS, 'ai.incident.manage'],
    tools: ['get_platform_overview', 'list_auth_anomalies', 'list_incidents'],
    taskTypes: ['board.department_digest', 'security.digest'],
    approvalPolicy: 'standard',
  },
  {
    slug: 'ai-cro',
    name: 'AI CRO — Revenue & Growth Director',
    category: 'executive',
    boardSeat: 'CRO',
    description: 'Growth digest: orders, revenue windows, subscription lifecycle and churn signals from real billing/subscription data.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_BILLING, ...READ_OBS],
    tools: ['get_platform_overview', 'get_revenue_snapshot', 'list_subscriptions'],
    taskTypes: ['board.department_digest'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'ai-cmo',
    name: 'AI CMO — Marketing Director',
    category: 'executive',
    boardSeat: 'CMO',
    description: 'Marketing digest: customer-base composition and segment counts from real customer/subscription data. Campaign execution stays out of scope; drafts only.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_CUSTOMER, ...READ_BILLING, 'ai.observability.read', 'ai.marketing.draft'],
    tools: ['get_platform_overview', 'list_subscriptions', 'draft_customer_message'],
    taskTypes: ['board.department_digest'],
    approvalPolicy: 'standard',
  },
  {
    slug: 'ai-cco',
    name: 'AI Chief Customer Officer',
    category: 'executive',
    boardSeat: 'CCO',
    description: 'Customer-experience digest: support queue pressure, escalated conversations and ticket trends from the real support tables.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_SUPPORT, ...READ_CUSTOMER, ...READ_OBS],
    tools: ['get_platform_overview', 'list_open_tickets'],
    taskTypes: ['board.department_digest'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'ai-cpo',
    name: 'AI Chief Product Officer',
    category: 'executive',
    boardSeat: 'CPO',
    description: 'Product digest: catalog adoption inferred strictly from real subscriptions/services per plan — no invented demand signals.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_BILLING, ...READ_OBS, 'ai.catalog.read'],
    tools: ['get_platform_overview', 'list_subscriptions'],
    taskTypes: ['board.department_digest'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'ai-risk',
    name: 'AI Chief Risk & Compliance Officer',
    category: 'executive',
    boardSeat: 'RISK',
    description: 'Risk digest: pending high-risk approvals, open critical findings, overdue invoices concentration and AI governance state (disabled agents, unconfigured model engines).',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_OBS, ...READ_BILLING, ...READ_SECURITY, 'ai.incident.manage'],
    tools: ['get_platform_overview', 'list_overdue_invoices', 'list_auth_anomalies', 'list_incidents'],
    taskTypes: ['board.department_digest'],
    approvalPolicy: 'standard',
  },

  // ============================================================== §3 — Support
  {
    slug: 'resolution-pro',
    name: 'Resolution Pro — Customer Support Agent',
    category: 'support',
    description:
      'Reads support tickets, searches the knowledge base, inspects permitted account data and drafts grounded responses — or escalates when the evidence is insufficient. Never invents a diagnosis: every answer cites the records/knowledge it used, and uncertainty triggers escalation instead of a guess.',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_SUPPORT, ...READ_CUSTOMER, ...READ_BILLING, ...READ_KB, 'ai.support.write'],
    tools: ['get_ticket', 'list_open_tickets', 'get_customer_profile', 'list_invoices', 'search_knowledge', 'acknowledge_ticket', 'create_ticket'],
    taskTypes: ['support.ticket_triage'],
    approvalPolicy: 'standard',
  },

  // ============================================================== §4 — Infrastructure operations
  {
    slug: 'infrastructure-guardian',
    name: 'Infrastructure Guardian',
    category: 'infrastructure',
    description:
      'Watches the server estate against real telemetry: CPU/memory/disk saturation, offline agents, dead containers. Detects anomalies with cited metric rows; remediation beyond the read/draft layer requires human approval.',
    modelTier: 'native',
    riskLevel: 'high',
    permissions: [...READ_SERVER, ...READ_INFRA],
    tools: ['list_server_health', 'get_server', 'list_stuck_deployments', 'list_failed_deployments'],
    taskTypes: ['infrastructure.health_scan'],
    approvalPolicy: 'standard',
  },
  {
    slug: 'server-health-agent',
    name: 'Server Health Agent',
    category: 'infrastructure',
    description: 'Per-server health reports in the Status/Problem/Evidence/Impact/Recommended action format, grounded in the latest real metrics for that exact server.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_SERVER],
    tools: ['get_server'],
    taskTypes: ['infrastructure.server_report'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'provisioning-agent',
    name: 'Provisioning Agent',
    category: 'infrastructure',
    description: 'Monitors provisioning flows: finds stuck/failed deployment jobs (new-server provisioning, activation) and reports them with the recorded platform error codes.',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_INFRA],
    tools: ['list_stuck_deployments', 'list_failed_deployments'],
    taskTypes: ['provisioning.stuck_scan'],
    approvalPolicy: 'standard',
  },
  {
    slug: 'deployment-agent',
    name: 'Deployment Agent',
    category: 'infrastructure',
    description: 'Deployment health: failed rollouts, error-code clustering and rollback candidates — from the real deployment queue. Rollback execution is approval-gated by policy.',
    modelTier: 'native',
    riskLevel: 'high',
    permissions: [...READ_INFRA, 'ai.infrastructure.execute'],
    tools: ['list_failed_deployments', 'list_stuck_deployments', 'restart_installation'],
    taskTypes: ['deployment.failure_digest'],
    approvalPolicy: 'strict',
  },
  {
    slug: 'dns-domain-agent',
    name: 'DNS & Domain Agent',
    category: 'infrastructure',
    description: 'Domain lifecycle watch: real expiry dates, pending transfers and expiring registrations — input facts for renewal warnings and domain support.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_INFRA, ...READ_CUSTOMER],
    tools: ['list_expiring_domains', 'get_customer_profile'],
    taskTypes: ['domain.expiry_scan'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'ssl-guardian',
    name: 'SSL/TLS Guardian',
    category: 'infrastructure',
    description: 'Certificate watch: real expiry timestamps, failed issuances and pending validations; raises findings ahead of expiration instead of letting certificates lapse silently.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_INFRA],
    tools: ['list_expiring_ssl'],
    taskTypes: ['ssl.expiry_scan'],
    approvalPolicy: 'automatic',
  },

  // ============================================================== §5 — Security
  {
    slug: 'security-sentinel',
    name: 'Security Sentinel',
    category: 'security',
    description:
      'Detects suspicious authentication from the real auth audit log: failure clusters per account/IP, and raises classified findings with evidence. Sentinel NEVER locks an account by itself — policy evaluation and any containment need human approval.',
    modelTier: 'native',
    riskLevel: 'high',
    permissions: [...READ_SECURITY, ...READ_CUSTOMER],
    tools: ['list_auth_anomalies', 'get_customer'],
    taskTypes: ['security.auth_anomaly_scan'],
    approvalPolicy: 'strict',
  },
  {
    slug: 'fraud-guardian',
    name: 'Fraud & Abuse Guardian',
    category: 'security',
    description: 'Reviews real ordering/payment patterns (failed-payment bursts, unpaid-order accumulation) and flags accounts FOR REVIEW. It never bans or suspends: every flagged case is a finding for humans.',
    modelTier: 'native',
    riskLevel: 'high',
    permissions: [...READ_BILLING, ...READ_CUSTOMER],
    tools: ['list_failed_payments', 'list_overdue_invoices', 'get_customer_profile'],
    taskTypes: ['fraud.order_anomaly_scan'],
    approvalPolicy: 'strict',
  },
  {
    slug: 'vulnerability-analyst',
    name: 'Vulnerability Analyst',
    category: 'security',
    description: 'Dependency/known-vulnerability assessment. Fail-closed by design: without a configured scanner integration it reports CONFIGURATION_REQUIRED with exactly what must be connected — it never invents a CVE list.',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_SECURITY],
    tools: [],
    taskTypes: ['vulnerability.assessment'],
    approvalPolicy: 'standard',
  },

  // ============================================================== §6 — Billing & finance
  {
    slug: 'ledger',
    name: 'Ledger — Billing Agent',
    category: 'billing',
    description: 'Answers invoice/payment/subscription questions by reading the real billing records. Never invents amounts: every figure is the stored value of a cited invoice/payment/ledger row.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_BILLING, ...READ_CUSTOMER, ...READ_KB],
    tools: ['get_invoice', 'list_invoices', 'list_subscriptions', 'get_customer_profile', 'search_knowledge'],
    taskTypes: ['billing.invoice_explain'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'collector',
    name: 'Collections Agent',
    category: 'billing',
    description:
      'Finds overdue invoices and prepares factual, customer-friendly reminder drafts grounded in the real invoice rows. Nothing is sent without a human approval (send_notification is always approval-gated) — no harassment, no misleading content.',
    modelTier: 'native',
    riskLevel: 'high',
    permissions: [...READ_BILLING, ...READ_CUSTOMER, 'ai.marketing.draft', 'ai.support.write'],
    tools: ['list_overdue_invoices', 'get_customer', 'draft_customer_message', 'send_notification'],
    taskTypes: ['billing.overdue_digest'],
    approvalPolicy: 'standard',
  },
  {
    slug: 'revenue-analyst',
    name: 'Revenue Analyst',
    category: 'billing',
    description: 'Revenue snapshots (1/7/30-day paid totals), failed-payment impact and subscription lifecycle distribution — with the methodology stated beside every figure.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_BILLING],
    tools: ['get_revenue_snapshot', 'list_subscriptions', 'list_failed_payments'],
    taskTypes: ['finance.revenue_summary'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'reconciliation-agent',
    name: 'Billing Reconciliation Agent',
    category: 'billing',
    description: 'Cross-checks orders/invoices/payments for gaps: paid invoices missing successful payment rows, failed attempts on paid invoices, unpaid invoices with successful payments. Reports discrepancies with cited row ids.',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_BILLING],
    tools: ['list_invoices', 'list_failed_payments', 'get_revenue_snapshot'],
    taskTypes: ['finance.reconciliation_digest'],
    approvalPolicy: 'standard',
  },
  {
    slug: 'pricing-analyst',
    name: 'Pricing Analyst',
    category: 'billing',
    description: 'Observes real product demand (active subscriptions per plan, churn per plan) and drafts pricing observations. It MAY NOT change prices — recommendations only.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_BILLING, 'ai.catalog.read'],
    tools: ['list_subscriptions', 'get_revenue_snapshot'],
    taskTypes: ['finance.pricing_observations'],
    approvalPolicy: 'automatic',
  },

  // ============================================================== §7 — Sales
  {
    slug: 'pipeline',
    name: 'Pipeline — Sales Agent',
    category: 'sales',
    description: 'Pipeline view from real signals: unpaid first orders, pending orders and new customers in the window. Lead scoring stays factual (which real signals exist), never a fabricated probability.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_BILLING, ...READ_CUSTOMER],
    tools: ['list_invoices', 'get_customer_profile'],
    taskTypes: ['sales.pipeline_digest'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'account-expansion',
    name: 'Account Expansion Agent',
    category: 'sales',
    description: 'Finds expansion opportunities strictly from real usage/lifecycle data: multiple active services, subscriptions approaching period end, customers with many domains. Each suggestion cites the actual record that triggered it.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_CUSTOMER, ...READ_BILLING, 'ai.observability.read'],
    tools: ['get_customer_profile', 'list_subscriptions', 'get_platform_overview'],
    taskTypes: ['sales.expansion_opportunities'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'retention-agent',
    name: 'Customer Retention Agent',
    category: 'sales',
    description: 'Churn-signal watch: cancel-at-period-end flags, past-due/suspended subscriptions and customers with failed payments — real signals only, with recommended retention actions for humans.',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_BILLING, ...READ_CUSTOMER, ...READ_SUPPORT],
    tools: ['list_subscriptions', 'list_failed_payments', 'list_open_tickets', 'get_customer_profile'],
    taskTypes: ['sales.retention_scan'],
    approvalPolicy: 'standard',
  },

  // ============================================================== §8 — Marketing
  {
    slug: 'campaigner',
    name: 'Campaigner — Marketing Agent',
    category: 'marketing',
    description: 'Segment digests from real customer/subscription composition plus draft campaign briefs. Publication is outside its authority: drafts are work products for humans.',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_CUSTOMER, ...READ_BILLING, 'ai.marketing.draft', 'ai.observability.read'],
    tools: ['list_subscriptions', 'get_platform_overview', 'draft_customer_message'],
    taskTypes: ['marketing.segment_digest'],
    approvalPolicy: 'standard',
  },
  {
    slug: 'content-agent',
    name: 'Content Agent',
    category: 'marketing',
    description: 'Drafts knowledge-base articles, FAQs and announcements grounded in supplied facts and existing knowledge chunks. Human review is mandatory before publication; the agent stores drafts as task output only.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_KB, 'ai.marketing.draft'],
    tools: ['search_knowledge', 'draft_customer_message'],
    taskTypes: ['content.draft'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'seo-intelligence',
    name: 'SEO Intelligence Agent',
    category: 'marketing',
    description: 'Content-gap analysis: compares real support-ticket subjects against knowledge-base coverage and lists question themes without documented answers.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_SUPPORT, ...READ_KB],
    tools: ['list_open_tickets', 'search_knowledge'],
    taskTypes: ['seo.gap_digest'],
    approvalPolicy: 'automatic',
  },

  // ============================================================== §9 — Customer intelligence
  {
    slug: 'customer-intelligence',
    name: 'Customer Intelligence Agent',
    category: 'customer',
    description:
      'Builds the unified customer profile from authorized real data (services, domains, orders, invoices, payments, subscriptions, tickets) and computes a health score whose factors are enumerated and explainable — never an opaque label.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_CUSTOMER, ...READ_BILLING, ...READ_SUPPORT],
    tools: ['get_customer_profile', 'list_invoices', 'list_subscriptions', 'get_ticket', 'get_ai_activity'],
    taskTypes: ['customer.profile'],
    approvalPolicy: 'automatic',
  },
  {
    slug: 'customer-success',
    name: 'Customer Success Agent',
    category: 'customer',
    description: 'Onboarding/renewal watch and follow-up suggestions: customers with expiring domains/SSL or upcoming subscription renewals, grounded in real dates.',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_CUSTOMER, ...READ_BILLING, ...READ_INFRA, 'ai.support.write'],
    tools: ['get_customer_profile', 'list_subscriptions', 'list_expiring_domains', 'list_expiring_ssl', 'send_notification'],
    taskTypes: ['customer.success_digest'],
    approvalPolicy: 'standard',
  },

  // ============================================================== §10 — Knowledge
  {
    slug: 'knowledge-agent',
    name: 'CloudHost247 Knowledge Agent',
    category: 'knowledge',
    description: 'The centralized knowledge brain: answers only from registered knowledge chunks and returns citations (source document + version) for every answer. No matching chunk → explicit "not documented" — never an invented answer.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_KB],
    tools: ['search_knowledge'],
    taskTypes: ['knowledge.answer'],
    approvalPolicy: 'automatic',
  },

  // ============================================================== §11 — Internal operations (internal-only modules)
  {
    slug: 'internal-it',
    name: 'Internal IT Agent',
    category: 'internal',
    description: 'Internal employee IT support routing. Fail-closed: without an internal directory/ticketing integration it reports CONFIGURATION_REQUIRED instead of pretending to file internal requests.',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_KB],
    tools: ['search_knowledge'],
    taskTypes: ['internal.request'],
    approvalPolicy: 'standard',
  },
  {
    slug: 'hr-assistant',
    name: 'HR Assistant',
    category: 'internal',
    description: 'HR policy lookup for staff (internal module). Answers only from registered policy chunks; makes no employment decisions, ever.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_KB],
    tools: ['search_knowledge'],
    taskTypes: ['internal.request'],
    approvalPolicy: 'standard',
  },
  {
    slug: 'recruitment-assistant',
    name: 'Recruitment Assistant',
    category: 'internal',
    description: 'Candidate-workflow organizer for CloudHost247 hiring (internal module). Fail-closed without an ATS integration; never rejects candidates automatically.',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_KB],
    tools: ['search_knowledge'],
    taskTypes: ['internal.request'],
    approvalPolicy: 'standard',
  },

  // ============================================================== §12 — Assets
  {
    slug: 'asset-inventory',
    name: 'Asset & Inventory Agent',
    category: 'finops',
    description: 'Asset digest: real server estate composition (types/status/capacity totals) as the inventory of record; flags capacity concentration from actual counts.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_SERVER, 'ai.observability.read'],
    tools: ['list_server_health', 'get_platform_overview'],
    taskTypes: ['asset.inventory_digest'],
    approvalPolicy: 'automatic',
  },

  // ============================================================== §13 — Incident management
  {
    slug: 'incident-commander',
    name: 'Incident Commander',
    category: 'incident',
    description:
      'Correlates findings/events into real incidents: detect → correlate → create incident → assess affected services from evidence → recommend remediation. Authorized remediation requires the approval workflow; recovery claims require verification.',
    modelTier: 'native',
    riskLevel: 'high',
    permissions: [...READ_SERVER, ...READ_INFRA, 'ai.incident.manage'],
    tools: ['list_server_health', 'list_stuck_deployments', 'list_failed_deployments', 'list_incidents', 'create_incident', 'update_incident'],
    taskTypes: ['incident.correlate'],
    approvalPolicy: 'standard',
  },
  {
    slug: 'root-cause-analyst',
    name: 'Root Cause Analyst',
    category: 'incident',
    description: 'Post-incident analysis from deployments, metrics and tickets around the incident window. States confidence explicitly — probable cause vs confirmed cause — and never asserts uncertain conclusions as fact.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_SERVER, ...READ_INFRA, ...READ_SUPPORT, 'ai.incident.manage'],
    tools: ['get_server', 'list_failed_deployments', 'list_open_tickets', 'list_incidents'],
    taskTypes: ['incident.root_cause'],
    approvalPolicy: 'automatic',
  },

  // ============================================================== §14 — FinOps
  {
    slug: 'cloud-cost-guardian',
    name: 'Cloud Cost Guardian',
    category: 'finops',
    description: 'Utilization digest: servers consistently below utilization thresholds per real metrics, with optimization recommendations. It NEVER terminates infrastructure — recommendations only, actions stay with humans.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_SERVER],
    tools: ['list_server_health'],
    taskTypes: ['finops.cost_digest'],
    approvalPolicy: 'automatic',
  },

  // ============================================================== §15 — Analytics
  {
    slug: 'bi-agent',
    name: 'Business Intelligence Agent',
    category: 'analytics',
    description: 'Answers curated business questions (failed payments? churn leaders? resources near limits? open incidents?) by running the underlying read tools — every answer is a real query result.',
    modelTier: 'native',
    riskLevel: 'low',
    permissions: [...READ_OBS, ...READ_BILLING, ...READ_SERVER, ...READ_SUPPORT, ...READ_INFRA, 'ai.incident.manage'],
    tools: ['get_platform_overview', 'get_revenue_snapshot', 'list_overdue_invoices', 'list_failed_payments', 'list_server_health', 'list_open_tickets', 'list_subscriptions', 'list_incidents', 'list_expiring_ssl', 'list_expiring_domains'],
    taskTypes: ['bi.query'],
    approvalPolicy: 'automatic',
  },

  // ============================================================== §16 — Admin copilot
  {
    slug: 'admin-copilot',
    name: 'CloudHost247 Admin Copilot',
    category: 'copilot',
    description: 'Natural-language command surface for administrators. Read-only commands execute immediately; any write command is gated by the target tool\'s approval policy. Every command is an audited run.',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_OBS, ...READ_BILLING, ...READ_SUPPORT, ...READ_SERVER, ...READ_INFRA, ...READ_KB, 'ai.incident.manage'],
    tools: ['get_platform_overview', 'get_revenue_snapshot', 'list_overdue_invoices', 'list_failed_payments', 'list_open_tickets', 'list_server_health', 'list_stuck_deployments', 'list_failed_deployments', 'list_expiring_ssl', 'list_expiring_domains', 'list_subscriptions', 'search_knowledge', 'list_incidents', 'create_incident'],
    taskTypes: ['copilot.command'],
    approvalPolicy: 'standard',
  },

  // ============================================================== §17 — Customer assistant
  {
    slug: 'customer-cloud-assistant',
    name: 'Customer Cloud Assistant',
    category: 'copilot',
    description: 'The customer-facing assistant: answers account/billing/service questions and opens support tickets — strictly within the asking customer\'s own workspace. It can never read another customer\'s data (server-side scoping).',
    modelTier: 'native',
    riskLevel: 'medium',
    permissions: [...READ_CUSTOMER, ...READ_BILLING, ...READ_SUPPORT, ...READ_INFRA, ...READ_KB, 'ai.support.write'],
    tools: ['get_customer_profile', 'list_invoices', 'get_invoice', 'get_ticket', 'list_subscriptions', 'list_expiring_domains', 'list_expiring_ssl', 'search_knowledge', 'create_ticket'],
    taskTypes: ['customer.assistant_query'],
    approvalPolicy: 'automatic',
  },
];

const BY_SLUG = new Map(AGENT_CATALOG.map((a) => [a.slug, a]));

export function getAgentCatalogEntry(slug: string): AgentCatalogEntry | undefined {
  return BY_SLUG.get(slug);
}

/** Executive Board seats in presentation order (CEO first) for the War Room layout (spec §27). */
export const BOARD_SEATS = AGENT_CATALOG.filter((a) => a.boardSeat !== undefined);

/**
 * Catalog integrity: every tool an agent lists must exist in the tool catalog, and the agent must
 * hold the permission that tool requires. Checked at startup by tests — a catalog that violates
 * this never ships.
 */
export function validateCatalogIntegrity(getTool: (name: string) => { permission: AiPermission } | undefined): string[] {
  const errors: string[] = [];
  for (const agent of AGENT_CATALOG) {
    for (const toolName of agent.tools) {
      const tool = getTool(toolName);
      if (!tool) {
        errors.push(`${agent.slug}: unknown tool '${toolName}'`);
        continue;
      }
      if (!agent.permissions.includes(tool.permission)) {
        errors.push(`${agent.slug}: tool '${toolName}' requires ${tool.permission} which the agent does not hold`);
      }
    }
  }
  return errors;
}
