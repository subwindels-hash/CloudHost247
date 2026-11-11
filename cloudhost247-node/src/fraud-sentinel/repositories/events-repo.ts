/**
 * Detection event ledger — ingestion and reads.
 *
 * Ingestion is a set of `SELECT … WHERE NOT EXISTS (already ingested)` reads against the tables
 * CloudHost247 ALREADY writes, mapped in application code into a redacted, normalized event row and
 * inserted with `ON CONFLICT (dedupe_key) DO NOTHING`. Idempotency is therefore guaranteed twice
 * over: by the NOT EXISTS predicate (so the common case never even attempts a conflicting insert) and
 * by the database's unique index (so two overlapping worker runs cannot both insert).
 *
 * Two deliberate design points:
 *
 *   * `id` is derived from `dedupe_key` with md5 rather than randomUUID(). That makes the primary key
 *     and the idempotency key 1:1, so a re-ingest of the same observable state is a no-op on BOTH
 *     constraints and the same event always has the same id in every environment — useful when
 *     comparing a staging replay against production. md5 is in pg_catalog/core (no extension) and is
 *     used here as an identifier derivation, never for anything security-related.
 *   * Every source read is wrapped: on a deployment where a quarantined migration was never applied
 *     (0024 webhook_events, 0041 provisioning_jobs) or a module table does not exist, that source is
 *     reported as skipped instead of failing the whole scan. A detector that cannot see a table says
 *     so; it never silently pretends the table was empty.
 *
 * No write in this file touches a financial or account-status table. The only INSERT target is
 * fraud_sentinel_events.
 */
import { createHash } from 'node:crypto';
import type { Queryable } from '../../db/types';
import { classifyClient, resolveApproximateGeo } from '../../visitor-intelligence/geo';
import { redactEvidence } from '../utils/redaction';
import { EVENT_KINDS } from '../rules/signals';
import type { FraudCategory, FraudEventRow, SubjectType } from '../types';

/* -------------------------------------------------------------------------- */
/* Event construction                                                          */
/* -------------------------------------------------------------------------- */

export interface NewFraudEvent {
  dedupeKey: string;
  sourceTable: string;
  sourceId: string;
  sourceEventType: string;
  category: FraudCategory;
  subjectType: SubjectType;
  subjectId: string | null;
  customerId: string | null;
  actorId: string | null;
  orderId: string | null;
  invoiceId: string | null;
  paymentId: string | null;
  serviceId: string | null;
  channel: string | null;
  ipAddress: string | null;
  ipCountryCode: string | null;
  clientFamily: string | null;
  amount: number | null;
  currency: string | null;
  occurredAt: Date | string;
  evidence: Record<string, unknown>;
}

/** md5-derived uuid, formatted canonically. Deterministic: same dedupe key ⇒ same id, everywhere. */
export function deterministicEventId(dedupeKey: string): string {
  const hex = createHash('md5').update(dedupeKey).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Coarse, non-identifying client label. The raw user-agent is never copied into this module. */
export function clientFamilyOf(userAgent: unknown): string | null {
  if (typeof userAgent !== 'string' || userAgent.trim() === '') return null;
  const profile = classifyClient(userAgent);
  const family = `${profile.browserFamily}|${profile.osFamily}`;
  return family.slice(0, 64);
}

/** Country code from the platform's own GeoIP database, or null when it cannot resolve the IP. */
export function countryOf(ipAddress: string | null): string | null {
  if (!ipAddress) return null;
  const geo = resolveApproximateGeo(ipAddress);
  return geo.countryCode ? geo.countryCode.toUpperCase().slice(0, 2) : null;
}

/** GeoIP coordinates for impossible-travel arithmetic, when the IP resolved. */
export function coordinatesOf(ipAddress: string | null): { latitude: number | null; longitude: number | null } {
  if (!ipAddress) return { latitude: null, longitude: null };
  const geo = resolveApproximateGeo(ipAddress);
  return { latitude: geo.latitude, longitude: geo.longitude };
}

/* -------------------------------------------------------------------------- */
/* Insert                                                                      */
/* -------------------------------------------------------------------------- */

const INSERT_COLUMNS = [
  'id',
  'dedupe_key',
  'source_table',
  'source_id',
  'source_event_type',
  'category',
  'subject_type',
  'subject_id',
  'customer_id',
  'actor_id',
  'order_id',
  'invoice_id',
  'payment_id',
  'service_id',
  'channel',
  'ip_address',
  'ip_country_code',
  'client_family',
  'amount',
  'currency',
  'occurred_at',
  'evidence',
] as const;

/** Maximum rows per INSERT statement — keeps the parameter count well under the 65535 protocol limit. */
const INSERT_CHUNK = 200;

/**
 * Inserts events, ignoring any whose dedupe_key already exists. Returns how many were genuinely new.
 * Chunked so a large backfill cannot exceed the wire protocol's parameter limit.
 */
export async function insertEvents(db: Queryable, events: readonly NewFraudEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  let inserted = 0;
  for (let start = 0; start < events.length; start += INSERT_CHUNK) {
    const chunk = events.slice(start, start + INSERT_CHUNK);
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const event of chunk) {
      const occurredAt = toDate(event.occurredAt) ?? new Date();
      const base = params.length;
      params.push(
        deterministicEventId(event.dedupeKey),
        event.dedupeKey.slice(0, 200),
        event.sourceTable,
        event.sourceId.slice(0, 64),
        event.sourceEventType.slice(0, 64),
        event.category,
        event.subjectType,
        event.subjectId,
        event.customerId,
        event.actorId,
        event.orderId,
        event.invoiceId,
        event.paymentId,
        event.serviceId,
        event.channel ? event.channel.slice(0, 64) : null,
        event.ipAddress ? event.ipAddress.slice(0, 64) : null,
        event.ipCountryCode,
        event.clientFamily,
        event.amount === null || event.amount < 0 ? null : event.amount,
        event.currency ? event.currency.toUpperCase().slice(0, 3) : null,
        occurredAt.toISOString(),
        JSON.stringify(redactEvidence(event.evidence) ?? {})
      );
      const placeholders = INSERT_COLUMNS.map((_, index) => `$${base + index + 1}`);
      tuples.push(`(${placeholders.join(', ')})`);
    }
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO fraud_sentinel_events (${INSERT_COLUMNS.join(', ')})
       VALUES ${tuples.join(', ')}
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      params
    );
    inserted += rows.length;
  }
  return inserted;
}

/* -------------------------------------------------------------------------- */
/* Source specifications                                                       */
/* -------------------------------------------------------------------------- */

/** Rows in a source table that have not been ingested yet, oldest first, bounded by LIMIT. */
interface SourceSpec {
  table: string;
  sql: string;
  map: (row: Record<string, unknown>) => NewFraudEvent | null;
}

function notIngested(keyExpression: string): string {
  return `AND NOT EXISTS (SELECT 1 FROM fraud_sentinel_events e WHERE e.dedupe_key = ${keyExpression})`;
}

const PAYMENT_KIND: Record<string, string> = {
  pending: EVENT_KINDS.paymentPending,
  successful: EVENT_KINDS.paymentSuccessful,
  failed: EVENT_KINDS.paymentFailed,
  cancelled: EVENT_KINDS.paymentCancelled,
  expired: EVENT_KINDS.paymentExpired,
  refunded: EVENT_KINDS.paymentRefunded,
  partially_refunded: EVENT_KINDS.paymentPartiallyRefunded,
};

const INVOICE_KIND: Record<string, string> = {
  unpaid: EVENT_KINDS.invoiceUnpaid,
  paid: EVENT_KINDS.invoicePaid,
  void: EVENT_KINDS.invoiceVoid,
  refunded: EVENT_KINDS.invoiceRefunded,
  partially_refunded: EVENT_KINDS.invoicePartiallyRefunded,
};

const LEDGER_KIND: Record<string, string> = {
  charge: EVENT_KINDS.ledgerCharge,
  payment: EVENT_KINDS.ledgerPayment,
  refund: EVENT_KINDS.ledgerRefund,
  credit: EVENT_KINDS.ledgerCredit,
};

const SERVICE_KIND: Record<string, string> = {
  active: EVENT_KINDS.serviceActive,
  suspended: EVENT_KINDS.serviceSuspended,
  cancelled: EVENT_KINDS.serviceCancelled,
  pending_migration: EVENT_KINDS.servicePendingMigration,
};

const WEBHOOK_KIND: Record<string, string> = {
  processing: EVENT_KINDS.webhookProcessing,
  completed: EVENT_KINDS.webhookCompleted,
  failed: EVENT_KINDS.webhookFailed,
  rejected: EVENT_KINDS.webhookRejected,
  ignored: EVENT_KINDS.webhookIgnored,
};

/** auth_audit_log event types that describe a PRIVILEGED actor's action, so they are attributed to
 * the actor subject as well as to the account subject. */
const ACTOR_AUTH_EVENTS = new Set<string>([
  'admin_role_change',
  'admin_status_change',
  'manual_payment_confirmed',
  'manual_payment_rejected',
  'admin_invoice_refunded',
  'admin_invoice_cancelled',
]);

/** auth_audit_log event types that are about money rather than about account security. */
const PAYMENT_AUTH_EVENTS = new Set<string>([
  'payment_initiated',
  'webhook_payment_succeeded',
  'webhook_payment_failed',
]);

/**
 * Maps an auth_audit_log event type onto this module's four detection categories. The mapping is
 * explicit rather than guessed: an event type that is not listed is account-security activity, which
 * is what the remaining 30-odd values in the table's CHECK constraint genuinely are.
 */
export function authEventCategory(eventType: string): FraudCategory {
  if (ACTOR_AUTH_EVENTS.has(eventType)) return 'admin_api';
  if (PAYMENT_AUTH_EVENTS.has(eventType)) return 'payment';
  return 'account_security';
}

function firstString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = toText(source[key]);
    if (value) return value;
  }
  return null;
}

const SOURCE_SPECS: readonly SourceSpec[] = [
  {
    table: 'payments',
    sql: `SELECT p.id, p.invoice_id, p.user_id, p.provider, p.provider_reference, p.method,
                 p.amount, p.currency, p.status, p.failure_reason, p.initiated_at, p.completed_at, p.created_at,
                 i.total_amount AS invoice_total, i.currency AS invoice_currency, i.status AS invoice_status,
                 o.id AS order_id, o.currency AS order_currency, o.order_number
          FROM payments p
          JOIN invoices i ON i.id = p.invoice_id
          LEFT JOIN orders o ON o.id = i.order_id
          WHERE p.created_at >= $1::timestamptz
            ${notIngested(`'payments:' || p.id::text || ':' || p.status`)}
          ORDER BY p.created_at ASC, p.id ASC
          LIMIT $2`,
    map: (row) => {
      const status = toText(row.status) ?? 'pending';
      const ipAddress = null; // `payments` records no IP; claiming one would be inventing telemetry.
      return {
        dedupeKey: `payments:${row.id}:${status}`,
        sourceTable: 'payments',
        sourceId: String(row.id),
        sourceEventType: PAYMENT_KIND[status] ?? `payment_${status}`,
        category: 'payment',
        subjectType: 'customer',
        subjectId: toText(row.user_id),
        customerId: toText(row.user_id),
        actorId: null,
        orderId: toText(row.order_id),
        invoiceId: toText(row.invoice_id),
        paymentId: toText(row.id),
        serviceId: null,
        channel: toText(row.provider),
        ipAddress,
        ipCountryCode: null,
        clientFamily: null,
        amount: toNumber(row.amount),
        currency: toText(row.currency),
        occurredAt: toDate(row.completed_at) ?? toDate(row.initiated_at) ?? toDate(row.created_at) ?? new Date(),
        evidence: {
          status,
          provider: toText(row.provider),
          providerReference: toText(row.provider_reference),
          method: toText(row.method),
          failureReason: toText(row.failure_reason),
          invoiceTotal: toNumber(row.invoice_total),
          invoiceCurrency: toText(row.invoice_currency),
          invoiceStatus: toText(row.invoice_status),
          orderCurrency: toText(row.order_currency),
          orderNumber: toText(row.order_number),
          initiatedAt: toDate(row.initiated_at)?.toISOString() ?? null,
          completedAt: toDate(row.completed_at)?.toISOString() ?? null,
        },
      };
    },
  },
  {
    table: 'invoices',
    sql: `SELECT i.id, i.invoice_number, i.order_id, i.user_id, i.currency, i.subtotal_amount,
                 i.discount_amount, i.tax_amount, i.total_amount, i.status, i.due_date, i.issued_at,
                 i.created_at, i.updated_at, o.currency AS order_currency, o.order_number
          FROM invoices i
          LEFT JOIN orders o ON o.id = i.order_id
          WHERE i.updated_at >= $1::timestamptz
            ${notIngested(`'invoices:' || i.id::text || ':' || i.status`)}
          ORDER BY i.updated_at ASC, i.id ASC
          LIMIT $2`,
    map: (row) => {
      const status = toText(row.status) ?? 'unpaid';
      return {
        dedupeKey: `invoices:${row.id}:${status}`,
        sourceTable: 'invoices',
        sourceId: String(row.id),
        sourceEventType: INVOICE_KIND[status] ?? `invoice_${status}`,
        category: 'payment',
        subjectType: 'customer',
        subjectId: toText(row.user_id),
        customerId: toText(row.user_id),
        actorId: null,
        orderId: toText(row.order_id),
        invoiceId: toText(row.id),
        paymentId: null,
        serviceId: null,
        channel: null,
        ipAddress: null,
        ipCountryCode: null,
        clientFamily: null,
        amount: toNumber(row.total_amount),
        currency: toText(row.currency),
        // `invoices` has no per-status timestamp, so the observable state is dated at the row's last
        // update. The authoritative timing for money movement is billing_ledger.created_at, and the
        // assessment says which it used.
        occurredAt: toDate(row.updated_at) ?? toDate(row.issued_at) ?? new Date(),
        evidence: {
          status,
          invoiceNumber: toText(row.invoice_number),
          orderNumber: toText(row.order_number),
          orderCurrency: toText(row.order_currency),
          subtotalAmount: toNumber(row.subtotal_amount),
          discountAmount: toNumber(row.discount_amount),
          taxAmount: toNumber(row.tax_amount),
          dueDate: toText(row.due_date),
          issuedAt: toDate(row.issued_at)?.toISOString() ?? null,
          timestampBasis: 'invoices.updated_at (no per-status timestamp exists on this table)',
        },
      };
    },
  },
  {
    table: 'orders',
    sql: `SELECT o.id, o.order_number, o.user_id, o.currency, o.subtotal_amount, o.discount_amount,
                 o.tax_amount, o.total_amount, o.status, o.payment_status, o.created_at, o.updated_at,
                 COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'productName', oi.product_name_snapshot,
                            'planName', oi.plan_name_snapshot,
                            'billingPeriod', oi.billing_period,
                            'quantity', oi.quantity,
                            'unitPrice', oi.unit_price_amount,
                            'lineTotal', oi.line_total_amount,
                            'currency', oi.currency) ORDER BY oi.id)
                   FROM order_items oi WHERE oi.order_id = o.id
                 ), '[]'::jsonb) AS items
          FROM orders o
          WHERE o.created_at >= $1::timestamptz
            ${notIngested(`'orders:' || o.id::text`)}
          ORDER BY o.created_at ASC, o.id ASC
          LIMIT $2`,
    map: (row) => ({
      // ONE event per order, ever: the dedupe key carries no state, so an order changing status
      // cannot inflate order-velocity counts. Current payment state is read live from `orders` by
      // the facts loader instead.
      dedupeKey: `orders:${row.id}`,
      sourceTable: 'orders',
      sourceId: String(row.id),
      sourceEventType: EVENT_KINDS.orderCreated,
      category: 'order_service',
      subjectType: 'customer',
      subjectId: toText(row.user_id),
      customerId: toText(row.user_id),
      actorId: null,
      orderId: toText(row.id),
      invoiceId: null,
      paymentId: null,
      serviceId: null,
      channel: null,
      ipAddress: null,
      ipCountryCode: null,
      clientFamily: null,
      amount: toNumber(row.total_amount),
      currency: toText(row.currency),
      occurredAt: toDate(row.created_at) ?? new Date(),
      evidence: {
        orderNumber: toText(row.order_number),
        status: toText(row.status),
        paymentStatus: toText(row.payment_status),
        subtotalAmount: toNumber(row.subtotal_amount),
        discountAmount: toNumber(row.discount_amount),
        taxAmount: toNumber(row.tax_amount),
        items: Array.isArray(row.items) ? row.items : [],
        snapshotAt: toDate(row.updated_at)?.toISOString() ?? null,
        snapshotNote: 'status/payment_status are as recorded at ingestion; read the orders row for current state',
      },
    }),
  },
  {
    table: 'billing_ledger',
    sql: `SELECT l.id, l.user_id, l.invoice_id, l.entry_type, l.amount, l.currency, l.description, l.created_at
          FROM billing_ledger l
          WHERE l.created_at >= $1::timestamptz
            ${notIngested(`'billing_ledger:' || l.id::text || ':' || l.entry_type`)}
          ORDER BY l.created_at ASC, l.id ASC
          LIMIT $2`,
    map: (row) => {
      const entryType = toText(row.entry_type) ?? 'charge';
      return {
        dedupeKey: `billing_ledger:${row.id}:${entryType}`,
        sourceTable: 'billing_ledger',
        sourceId: String(row.id),
        sourceEventType: LEDGER_KIND[entryType] ?? `ledger_${entryType}`,
        category: 'payment',
        subjectType: 'customer',
        subjectId: toText(row.user_id),
        customerId: toText(row.user_id),
        actorId: null,
        orderId: null,
        invoiceId: toText(row.invoice_id),
        paymentId: null,
        serviceId: null,
        channel: null,
        ipAddress: null,
        ipCountryCode: null,
        clientFamily: null,
        amount: toNumber(row.amount),
        currency: toText(row.currency),
        occurredAt: toDate(row.created_at) ?? new Date(),
        evidence: { entryType, description: toText(row.description) },
      };
    },
  },
  {
    table: 'auth_audit_log',
    sql: `SELECT a.id, a.user_id, a.event_type, a.ip_address, a.user_agent, a.metadata, a.created_at,
                 u.role AS user_role, u.customer_id AS customer_number
          FROM auth_audit_log a
          LEFT JOIN users u ON u.id = a.user_id
          WHERE a.created_at >= $1::timestamptz
            ${notIngested(`'auth_audit_log:' || a.id::text || ':' || a.event_type`)}
          ORDER BY a.created_at ASC, a.id ASC
          LIMIT $2`,
    map: (row) => {
      const eventType = toText(row.event_type) ?? 'unknown';
      const ipAddress = toText(row.ip_address);
      const metadata = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>;
      const { latitude, longitude } = coordinatesOf(ipAddress);
      return {
        dedupeKey: `auth_audit_log:${row.id}:${eventType}`,
        sourceTable: 'auth_audit_log',
        sourceId: String(row.id),
        // auth_audit_log's own event_type vocabulary, verbatim — never renamed.
        sourceEventType: eventType,
        category: authEventCategory(eventType),
        subjectType: 'customer',
        subjectId: toText(row.user_id),
        customerId: toText(row.user_id),
        actorId: ACTOR_AUTH_EVENTS.has(eventType) ? toText(row.user_id) : null,
        orderId: null,
        invoiceId: firstString(metadata, ['invoiceId', 'invoice_id']),
        paymentId: firstString(metadata, ['paymentId', 'payment_id']),
        serviceId: null,
        channel: null,
        ipAddress,
        ipCountryCode: countryOf(ipAddress),
        clientFamily: clientFamilyOf(row.user_agent),
        amount: toNumber(metadata.amount ?? metadata.totalAmount ?? null),
        currency: toText(metadata.currency),
        occurredAt: toDate(row.created_at) ?? new Date(),
        evidence: {
          eventType,
          userRole: toText(row.user_role),
          customerNumber: toText(row.customer_number),
          targetRole: firstString(metadata, ['role', 'toRole', 'newRole', 'targetRole']),
          targetStatus: firstString(metadata, ['status', 'toStatus', 'newStatus']),
          targetUserId: firstString(metadata, ['targetUserId', 'target_user_id', 'userId']),
          // The metadata object is passed through redactEvidence, which strips anything secret-shaped
          // by key name (token, secret, password, hash, mfa, passkey, pin, …) before it is stored.
          metadata,
          latitude,
          longitude,
          // The raw user-agent is deliberately NOT copied: the coarse client_family classification is
          // all any rule needs, and the raw string already lives in auth_audit_log under its own
          // access controls.
          userAgentRetained: false,
        },
      };
    },
  },
  {
    table: 'audit_logs',
    sql: `SELECT g.id, g.actor_id, g.action, g.resource_type, g.resource_id, g.ip_address, g.user_agent,
                 g.metadata, g.created_at, u.role AS actor_role
          FROM audit_logs g
          LEFT JOIN users u ON u.id = g.actor_id
          WHERE g.created_at >= $1::timestamptz
            ${notIngested(`'audit_logs:' || g.id::text || ':' || g.action`)}
          ORDER BY g.created_at ASC, g.id ASC
          LIMIT $2`,
    map: (row) => {
      const action = toText(row.action) ?? 'unknown';
      const ipAddress = toText(row.ip_address);
      const metadata = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>;
      return {
        dedupeKey: `audit_logs:${row.id}:${action}`,
        sourceTable: 'audit_logs',
        sourceId: String(row.id),
        sourceEventType: EVENT_KINDS.adminAction,
        category: 'admin_api',
        subjectType: 'actor',
        subjectId: toText(row.actor_id),
        customerId: null,
        actorId: toText(row.actor_id),
        orderId: null,
        invoiceId: null,
        paymentId: null,
        serviceId: null,
        channel: toText(row.resource_type),
        ipAddress,
        ipCountryCode: countryOf(ipAddress),
        clientFamily: clientFamilyOf(row.user_agent),
        amount: null,
        currency: null,
        occurredAt: toDate(row.created_at) ?? new Date(),
        evidence: {
          action,
          resourceType: toText(row.resource_type),
          resourceId: toText(row.resource_id),
          actorRole: toText(row.actor_role),
          metadata,
          userAgentRetained: false,
        },
      };
    },
  },
  {
    table: 'webhook_events',
    sql: `SELECT w.id, w.gateway, w.event_id, w.transmission_id, w.event_type, w.provider_reference,
                 w.payment_id, w.status, w.payload_hash, w.received_at, w.processed_at, w.error_message,
                 p.user_id AS payment_user_id, p.invoice_id AS payment_invoice_id,
                 p.amount AS payment_amount, p.currency AS payment_currency
          FROM webhook_events w
          LEFT JOIN payments p ON p.id = w.payment_id
          WHERE w.received_at >= $1::timestamptz
            ${notIngested(`'webhook_events:' || w.id::text || ':' || w.status`)}
          ORDER BY w.received_at ASC, w.id ASC
          LIMIT $2`,
    map: (row) => {
      const status = toText(row.status) ?? 'processing';
      const gateway = toText(row.gateway) ?? 'unknown';
      return {
        dedupeKey: `webhook_events:${row.id}:${status}`,
        sourceTable: 'webhook_events',
        sourceId: String(row.id),
        sourceEventType: WEBHOOK_KIND[status] ?? `webhook_${status}`,
        category: 'admin_api',
        subjectType: 'gateway',
        subjectId: null,
        customerId: toText(row.payment_user_id),
        actorId: null,
        orderId: null,
        invoiceId: toText(row.payment_invoice_id),
        paymentId: toText(row.payment_id),
        serviceId: null,
        channel: gateway,
        ipAddress: null,
        ipCountryCode: null,
        clientFamily: null,
        amount: toNumber(row.payment_amount),
        currency: toText(row.payment_currency),
        occurredAt: toDate(row.received_at) ?? new Date(),
        evidence: {
          gateway,
          status,
          eventId: toText(row.event_id),
          transmissionId: toText(row.transmission_id),
          eventType: toText(row.event_type),
          providerReference: toText(row.provider_reference),
          // A sha256 payload fingerprint, not a credential: it is the entire basis of the replay rule
          // and redaction deliberately preserves pure-hex digests.
          payloadHash: toText(row.payload_hash),
          processedAt: toDate(row.processed_at)?.toISOString() ?? null,
          errorMessage: toText(row.error_message),
        },
      };
    },
  },
  {
    table: 'customer_services',
    sql: `SELECT s.id, s.user_id, s.product_id, s.plan_id, s.label, s.status, s.external_reference,
                 s.created_at, s.updated_at
          FROM customer_services s
          WHERE s.updated_at >= $1::timestamptz
            ${notIngested(`'customer_services:' || s.id::text || ':' || s.status`)}
          ORDER BY s.updated_at ASC, s.id ASC
          LIMIT $2`,
    map: (row) => {
      const status = toText(row.status) ?? 'active';
      return {
        dedupeKey: `customer_services:${row.id}:${status}`,
        sourceTable: 'customer_services',
        sourceId: String(row.id),
        sourceEventType: SERVICE_KIND[status] ?? `service_${status}`,
        category: 'order_service',
        subjectType: 'customer',
        subjectId: toText(row.user_id),
        customerId: toText(row.user_id),
        actorId: null,
        orderId: null,
        invoiceId: null,
        paymentId: null,
        serviceId: toText(row.id),
        channel: null,
        ipAddress: null,
        ipCountryCode: null,
        clientFamily: null,
        amount: null,
        currency: null,
        occurredAt: toDate(row.updated_at) ?? toDate(row.created_at) ?? new Date(),
        evidence: {
          status,
          label: toText(row.label),
          externalReference: toText(row.external_reference),
          productId: toText(row.product_id),
          planId: toText(row.plan_id),
          createdAt: toDate(row.created_at)?.toISOString() ?? null,
        },
      };
    },
  },
  {
    table: 'provisioning_jobs',
    sql: `SELECT j.id, j.deployment_id, j.server_id, j.order_id, j.provider_id, j.operation, j.status,
                 j.attempts, j.max_attempts, j.error_code, j.created_at, j.updated_at,
                 o.user_id AS order_user_id
          FROM provisioning_jobs j
          LEFT JOIN orders o ON o.id = j.order_id
          WHERE j.created_at >= $1::timestamptz
            ${notIngested(`'provisioning_jobs:' || j.id::text`)}
          ORDER BY j.created_at ASC, j.id ASC
          LIMIT $2`,
    map: (row) => ({
      dedupeKey: `provisioning_jobs:${row.id}`,
      sourceTable: 'provisioning_jobs',
      sourceId: String(row.id),
      sourceEventType: EVENT_KINDS.provisioningJob,
      category: 'order_service',
      subjectType: 'customer',
      subjectId: toText(row.order_user_id),
      customerId: toText(row.order_user_id),
      actorId: null,
      orderId: toText(row.order_id),
      invoiceId: null,
      paymentId: null,
      serviceId: null,
      channel: toText(row.provider_id),
      ipAddress: null,
      ipCountryCode: null,
      clientFamily: null,
      amount: null,
      currency: null,
      occurredAt: toDate(row.created_at) ?? new Date(),
      evidence: {
        operation: toText(row.operation),
        status: toText(row.status),
        attempts: toNumber(row.attempts),
        maxAttempts: toNumber(row.max_attempts),
        // error_message is deliberately NOT projected: provider responses can carry credentials and
        // request identifiers. error_code is the safe, classified part.
        errorCode: toText(row.error_code),
        serverId: toText(row.server_id),
        deploymentId: toText(row.deployment_id),
        providerId: toText(row.provider_id),
      },
    }),
  },
  {
    table: 'admin_support_sessions',
    sql: `SELECT s.id, s.admin_id, s.customer_uuid, s.customer_id, s.reason, s.started_at, s.expires_at,
                 s.ended_at, s.ended_reason, s.ip_address, s.user_agent
          FROM admin_support_sessions s
          WHERE s.started_at >= $1::timestamptz
            ${notIngested(`'admin_support_sessions:' || s.id::text`)}
          ORDER BY s.started_at ASC, s.id ASC
          LIMIT $2`,
    map: (row) => {
      const ipAddress = toText(row.ip_address);
      return {
        dedupeKey: `admin_support_sessions:${row.id}`,
        sourceTable: 'admin_support_sessions',
        sourceId: String(row.id),
        sourceEventType: EVENT_KINDS.supportSessionStarted,
        category: 'admin_api',
        subjectType: 'actor',
        subjectId: toText(row.admin_id),
        customerId: toText(row.customer_uuid),
        actorId: toText(row.admin_id),
        orderId: null,
        invoiceId: null,
        paymentId: null,
        serviceId: null,
        channel: null,
        ipAddress,
        ipCountryCode: countryOf(ipAddress),
        clientFamily: clientFamilyOf(row.user_agent),
        amount: null,
        currency: null,
        occurredAt: toDate(row.started_at) ?? new Date(),
        evidence: {
          targetCustomerId: toText(row.customer_uuid),
          targetCustomerNumber: toText(row.customer_id),
          reason: toText(row.reason),
          expiresAt: toDate(row.expires_at)?.toISOString() ?? null,
          endedAt: toDate(row.ended_at)?.toISOString() ?? null,
          endedReason: toText(row.ended_reason),
          userAgentRetained: false,
        },
      };
    },
  },
  {
    table: 'tool_abuse_events',
    sql: `SELECT t.id, t.user_id, t.ip_address, t.tool_slug, t.kind, t.detail, t.created_at
          FROM tool_abuse_events t
          WHERE t.created_at >= $1::timestamptz
            ${notIngested(`'tool_abuse_events:' || t.id::text || ':' || t.kind`)}
          ORDER BY t.created_at ASC, t.id ASC
          LIMIT $2`,
    map: (row) => {
      const ipAddress = toText(row.ip_address);
      return {
        dedupeKey: `tool_abuse_events:${row.id}:${toText(row.kind) ?? 'unknown'}`,
        sourceTable: 'tool_abuse_events',
        sourceId: String(row.id),
        sourceEventType: EVENT_KINDS.toolAbuse,
        category: 'order_service',
        subjectType: 'customer',
        subjectId: toText(row.user_id),
        customerId: toText(row.user_id),
        actorId: null,
        orderId: null,
        invoiceId: null,
        paymentId: null,
        serviceId: null,
        channel: toText(row.tool_slug),
        ipAddress,
        ipCountryCode: countryOf(ipAddress),
        clientFamily: null,
        amount: null,
        currency: null,
        occurredAt: toDate(row.created_at) ?? new Date(),
        evidence: {
          toolSlug: toText(row.tool_slug),
          kind: toText(row.kind),
          detail: toText(row.detail),
        },
      };
    },
  },
];

/** The tables this module reads from, exposed so tests and docs can assert the read-only contract. */
export const INGESTION_SOURCE_TABLES: readonly string[] = SOURCE_SPECS.map((spec) => spec.table);

/**
 * Tables read while projecting a source row, but which produce no events of their own.
 *
 * `order_items` is joined inside the `orders` projection so an order event can carry its product and
 * plan snapshot; there is no per-item event. Listed separately because a rule that cites it as a data
 * source is telling the truth about where its evidence came from, even though ingestion never writes
 * an `order_items` row to the ledger.
 */
export const INGESTION_JOINED_TABLES: readonly string[] = ['order_items'];

export interface IngestionOutcome {
  ingested: number;
  scanned: number;
  perTable: Array<{ table: string; scanned: number; ingested: number }>;
  /** Sources that could not be read, with the reason. Never silently ignored. */
  skippedSources: Array<{ table: string; reason: string }>;
}

/** PostgreSQL error class for "relation does not exist". */
const UNDEFINED_TABLE = '42P01';

/**
 * Ingests everything recorded since `since` that is not already in the ledger.
 *
 * @param since      lower bound on each source table's own timestamp column
 * @param limitPerTable  fraud_sentinel.ingest_batch_limit
 */
export async function ingestNewEvents(
  db: Queryable,
  options: { since: Date; limitPerTable: number }
): Promise<IngestionOutcome> {
  const outcome: IngestionOutcome = { ingested: 0, scanned: 0, perTable: [], skippedSources: [] };
  const sinceIso = options.since.toISOString();
  const limit = Math.max(1, Math.floor(options.limitPerTable));

  for (const spec of SOURCE_SPECS) {
    try {
      const { rows } = await db.query<Record<string, unknown>>(spec.sql, [sinceIso, limit]);
      const mapped: NewFraudEvent[] = [];
      for (const row of rows) {
        const event = spec.map(row);
        // A row that cannot be attributed to any subject is not useful evidence and is skipped rather
        // than stored with a null subject that no scan would ever read.
        if (!event) continue;
        if (!event.subjectId && !event.customerId && !event.channel) continue;
        mapped.push(event);
      }
      const inserted = await insertEvents(db, mapped);
      outcome.scanned += rows.length;
      outcome.ingested += inserted;
      outcome.perTable.push({ table: spec.table, scanned: rows.length, ingested: inserted });
    } catch (error) {
      const code = (error as { code?: string }).code;
      const reason =
        code === UNDEFINED_TABLE
          ? `table '${spec.table}' does not exist in this database (its migration may be quarantined or not yet applied)`
          : error instanceof Error
            ? error.message
            : 'unknown error';
      outcome.skippedSources.push({ table: spec.table, reason });
      outcome.perTable.push({ table: spec.table, scanned: 0, ingested: 0 });
    }
  }

  return outcome;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface SubjectKey {
  subjectType: SubjectType;
  /** customer/actor: a users.id uuid. ip: the address string. gateway: the gateway name. */
  subjectId: string;
}

/**
 * The predicate that decides which events belong to a subject.
 *
 * This is the customer-isolation boundary for reads: a customer subject can only ever load its own
 * rows, and the value is bound as a parameter, never concatenated.
 */
function subjectPredicate(subject: SubjectKey, paramIndex: number): { clause: string; params: unknown[] } {
  const ref = `$${paramIndex}`;
  switch (subject.subjectType) {
    case 'customer':
      return { clause: `customer_id = ${ref}`, params: [subject.subjectId] };
    case 'actor':
      return { clause: `actor_id = ${ref}`, params: [subject.subjectId] };
    case 'ip':
      return { clause: `ip_address = ${ref}`, params: [subject.subjectId] };
    case 'gateway':
      return { clause: `source_table = 'webhook_events' AND channel = ${ref}`, params: [subject.subjectId] };
    default:
      // Closed scope: matches nothing, rather than accidentally matching everything.
      return { clause: 'false', params: [] };
  }
}

/** Loads a subject's events in the window, ascending by time, bounded by `limit`. */
export async function listEventsForSubject(
  db: Queryable,
  subject: SubjectKey,
  options: { since: Date; until: Date; limit: number }
): Promise<{ events: FraudEventRow[]; limitReached: boolean }> {
  const { clause, params } = subjectPredicate(subject, 3);
  const { rows } = await db.query<FraudEventRow>(
    `SELECT * FROM fraud_sentinel_events
     WHERE ${clause}
       AND occurred_at >= $1::timestamptz
       AND occurred_at <= $2::timestamptz
     ORDER BY occurred_at ASC, id ASC
     LIMIT $4`,
    [options.since.toISOString(), options.until.toISOString(), ...params, Math.max(1, Math.floor(options.limit)) + 1]
  );
  const limit = Math.max(1, Math.floor(options.limit));
  return { events: rows.slice(0, limit), limitReached: rows.length > limit };
}

/** One subject's full event history for a source-event-type set — used for baseline facts. */
export async function listBaselineFacts(
  db: Queryable,
  subject: SubjectKey,
  beforeIso: string
): Promise<{
  loginCount: number;
  countries: string[];
  clientFamilies: string[];
  firstLoginAt: string | null;
  lastLoginAt: string | null;
}> {
  const { clause, params } = subjectPredicate(subject, 2);
  const { rows } = await db.query<{
    login_count: number;
    countries: string[] | null;
    families: string[] | null;
    first_login_at: string | null;
    last_login_at: string | null;
  }>(
    `SELECT count(*)::int AS login_count,
            coalesce(array_agg(DISTINCT ip_country_code) FILTER (WHERE ip_country_code IS NOT NULL), '{}') AS countries,
            coalesce(array_agg(DISTINCT client_family) FILTER (WHERE client_family IS NOT NULL), '{}') AS families,
            min(occurred_at)::text AS first_login_at,
            max(occurred_at)::text AS last_login_at
     FROM fraud_sentinel_events
     WHERE ${clause}
       AND source_event_type = 'login_success'
       AND occurred_at < $1::timestamptz`,
    [beforeIso, ...params]
  );
  const row = rows[0];
  return {
    loginCount: row?.login_count ?? 0,
    countries: (row?.countries ?? []).filter((code): code is string => typeof code === 'string'),
    clientFamilies: (row?.families ?? []).filter((family): family is string => typeof family === 'string'),
    firstLoginAt: row?.first_login_at ?? null,
    lastLoginAt: row?.last_login_at ?? null,
  };
}

/** The oldest row currently in the ledger — used to report retention truncation honestly. */
export async function oldestLedgerEvent(db: Queryable): Promise<string | null> {
  const { rows } = await db.query<{ oldest: string | null }>(
    `SELECT min(occurred_at)::text AS oldest FROM fraud_sentinel_events`
  );
  return rows[0]?.oldest ?? null;
}

/**
 * Subjects worth assessing, most-recently-active first, bounded by `limit`.
 *
 * A subject only appears here if the ledger already holds an event for it inside the window: the scan
 * never invents a subject to assess, and an idle customer is not scanned at all.
 */
export async function listActiveSubjects(
  db: Queryable,
  options: { since: Date; until: Date; limit: number; subjectType?: SubjectType }
): Promise<SubjectKey[]> {
  const limit = Math.max(1, Math.floor(options.limit));
  const typeFilter = options.subjectType ? 'AND subject_type = $3' : '';
  const params: unknown[] = [options.since.toISOString(), options.until.toISOString()];
  if (options.subjectType) params.push(options.subjectType);
  const limitParam = `$${params.length + 1}`;

  const { rows } = await db.query<{ subject_type: SubjectType; key: string; last_seen: string; events: number }>(
    `WITH scoped AS (
       SELECT id, subject_type,
              CASE
                WHEN subject_type = 'customer' THEN customer_id::text
                WHEN subject_type = 'actor' THEN actor_id::text
                WHEN subject_type = 'ip' THEN ip_address
                WHEN subject_type = 'gateway' THEN channel
              END AS key,
              occurred_at
       FROM fraud_sentinel_events
       WHERE occurred_at >= $1::timestamptz
         AND occurred_at <= $2::timestamptz
       UNION ALL
       -- An administrator is a subject in their own right wherever the platform records them as the
       -- ACTOR, even when the row's own subject is a customer. auth_audit_log's admin_role_change,
       -- admin_status_change and manual_payment_* rows are projected as subject_type 'customer' with
       -- actor_id set, and those are exactly the kinds the ADM_* rules read; enumerating actor
       -- subjects only from rows already typed 'actor' (audit_logs, admin_support_sessions) would
       -- leave four of the eight administrator rules unreachable for an administrator whose recorded
       -- activity is a role change and nothing else.
       SELECT id, 'actor'::varchar AS subject_type, actor_id::text AS key, occurred_at
       FROM fraud_sentinel_events
       WHERE actor_id IS NOT NULL
         AND subject_type <> 'actor'
         AND occurred_at >= $1::timestamptz
         AND occurred_at <= $2::timestamptz
     )
     SELECT subject_type, key, max(occurred_at)::text AS last_seen, count(DISTINCT id)::int AS events
     FROM scoped
     WHERE key IS NOT NULL ${typeFilter}
     GROUP BY subject_type, key
     ORDER BY max(occurred_at) DESC, key ASC
     LIMIT ${limitParam}`,
    [...params, limit]
  );
  return rows
    .filter((row) => typeof row.key === 'string' && row.key.length > 0)
    .map((row) => ({ subjectType: row.subject_type, subjectId: row.key }));
}

/** IP addresses with enough auth activity to be worth assessing as their own subject. */
export async function listActiveIpSubjects(
  db: Queryable,
  options: { since: Date; until: Date; limit: number; minEvents: number }
): Promise<SubjectKey[]> {
  const { rows } = await db.query<{ ip_address: string }>(
    `SELECT ip_address
     FROM fraud_sentinel_events
     WHERE ip_address IS NOT NULL
       AND occurred_at >= $1::timestamptz AND occurred_at <= $2::timestamptz
     GROUP BY ip_address
     HAVING count(*) >= $3
     ORDER BY count(*) DESC, ip_address ASC
     LIMIT $4`,
    [
      options.since.toISOString(),
      options.until.toISOString(),
      Math.max(1, Math.floor(options.minEvents)),
      Math.max(1, Math.floor(options.limit)),
    ]
  );
  return rows.map((row) => ({ subjectType: 'ip' as const, subjectId: row.ip_address }));
}

/** Gateways that recorded webhook activity in the window. */
export async function listActiveGatewaySubjects(
  db: Queryable,
  options: { since: Date; until: Date; limit: number }
): Promise<SubjectKey[]> {
  const { rows } = await db.query<{ channel: string }>(
    `SELECT channel
     FROM fraud_sentinel_events
     WHERE source_table = 'webhook_events' AND channel IS NOT NULL
       AND occurred_at >= $1::timestamptz AND occurred_at <= $2::timestamptz
     GROUP BY channel
     ORDER BY count(*) DESC, channel ASC
     LIMIT $3`,
    [options.since.toISOString(), options.until.toISOString(), Math.max(1, Math.floor(options.limit))]
  );
  return rows.map((row) => ({ subjectType: 'gateway' as const, subjectId: row.channel }));
}

/** Events for one customer, for the transaction/order investigation screen. */
export async function listEventsForCustomer(
  db: Queryable,
  customerId: string,
  options: { limit: number; offset: number; category?: FraudCategory | null }
): Promise<{ items: FraudEventRow[]; total: number }> {
  const categoryFilter = options.category ? 'AND category = $3' : '';
  const params: unknown[] = [customerId, options.limit];
  if (options.category) params.push(options.category);
  const { rows } = await db.query<FraudEventRow>(
    `SELECT * FROM fraud_sentinel_events
     WHERE customer_id = $1 ${categoryFilter}
     ORDER BY occurred_at DESC, id DESC
     LIMIT $2 OFFSET $${params.length + 1}`,
    [...params, options.offset]
  );
  const countParams: unknown[] = [customerId];
  const countFilter = options.category ? 'AND category = $2' : '';
  if (options.category) countParams.push(options.category);
  const { rows: countRows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM fraud_sentinel_events WHERE customer_id = $1 ${countFilter}`,
    countParams
  );
  return { items: rows, total: countRows[0]?.total ?? 0 };
}

/**
 * Retention: prunes the derived event ledger only.
 *
 * The authoritative rows stay in their own tables forever — this ledger is a projection, and pruning
 * it never destroys a source record. Alerts, assessments referenced by an alert, investigations and
 * false-positive reports are NOT pruned here: they are the audit trail.
 */
export async function pruneEvents(db: Queryable, olderThan: Date): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM fraud_sentinel_events
     WHERE occurred_at < $1::timestamptz
     RETURNING id`,
    [olderThan.toISOString()]
  );
  return rows.length;
}
