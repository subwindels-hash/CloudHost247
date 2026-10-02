/**
 * Seeds the AI registry (agents, model-router configs, default automation workflows) from the
 * code catalog into the database. Idempotent: safe on every boot and every worker sweep.
 *
 * This is intentionally NOT done in the SQL migration: the TypeScript catalog is the single
 * source of truth, and tests verify DB ⇄ catalog agreement after migrateUp.
 */
import type { Queryable } from '../../db/types';
import { AGENT_CATALOG } from './agent-catalog';
import { insertAgentVersion } from '../repositories/registry-repo';

const DEFAULT_WORKFLOWS: ReadonlyArray<{
  slug: string;
  name: string;
  description: string;
  eventType: string;
  definition: ReadonlyArray<Record<string, unknown>>;
}> = [
  {
    slug: 'invoice-overdue-collections',
    name: 'WHEN invoice becomes overdue → Collector analyzes and drafts a reminder',
    description:
      'Spec §25 example: overdue invoice → Collector analyzes the account → drafts a customer-friendly reminder. Sending is never automatic (send_notification requires human approval).',
    eventType: 'invoice.overdue',
    definition: [
      {
        agent_slug: 'collector',
        task_type: 'billing.overdue_digest',
        subject_from: 'invoiceId',
        subject_type: 'invoice',
        customer_from: 'customerId',
        input: { limit: 25, focusInvoiceId: '{{invoiceId}}' },
      },
    ],
  },
  {
    slug: 'server-unhealthy-incident',
    name: 'WHEN server health becomes critical → Guardian analyzes → Commander correlates an incident',
    description: 'Spec §25 example: server.unhealthy → Infrastructure Guardian server report → Incident Commander correlates findings into a real incident.',
    eventType: 'server.unhealthy',
    definition: [
      {
        agent_slug: 'server-health-agent',
        task_type: 'infrastructure.server_report',
        subject_from: 'serverId',
        subject_type: 'server',
        input: { serverId: '{{serverId}}' },
      },
      {
        agent_slug: 'incident-commander',
        task_type: 'incident.correlate',
        subject_from: 'serverId',
        subject_type: 'server',
        input: { serverId: '{{serverId}}', sourceEvent: 'server.unhealthy' },
      },
    ],
  },
  {
    slug: 'payment-failed-retention',
    name: 'WHEN payment fails → Retention scan for the affected customer',
    description: 'Failed payment → Customer Retention Agent checks for compounding churn signals on that real account.',
    eventType: 'payment.failed',
    definition: [
      {
        agent_slug: 'retention-agent',
        task_type: 'sales.retention_scan',
        subject_from: 'customerId',
        subject_type: 'customer',
        customer_from: 'customerId',
        input: { focusCustomerId: '{{customerId}}' },
      },
    ],
  },
];

export interface RegistrySeedResult {
  agents: number;
  workflows: number;
  models: number;
}

/**
 * Databases this process has already stamped the initial `ai_agent_versions` row into.
 *
 * Keyed per database object and NEVER process-global: one process can legitimately seed several
 * distinct databases (the test suite builds a fresh embedded Postgres per test; an operator can
 * point the worker at a different pool), and every one of them is entitled to its own version
 * history. The old process-wide `seeded` boolean silently denied version rows to the second and
 * every later database in the same process.
 *
 * Correctness does not depend on this set: `insertAgentVersion` is `ON CONFLICT DO NOTHING`, so
 * it only avoids repeating one no-op write per agent on every sweep.
 */
const versionStamped = new WeakSet<object>();

/** Databases whose registry seed has already succeeded in this process. */
const seedSucceeded = new WeakSet<object>();

/** In-flight seed per database, so concurrent callers share one run instead of racing. */
const seedInFlight = new WeakMap<object, Promise<RegistrySeedResult>>();

/**
 * Idempotent registry seed. Call from the worker sweep and the workflow engine — both of which
 * want the catalog re-applied on every cycle so a code-side catalog change always wins over a
 * hand edit, while `enabled` flags (the operator kill switch) are deliberately left untouched.
 *
 * App boot does NOT call this directly: see `ensureAgentRegistrySeeded` and the AI routes'
 * `onReady` hook. Booting must never depend on a database write succeeding.
 */
export async function seedAgentRegistry(db: Queryable): Promise<RegistrySeedResult> {
  for (const agent of AGENT_CATALOG) {
    const { rows } = await db.query<{ id: string; slug: string }>(
      `INSERT INTO ai_agents (slug, name, description, category, board_seat, version, engine, model_tier,
                              permissions, tools, task_types, approval_policy, risk_level, enabled)
       VALUES ($1,$2,$3,$4,$5,1,'deterministic','native',$6,$7,$8,$9,$10,true)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         category = EXCLUDED.category,
         board_seat = EXCLUDED.board_seat,
         permissions = EXCLUDED.permissions,
         tools = EXCLUDED.tools,
         task_types = EXCLUDED.task_types,
         approval_policy = EXCLUDED.approval_policy,
         risk_level = EXCLUDED.risk_level,
         updated_at = now()
       RETURNING id, slug`,
      [
        agent.slug,
        agent.name,
        agent.description,
        agent.category,
        agent.boardSeat ?? null,
        JSON.stringify(agent.permissions),
        JSON.stringify(agent.tools),
        JSON.stringify(agent.taskTypes),
        agent.approvalPolicy,
        agent.riskLevel,
      ]
    );
    if (rows[0] && !versionStamped.has(db)) {
      await insertAgentVersion(
        db,
        rows[0].id,
        1,
        { permissions: agent.permissions, tools: agent.tools, taskTypes: agent.taskTypes, approvalPolicy: agent.approvalPolicy },
        null,
        'Initial registry seed from code catalog'
      );
    }
  }

  for (const wf of DEFAULT_WORKFLOWS) {
    await db.query(
      `INSERT INTO ai_workflows (id, slug, name, description, event_type, enabled, definition)
       VALUES (gen_random_uuid(), $1,$2,$3,$4,true,$5)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
         event_type = EXCLUDED.event_type, definition = EXCLUDED.definition, updated_at = now()`,
      [wf.slug, wf.name, wf.description, wf.eventType, JSON.stringify(wf.definition)]
    );
  }

  // Model router configs: the native deterministic engine is the only enabled engine. External
  // engines are seeded DISABLED + unconfigured — resolution attempts fail closed (spec §37).
  await db.query(
    `INSERT INTO ai_model_configs (engine, provider, model, endpoint, enabled, config, notes)
     VALUES
       ('deterministic', 'cloudhost247', 'cloudhost247-native', NULL, true,
        '{"latency":"local","cost":"none","dataLeavesPlatform":false}'::jsonb,
        'Native deterministic engine. Answers only from real platform data and registered knowledge; never fabricates.'),
       ('openai', 'openai', NULL, NULL, false, '{}'::jsonb,
        'External LLM engine. Configure model + endpoint and enable explicitly; until then every resolution fails closed with CONFIGURATION_REQUIRED. API keys belong in environment variables, never in this table.'),
       ('anthropic', 'anthropic', NULL, NULL, false, '{}'::jsonb,
        'External LLM engine. See openai row note — disabled and fail-closed until configured.'),
       ('self_hosted', NULL, NULL, NULL, false, '{}'::jsonb,
        'Customer-operated model endpoint (e.g. internal inference). Configure endpoint and enable explicitly before use.')
     ON CONFLICT (engine) DO NOTHING`
  );

  versionStamped.add(db);
  seedSucceeded.add(db);
  return { agents: AGENT_CATALOG.length, workflows: DEFAULT_WORKFLOWS.length, models: 4 };
}

/**
 * Single-flight, self-healing registry seed for the HTTP surface.
 *
 * Why this exists: the registry used to be seeded *inside route registration*, which made
 * `buildApp()`/`app.ready()` throw whenever the database was momentarily unreachable — the whole
 * platform (including `/health`, which is contractually database-free, and every static/SPA route)
 * failed to boot because an AI seeding write failed. Boot now tolerates a seed failure, and this
 * function is what puts the registry back afterwards:
 *
 *   - resolves immediately (`null`) once a seed has succeeded against this database, so adding it
 *     to a request path costs a `WeakSet.has`, not a query;
 *   - concurrent first callers share ONE run, which also closes the old race where two overlapping
 *     seeds could both decide to write the initial agent-version rows;
 *   - a FAILED attempt is not remembered, so the next authorized request tries again instead of
 *     the process running with an empty registry until someone restarts it.
 *
 * Callers must be authenticated and authorized first: this can perform database writes, so it is
 * never reachable from an unauthenticated request (the AI routes call it after `requireAiPermission`
 * / `authenticate`, and the boot `onReady` hook runs it as the server itself).
 */
export async function ensureAgentRegistrySeeded(db: Queryable): Promise<RegistrySeedResult | null> {
  if (seedSucceeded.has(db)) return null;
  const inFlight = seedInFlight.get(db);
  if (inFlight) return inFlight;

  const attempt = seedAgentRegistry(db).then(
    (result) => {
      seedInFlight.delete(db);
      return result;
    },
    (error: unknown) => {
      // Not remembered as success: the next call retries. The caller decides how to report it.
      seedInFlight.delete(db);
      throw error;
    }
  );
  seedInFlight.set(db, attempt);
  return attempt;
}
