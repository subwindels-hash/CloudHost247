/**
 * Fraud Sentinel detection, ingestion idempotency, the financial-safety boundary and the background
 * jobs — exercised against a real embedded Postgres (PGlite) with the full committed migration chain.
 *
 * Everything here runs on REAL rows in REAL platform tables: a `payments` row declined by a gateway,
 * an `auth_audit_log` login failure, a `webhook_events` delivery, an `orders` row. No fixture stands
 * in for the schema, because the claim under test is precisely "this module reads what CloudHost247
 * already records and invents no telemetry of its own".
 *
 * The two properties that must never regress are asserted structurally rather than by inspection:
 *   * NO FINANCIAL WRITES — a full scan, an alert lifecycle and a retention pass leave every row of
 *     every financial and identity table byte-identical;
 *   * NO FINANCIAL IMPORTS — the module's source imports no payment gateway, billing service or WHMCS
 *     client, and contains no INSERT/UPDATE/DELETE naming a financial table.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { ingestNewEvents, listActiveSubjects } from '../../src/fraud-sentinel/repositories/events-repo';
import { findOpenAlertByDedupeKey, listAlerts } from '../../src/fraud-sentinel/repositories/alerts-repo';
import { listAssessments } from '../../src/fraud-sentinel/repositories/assessments-repo';
import { claimRun, EMPTY_COUNTERS, finishRun, manualRunKey, reclaimStaleRuns } from '../../src/fraud-sentinel/repositories/runs-repo';
import { applyRetention, runFraudScan } from '../../src/fraud-sentinel/services/scan-service';
import { executeJob } from '../../src/fraud-sentinel/jobs/runner';
import { runFraudSentinelCycle } from '../../src/fraud-sentinel/jobs/scheduler';
import { FS_JOB_SCAN } from '../../src/fraud-sentinel/jobs/definitions';
import { findUnredactedSecret } from '../../src/fraud-sentinel/utils/redaction';
import { CLOSED_SCOPE } from '../../src/fraud-sentinel/types';

const MODULE_DIR = path.join(process.cwd(), 'src', 'fraud-sentinel');

/** Tables this module must never write to — the authorization's financial-safety clause, as SQL. */
const FINANCIAL_TABLES = [
  'payments',
  'invoices',
  'orders',
  'order_items',
  'billing_ledger',
  'customer_services',
  'users',
] as const;

/** Every `.ts` file in the module, read from disk. */
function moduleSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts')) files.push(full);
    }
  };
  walk(MODULE_DIR);
  return files;
}

describe('Fraud Sentinel detection (integration)', () => {
  let db: PGlite;
  /** A fixed evaluation instant, so windows, buckets and retention are all reproducible. */
  const NOW = new Date('2026-03-15T12:00:00.000Z');

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  /* ---------------------------------------------------------------- fixtures */

  const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
  const hoursBefore = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
  const daysBefore = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

  async function seedCustomer(email: string, role: 'customer' | 'admin' | 'super_admin' = 'customer') {
    const id = randomUUID();
    // An account that is 400 days old: "new account" rules must not fire on the fixtures below.
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1,$2,'hash',$3,$4,'active',$5::timestamptz,$5::timestamptz)`,
      [id, email, `User ${email}`, role, daysBefore(400).toISOString()]
    );
    return id;
  }

  /** An order + its invoice, timestamped inside the lookback window. */
  async function seedInvoice(userId: string, amount: string, at: Date, currency = 'USD') {
    const orderId = randomUUID();
    const invoiceId = randomUUID();
    await db.query(
      `INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$4,'completed','unpaid',$5::timestamptz,$5::timestamptz)`,
      [orderId, userId, currency, amount, at.toISOString()]
    );
    await db.query(
      `INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status, due_date, issued_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$5,'unpaid',CURRENT_DATE + 7,$6::timestamptz,$6::timestamptz,$6::timestamptz)`,
      [invoiceId, orderId, userId, currency, amount, at.toISOString()]
    );
    return { orderId, invoiceId };
  }

  /** A real `payments` row, with the timestamps the gateway would have set. */
  async function seedPayment(
    userId: string,
    invoiceId: string,
    options: { status: string; amount: string; at: Date; currency?: string; provider?: string; failureReason?: string }
  ) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO payments (id, invoice_id, user_id, provider, provider_reference, method, amount, currency,
                             status, failure_reason, initiated_at, completed_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'card',$6,$7,$8,$9,$10::timestamptz,$10::timestamptz,$10::timestamptz,$10::timestamptz)`,
      [
        id,
        invoiceId,
        userId,
        options.provider ?? 'paystack',
        `ref_${id.slice(0, 8)}`,
        options.amount,
        options.currency ?? 'USD',
        options.status,
        options.failureReason ?? null,
        options.at.toISOString(),
      ]
    );
    return id;
  }

  async function seedAuthEvent(
    userId: string | null,
    eventType: string,
    options: { at: Date; ip?: string | null; userAgent?: string | null; metadata?: Record<string, unknown> }
  ) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO auth_audit_log (id, user_id, event_type, ip_address, user_agent, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz)`,
      [
        id,
        userId,
        eventType,
        options.ip ?? null,
        options.userAgent ?? null,
        JSON.stringify(options.metadata ?? {}),
        options.at.toISOString(),
      ]
    );
    return id;
  }

  async function seedWebhookEvent(options: {
    gateway: string;
    eventId: string;
    payloadHash: string;
    status: string;
    at: Date;
    paymentId?: string | null;
  }) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO webhook_events (id, gateway, event_id, event_type, status, payload_hash, lease_expires_at, received_at, payment_id)
       VALUES ($1,$2,$3,'charge.success',$4,$5,$6::timestamptz + interval '60 seconds',$6::timestamptz,$7)`,
      [id, options.gateway, options.eventId, options.status, options.payloadHash, options.at.toISOString(), options.paymentId ?? null]
    );
    return id;
  }

  /**
   * The recorded shape of automated card testing: three declines twenty minutes apart on one invoice,
   * then a single approval. This is the fixture most of the suite reasons about.
   */
  async function seedCardTestingCustomer(email = 'card-testing@example.test') {
    const userId = await seedCustomer(email);
    const { invoiceId } = await seedInvoice(userId, '49.99', hoursBefore(2));
    await seedPayment(userId, invoiceId, { status: 'failed', amount: '49.99', at: minutesBefore(60), failureReason: 'card_declined' });
    await seedPayment(userId, invoiceId, { status: 'failed', amount: '49.99', at: minutesBefore(40), failureReason: 'card_declined' });
    await seedPayment(userId, invoiceId, { status: 'failed', amount: '49.99', at: minutesBefore(20), failureReason: 'card_declined' });
    await seedPayment(userId, invoiceId, { status: 'successful', amount: '49.99', at: minutesBefore(10) });
    return { userId, invoiceId };
  }

  async function countRows(table: string): Promise<number> {
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
    return Number(rows[0]?.n ?? 0);
  }

  /** A stable, comparable dump of a table's contents: the financial-safety snapshot. */
  async function snapshot(table: string): Promise<string> {
    const { rows } = await db.query<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY 1`);
    return JSON.stringify(
      rows.map((row) =>
        Object.keys(row)
          .sort()
          .map((key) => [key, row[key] instanceof Date ? (row[key] as Date).toISOString() : row[key]])
      )
    );
  }

  const UNRESTRICTED = { unrestricted: true, customerIds: [] as string[] };

  /* ------------------------------------------------------- financial safety */

  it('writes nothing to any financial or identity table across a full investigation cycle', async () => {
    const { userId } = await seedCardTestingCustomer();
    const reviewer = await seedCustomer('reviewer@example.test', 'admin');
    const before = new Map<string, string>();
    for (const table of FINANCIAL_TABLES) before.set(table, await snapshot(table));

    const report = await runFraudScan(db, { now: NOW });
    expect(report.alertsCreated).toBe(1);

    // A reviewer then works the alert through its whole lifecycle: claim it, resolve it, retain.
    const alerts = await listAlerts(db, { page: 1, limit: 10, scope: UNRESTRICTED });
    const alert = alerts.items[0];
    expect(alert).toBeDefined();
    if (alert) {
      await db.query(
        `UPDATE fraud_sentinel_alerts
            SET status = 'under_review', assigned_reviewer_id = $2, assigned_at = now(), updated_at = now()
          WHERE id = $1`,
        [alert.id, reviewer]
      );
      await db.query(
        `UPDATE fraud_sentinel_alerts
            SET status = 'resolved', resolved_at = now(), resolution_note = 'confirmed with the customer by phone', updated_at = now()
          WHERE id = $1`,
        [alert.id]
      );
    }
    await applyRetention(db, { now: NOW });

    for (const table of FINANCIAL_TABLES) {
      expect(await snapshot(table), `${table} was modified by Fraud Sentinel`).toBe(before.get(table));
    }
    // The module's own tables did change — this is not a "nothing happened" pass.
    expect(await countRows('fraud_sentinel_alerts')).toBe(1);
    expect(await countRows('fraud_sentinel_assessments')).toBeGreaterThan(0);
    // userId is referenced so the fixture reads as "the customer under investigation".
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('imports no payment gateway, billing service or WHMCS client', () => {
    const files = moduleSourceFiles();
    expect(files.length).toBeGreaterThan(10);

    // Any of these imports would give the module a code path that moves money or changes an
    // entitlement. The assertion is on the module's source, so it also fails on a future refactor
    // that reaches for a billing helper "just to check something".
    // `src/services/notification-service` is deliberately NOT on this list: it is the platform's own
    // in-app notification writer, reused so reviewer alerts land in the existing notification centre.
    // It has no path to a payment, a balance or an entitlement.
    const forbiddenImports = [
      /from\s+'[^']*\/payments\//,
      /from\s+'[^']*payment-service'/,
      /from\s+'[^']*billing-service'/,
      /from\s+'[^']*\/whmcs\//,
      /from\s+'[^']*order-service'/,
      /from\s+'[^']*subscription-service'/,
      /require\(\s*'[^']*payment/,
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbiddenImports) {
        if (pattern.test(source)) offenders.push(`${path.relative(process.cwd(), file)} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('contains no INSERT, UPDATE or DELETE naming a financial table', () => {
    const offenders: string[] = [];
    for (const file of moduleSourceFiles()) {
      // Comments and prose are stripped first, so the assertion is about executable SQL strings rather
      // than about documentation that explains what the module refuses to do.
      const source = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join('\n');
      for (const table of FINANCIAL_TABLES) {
        const pattern = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'i');
        if (pattern.test(source)) offenders.push(`${path.relative(process.cwd(), file)} writes to ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /* ------------------------------------------------------------- ingestion */

  it('projects recorded rows into the ledger and never projects the same state twice', async () => {
    await seedCardTestingCustomer();

    const first = await ingestNewEvents(db, { since: daysBefore(31), limitPerTable: 5000 });
    expect(first.ingested).toBeGreaterThan(0);
    expect(first.skippedSources).toEqual([]);
    const eventsAfterFirst = await countRows('fraud_sentinel_events');
    expect(eventsAfterFirst).toBe(first.ingested);
    // 4 payment states + 1 order + 1 invoice, and nothing invented.
    expect(eventsAfterFirst).toBe(6);

    // Re-running over the same window projects nothing new: the dedupe key makes it a no-op.
    const second = await ingestNewEvents(db, { since: daysBefore(31), limitPerTable: 5000 });
    expect(second.ingested).toBe(0);
    expect(await countRows('fraud_sentinel_events')).toBe(eventsAfterFirst);

    // A NEW observable state on the same payment row IS projected: one event per state change.
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM payments WHERE status = 'successful' LIMIT 1`);
    const paymentId = String(rows[0]?.id ?? '');
    await db.query(`UPDATE payments SET status = 'refunded', updated_at = now() WHERE id = $1::uuid`, [paymentId]);
    const third = await ingestNewEvents(db, { since: daysBefore(31), limitPerTable: 5000 });
    expect(third.ingested).toBe(1);
    const { rows: refunded } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM fraud_sentinel_events WHERE source_id = $1`,
      [paymentId]
    );
    expect(Number(refunded[0]?.n)).toBe(2); // the successful state, plus the refunded state
  });

  it('stores no secret in projected evidence, even when the source row carries one', async () => {
    const userId = await seedCustomer('leaky@example.test');
    const { invoiceId } = await seedInvoice(userId, '250.00', hoursBefore(1));
    // A gateway decline message that echoes a card number and a bearer token — exactly the kind of
    // free text a provider can put in `failure_reason`, and the reason the deny-list exists.
    await seedPayment(userId, invoiceId, {
      status: 'failed',
      amount: '250.00',
      at: minutesBefore(30),
      failureReason:
        'declined for card 4242424242424242 (auth: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U)',
    });
    await seedAuthEvent(userId, 'login_failure', {
      at: minutesBefore(20),
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      metadata: { resetToken: 'super-secret-value', password: 'hunter2' },
    });

    await ingestNewEvents(db, { since: daysBefore(31), limitPerTable: 5000 });

    const { rows } = await db.query<{ id: string; evidence: unknown }>(`SELECT id, evidence FROM fraud_sentinel_events`);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(findUnredactedSecret(row.evidence, `event ${String(row.id)}`)).toBeNull();
      const text = JSON.stringify(row.evidence);
      expect(text).not.toContain('4242424242424242');
      expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(text).not.toContain('super-secret-value');
      expect(text).not.toContain('hunter2');
      // The raw user agent is never stored; only its coarse client family is.
      expect(text).not.toContain('Mozilla/5.0');
    }
    const { rows: agents } = await db.query<{ n: number; family: string | null }>(
      `SELECT count(*)::int AS n, max(client_family) AS family
       FROM fraud_sentinel_events WHERE source_table = 'auth_audit_log'`
    );
    expect(Number(agents[0]?.n)).toBe(1);
    expect(typeof agents[0]?.family).toBe('string');
  });

  it('reports a source it cannot read instead of treating it as empty', async () => {
    await seedCardTestingCustomer();
    await ingestNewEvents(db, { since: daysBefore(31), limitPerTable: 5000 });
    // Drop one source table. On a deployment where a quarantined migration was never applied this is
    // the real situation, and ingestion must NAME the gap rather than score the subject on partial
    // data as though nothing were missing. (Ephemeral test database only.)
    await db.query(`DROP TABLE tool_abuse_events`);
    const outcome = await ingestNewEvents(db, { since: daysBefore(31), limitPerTable: 5000 });
    const skipped = outcome.skippedSources.find((entry) => entry.table === 'tool_abuse_events');
    expect(skipped).toBeDefined();
    expect(skipped?.reason.length).toBeGreaterThan(0);
    // The readable sources still ingested normally: one bad table does not fail the pass.
    expect(outcome.ingested).toBe(0);
    expect(outcome.perTable.filter((entry) => entry.ingested > 0)).toEqual([]);
  });

  it('enumerates only subjects that actually have recorded events', async () => {
    const active = await seedCardTestingCustomer('active@example.test');
    const idle = await seedCustomer('idle@example.test'); // registers, then does nothing at all
    await ingestNewEvents(db, { since: daysBefore(31), limitPerTable: 5000 });

    const subjects = await listActiveSubjects(db, { since: daysBefore(30), until: NOW, limit: 100 });
    const ids = subjects.map((subject) => subject.subjectId);
    expect(ids).toContain(active.userId);
    expect(ids).not.toContain(idle);
    expect(subjects.every((subject) => subject.subjectId.length > 0)).toBe(true);
    expect(subjects.every((subject) => ['customer', 'actor', 'ip', 'gateway'].includes(subject.subjectType))).toBe(true);
  });

  /* ------------------------------------------------------------- detection */

  it('detects card testing end to end and raises one alert backed by real rows', async () => {
    const { userId } = await seedCardTestingCustomer();
    const report = await runFraudScan(db, { now: NOW });

    expect(report.enabled).toBe(true);
    expect(report.ingestion.ingested).toBe(6);
    expect(report.subjectsConsidered).toBe(1);
    expect(report.assessmentsCreated).toBe(1);
    expect(report.alertsCreated).toBe(1);
    expect(report.failures).toEqual([]);
    expect(report.window.endedAt).toBe(NOW.toISOString());

    const assessments = await listAssessments(db, { page: 1, limit: 10, customerId: userId, scope: UNRESTRICTED });
    const assessment = assessments.items[0];
    expect(assessment).toBeDefined();
    if (!assessment) throw new Error('no assessment stored');

    const codes = assessment.triggered_rules.map((rule) => rule.code);
    expect(codes).toContain('PAY_SUCCESS_AFTER_FAILURES');
    expect(codes).toContain('PAY_FAILURE_BURST');
    expect(codes).toContain('PAY_REPEATED_FAILURES');

    // The family cap is the anti-double-counting mechanism: 22 + 18 + 12 = 52 raw, 30 credited. Three
    // rules describing ONE decline pattern must not score like three unrelated problems.
    const family = assessment.family_contributions.find((entry) => entry.family === 'payment_failures');
    expect(family?.raw).toBe(52);
    expect(family?.capped).toBe(30);
    expect(family?.cap).toBe(30);
    expect(assessment.risk_score).toBe(30);
    expect(assessment.risk_level).toBe('medium'); // threshold for high is 50
    expect(assessment.status).toBe('active');
    expect(assessment.rule_set_version).toMatch(/^[0-9a-f]{16}$/);
    expect(assessment.scoring_version).toBeGreaterThanOrEqual(1);
    expect(assessment.events_examined).toBe(6);
    expect(assessment.previous_score).toBeNull();
    expect(Date.parse(assessment.window_started_at)).toBeLessThan(Date.parse(assessment.window_ended_at));
    expect(assessment.data_quality.every((flag) => ['material', 'informational'].includes(flag.severity))).toBe(true);
    // Every recommendation carries its rule code, and the last one states the boundary.
    expect(assessment.recommendations.length).toBeGreaterThan(0);
    expect(assessment.recommendations.every((line) => line.startsWith('['))).toBe(true);
    expect(assessment.recommendations.at(-1)).toBe(
      '[BOUNDARY] Fraud Sentinel is advisory: it has taken no action on any payment, order, balance, entitlement or account status. ' +
        'Any enforcement goes through the existing authorized workflow with human approval and audit logging.'
    );

    const alerts = await listAlerts(db, { page: 1, limit: 10, scope: UNRESTRICTED });
    const alert = alerts.items[0];
    expect(alert).toBeDefined();
    if (!alert) throw new Error('no alert raised');
    expect(alert.alert_number).toMatch(/^FS-\d{8}$/);
    expect(alert.status).toBe('new');
    expect(alert.category).toBe('payment');
    expect(alert.primary_rule_code).toBe('PAY_SUCCESS_AFTER_FAILURES');
    expect(alert.customer_id).toBe(userId);
    expect(alert.subject_type).toBe('customer');
    expect(alert.risk_score).toBe(30);
    expect(alert.risk_level).toBe('medium');
    expect(alert.recurrence_count).toBe(1);
    expect(alert.assessment_id).toBe(assessment.id);
    expect(alert.title).toContain('PAY_SUCCESS_AFTER_FAILURES');
    // The level is below alert_min_level ('high') and the alert exists anyway, because a rule of
    // critical severity fired — the second alerting path, and the reason the explanation says so.
    expect(alert.explanation).toContain('Family contributions — payment_failures 30/52 (cap 30).');
    expect(alert.explanation).toContain('Total 30/100 → MEDIUM');
    expect(alert.explanation).toContain('advisory assessment');

    // Evidence points at real rows, carries timestamps, and names no secret.
    expect(assessment.evidence.length).toBe(4); // the four distinct payments rows, deduplicated
    for (const ref of assessment.evidence) {
      expect(ref.table).toBe('payments');
      expect(ref.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(ref.occurredAt).toBeTruthy();
      expect(ref.description.length).toBeGreaterThan(10);
      expect(findUnredactedSecret(ref, 'evidence')).toBeNull();
      const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM payments WHERE id = $1`, [ref.id]);
      expect(Number(rows[0]?.n), `evidence cites a payments row that does not exist: ${ref.id}`).toBe(1);
    }

    // The investigation timeline opens with the alert's creation, attributed to the system.
    const { rows: timeline } = await db.query<{ action: string; actor_type: string; to_status: string | null }>(
      `SELECT action, actor_type, to_status FROM fraud_sentinel_investigations WHERE alert_id = $1::uuid ORDER BY created_at`,
      [alert.id]
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.action).toBe('created');
    expect(timeline[0]?.actor_type).toBe('system');
    expect(timeline[0]?.to_status).toBe('new');

    // One risk-history point per stored assessment, so the trend line cannot be inflated by re-scans.
    const { rows: history } = await db.query<{ risk_score: number; risk_level: string; primary_reason_code: string | null }>(
      `SELECT risk_score, risk_level, primary_reason_code FROM fraud_sentinel_risk_history WHERE customer_id = $1::uuid`,
      [userId]
    );
    expect(history).toHaveLength(1);
    expect(Number(history[0]?.risk_score)).toBe(30);
    expect(history[0]?.risk_level).toBe('medium');
    expect(history[0]?.primary_reason_code).toBe('PAY_SUCCESS_AFTER_FAILURES');
  });

  it('does not re-store an unchanged assessment or inflate recurrence on a quiet re-scan', async () => {
    await seedCardTestingCustomer();
    const first = await runFraudScan(db, { now: NOW });
    expect(first.assessmentsCreated).toBe(1);
    expect(first.alertsCreated).toBe(1);

    // Same recorded data, a later pass: nothing new to say, so nothing is written. A 15-minute
    // cadence must not manufacture a risk history or bump recurrence_count for an unchanged finding.
    const second = await runFraudScan(db, { now: new Date(NOW.getTime() + 15 * 60_000) });
    expect(second.assessmentsCreated).toBe(0);
    expect(second.assessmentsUnchanged).toBe(1);
    expect(second.alertsCreated).toBe(0);
    expect(second.alertsUpdated).toBe(0);
    expect(await countRows('fraud_sentinel_assessments')).toBe(1);
    expect(await countRows('fraud_sentinel_risk_history')).toBe(1);

    const alerts = await listAlerts(db, { page: 1, limit: 5, scope: UNRESTRICTED });
    expect(alerts.items[0]?.recurrence_count).toBe(1);
  });

  it('refreshes the open alert instead of duplicating it when the same condition recurs', async () => {
    const { userId, invoiceId } = await seedCardTestingCustomer();
    await runFraudScan(db, { now: NOW });
    const before = await listAlerts(db, { page: 1, limit: 5, scope: UNRESTRICTED });
    const originalAlert = before.items[0];
    expect(originalAlert).toBeDefined();
    if (!originalAlert) throw new Error('no alert');

    // Another declined attempt on the same invoice: same underlying condition, new recorded evidence.
    await seedPayment(userId, invoiceId, { status: 'failed', amount: '49.99', at: minutesBefore(2), failureReason: 'card_declined' });
    const second = await runFraudScan(db, { now: new Date(NOW.getTime() + 30 * 60_000) });

    expect(second.alertsCreated).toBe(0); // dedupe: one OPEN alert per subject + primary rule
    expect(second.alertsUpdated).toBe(1);
    expect(second.assessmentsCreated).toBe(1); // the finding DID change, so it is stored

    const after = await listAlerts(db, { page: 1, limit: 5, scope: UNRESTRICTED });
    expect(after.total).toBe(1);
    expect(after.items[0]?.id).toBe(originalAlert.id);
    expect(after.items[0]?.alert_number).toBe(originalAlert.alert_number); // the reviewer's reference is stable
    expect(after.items[0]?.recurrence_count).toBe(2);
    expect(after.items[0]?.status).toBe('new');
    expect(await countRows('fraud_sentinel_alerts')).toBe(1);

    // The earlier assessment is superseded, not overwritten, so the first finding stays reproducible.
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM fraud_sentinel_assessments ORDER BY assessed_at ASC, created_at ASC`
    );
    expect(rows.map((row) => row.status)).toEqual(['superseded', 'active']);
    const active = await listAssessments(db, { page: 1, limit: 5, customerId: userId, status: 'active', scope: UNRESTRICTED });
    expect(active.total).toBe(1);
    expect(Number(active.items[0]?.risk_score)).toBe(30); // still capped: one more decline, same family
    expect(active.items[0]?.events_examined).toBe(7);
  });

  it('raises a NEW alert with its own number once a human closed the previous one', async () => {
    const { userId, invoiceId } = await seedCardTestingCustomer();
    await runFraudScan(db, { now: NOW });
    const first = await listAlerts(db, { page: 1, limit: 5, scope: UNRESTRICTED });
    const firstAlert = first.items[0];
    expect(firstAlert).toBeDefined();
    if (!firstAlert) throw new Error('no alert');

    await db.query(
      `UPDATE fraud_sentinel_alerts
          SET status = 'false_positive', resolved_at = now(), resolution_note = 'customer confirmed the attempts', updated_at = now()
        WHERE id = $1`,
      [firstAlert.id]
    );
    // A closed alert frees its dedupe key, so a genuine recurrence becomes a new work item.
    expect(await findOpenAlertByDedupeKey(db, firstAlert.dedupe_key)).toBeNull();

    await seedPayment(userId, invoiceId, { status: 'failed', amount: '49.99', at: minutesBefore(1), failureReason: 'card_declined' });
    const second = await runFraudScan(db, { now: new Date(NOW.getTime() + 60 * 60_000) });
    expect(second.alertsCreated).toBe(1);

    const after = await listAlerts(db, { page: 1, limit: 5, scope: UNRESTRICTED });
    expect(after.total).toBe(2);
    const numbers = after.items.map((alert) => alert.alert_number);
    expect(new Set(numbers).size).toBe(2);
    expect(numbers.every((number) => /^FS-\d{8}$/.test(number))).toBe(true);
    expect(after.items.map((alert) => alert.status).sort()).toEqual(['false_positive', 'new']);
  });

  it('stores an assessment but raises no alert when the score stays below the configured minimum', async () => {
    const userId = await seedCustomer('quiet-declines@example.test');
    const { invoiceId } = await seedInvoice(userId, '15.00', daysBefore(10));
    // Three declines spread over days: PAY_REPEATED_FAILURES (12) fires, the 60-minute burst rule does
    // not, and no critical rule fires — 12 points is below the medium threshold of 25.
    await seedPayment(userId, invoiceId, { status: 'failed', amount: '15.00', at: daysBefore(9), failureReason: 'insufficient_funds' });
    await seedPayment(userId, invoiceId, { status: 'failed', amount: '15.00', at: daysBefore(5), failureReason: 'insufficient_funds' });
    await seedPayment(userId, invoiceId, { status: 'failed', amount: '15.00', at: daysBefore(1), failureReason: 'insufficient_funds' });

    const report = await runFraudScan(db, { now: NOW });
    expect(report.assessmentsCreated).toBe(1);
    expect(report.alertsCreated).toBe(0);
    expect(report.notificationsSent).toBe(0);

    const assessments = await listAssessments(db, { page: 1, limit: 5, customerId: userId, scope: UNRESTRICTED });
    const assessment = assessments.items[0];
    expect(assessment?.triggered_rules.map((rule) => rule.code)).toEqual(['PAY_REPEATED_FAILURES']);
    expect(assessment?.risk_level).toBe('low');
    expect(assessment?.risk_score).toBe(12);
    expect(await countRows('fraud_sentinel_alerts')).toBe(0);
    // The finding is still on the record and visible in the customer's risk profile.
    expect(await countRows('fraud_sentinel_risk_history')).toBe(1);
  });

  it('detects an account-takeover shape from auth_audit_log alone', async () => {
    const userId = await seedCustomer('security@example.test');
    // A baseline of familiar logins recorded BEFORE the lookback window.
    for (let index = 0; index < 5; index += 1) {
      await seedAuthEvent(userId, 'login_success', {
        at: daysBefore(60 + index),
        ip: '197.210.0.5',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      });
    }
    // Inside the window: a failure cluster, then a success from elsewhere, then the second factor goes.
    for (let index = 0; index < 6; index += 1) {
      await seedAuthEvent(userId, 'login_failure', {
        at: minutesBefore(90 - index),
        ip: '203.0.113.9',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      });
    }
    await seedAuthEvent(userId, 'login_success', {
      at: minutesBefore(30),
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    });
    await seedAuthEvent(userId, 'mfa_disabled', { at: minutesBefore(25), ip: '203.0.113.9' });

    const report = await runFraudScan(db, { now: NOW });
    expect(report.failures).toEqual([]);
    expect(report.alertsCreated).toBe(1);

    const assessments = await listAssessments(db, { page: 1, limit: 5, customerId: userId, scope: UNRESTRICTED });
    const assessment = assessments.items[0];
    const codes = assessment?.triggered_rules.map((rule) => rule.code) ?? [];
    expect(codes).toContain('ACC_LOGIN_FAILURE_CLUSTER');
    expect(codes).toContain('ACC_MFA_TAMPERING');
    // account_auth 14 (cap 30) + account_change 22 (cap 24) = 36 → medium; the critical MFA rule is
    // what earns the reviewer's attention.
    expect(assessment?.risk_score).toBe(36);
    expect(assessment?.risk_level).toBe('medium');

    const alerts = await listAlerts(db, { page: 1, limit: 5, customerId: userId, scope: UNRESTRICTED });
    expect(alerts.items[0]?.category).toBe('account_security');
    expect(alerts.items[0]?.primary_rule_code).toBe('ACC_MFA_TAMPERING'); // highest credited weight
    expect(alerts.items[0]?.explanation).toContain('account_change 22/22 (cap 24)');
    // The raw user agent was classified, never copied into the ledger.
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM fraud_sentinel_events WHERE evidence::text ILIKE '%Mozilla%'`
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('assesses an administrator as an actor subject and keeps the finding attributable', async () => {
    const adminId = await seedCustomer('admin@example.test', 'admin');
    for (let index = 0; index < 3; index += 1) {
      await seedAuthEvent(adminId, 'admin_role_change', {
        at: hoursBefore(3 - index),
        ip: '197.210.0.9',
        metadata: { targetUserId: randomUUID(), role: index % 2 === 0 ? 'admin' : 'super_admin' },
      });
    }
    const report = await runFraudScan(db, { now: NOW });
    expect(report.failures).toEqual([]);
    // Two subjects out of one administrator: the account as a CUSTOMER (auth_audit_log records them as
    // the row's user) and the same account as the ACTOR who made the changes. The ADM_* rules apply
    // only to the actor subject, so an actor subject has to be enumerated from the actor_id the
    // platform already records — otherwise four of the eight administrator rules could never fire.
    expect(report.subjectsConsidered).toBe(2);

    const { rows } = await db.query<{ subject_type: string; risk_score: number; risk_level: string; customer_id: string | null }>(
      `SELECT subject_type, risk_score, risk_level, customer_id FROM fraud_sentinel_assessments WHERE subject_type = 'actor'`
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.risk_score)).toBe(30); // admin_activity cap: 14 + 22 = 36 → 30
    expect(rows[0]?.risk_level).toBe('medium');
    // An actor subject IS a user, so the finding stays attributable to that account.
    expect(rows[0]?.customer_id).toBe(adminId);

    const alerts = await listAlerts(db, { page: 1, limit: 5, subjectType: 'actor', scope: UNRESTRICTED });
    expect(alerts.total).toBe(1);
    expect(alerts.items[0]?.primary_rule_code).toBe('ADM_PERMISSION_CHANGE_BURST');
    expect(alerts.items[0]?.category).toBe('admin_api');
    // A uuid subject keeps its identity in subject_id; subject_label is reserved for subjects that are
    // not a uuid row (an IP address, a gateway name). The human-readable label goes in the title.
    expect(alerts.items[0]?.subject_label).toBeNull();
    expect(alerts.items[0]?.subject_id).toBe(adminId);
    expect(alerts.items[0]?.title).toContain('staff/administrator account');
  });

  it('detects one webhook payload presented under several event ids, as a gateway subject', async () => {
    // A sha256 payload fingerprint: real evidence for the replay rule, and deliberately preserved by
    // redaction because a digest is not a credential.
    const payloadHash = '9f2c1a7b4e8d3056c1a9f2b7e4d8036c5a1f9b2e7d4086c3a5f19b2e7d40863a';
    for (let index = 0; index < 3; index += 1) {
      await seedWebhookEvent({
        gateway: 'paystack',
        eventId: `evt_${1000 + index}`,
        payloadHash,
        status: 'completed',
        at: minutesBefore(9 - index),
      });
    }
    const report = await runFraudScan(db, { now: NOW });
    expect(report.failures).toEqual([]);

    const { rows } = await db.query<{ subject_type: string; subject_id: string | null; subject_label: string | null; customer_id: string | null }>(
      `SELECT subject_type, subject_id, subject_label, customer_id FROM fraud_sentinel_assessments WHERE subject_type = 'gateway'`
    );
    expect(rows).toHaveLength(1);
    // A gateway is a NAME, not a uuid row: it lives in subject_label and subject_id stays null rather
    // than forcing a non-uuid into a uuid column.
    expect(rows[0]?.subject_label).toBe('paystack');
    expect(rows[0]?.subject_id).toBeNull();
    expect(rows[0]?.customer_id).toBeNull();

    const alerts = await listAlerts(db, { page: 1, limit: 5, subjectType: 'gateway', scope: UNRESTRICTED });
    expect(alerts.total).toBe(1);
    expect(alerts.items[0]?.primary_rule_code).toBe('API_WEBHOOK_REPLAY');
    expect(alerts.items[0]?.category).toBe('admin_api');
    expect(alerts.items[0]?.risk_score).toBe(20);
    expect(alerts.items[0]?.explanation).toContain(payloadHash);
    // The rule text states the platform's own limit honestly rather than claiming coverage it lacks.
    expect(alerts.items[0]?.explanation).toContain('UNIQUE(gateway, event_id)');

    // A platform-level subject has no customer, so it is invisible to any scoped (non-admin) caller.
    const scoped = await listAlerts(db, {
      page: 1,
      limit: 5,
      scope: { unrestricted: false, customerIds: [randomUUID()] },
    });
    expect(scoped.items).toEqual([]);
  });

  it('reads current unpaid orders from live state rather than from a stale ledger snapshot', async () => {
    const userId = await seedCustomer('unpaid@example.test');
    for (let index = 0; index < 6; index += 1) {
      await db.query(
        `INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status, created_at, updated_at)
         VALUES ($1,$2,'USD','100.00','100.00','pending','unpaid',$3::timestamptz,$3::timestamptz)`,
        [randomUUID(), userId, hoursBefore(6 - index).toISOString()]
      );
    }
    await runFraudScan(db, { now: NOW });
    const assessments = await listAssessments(db, { page: 1, limit: 5, customerId: userId, scope: UNRESTRICTED });
    const codes = assessments.items[0]?.triggered_rules.map((rule) => rule.code) ?? [];
    expect(codes).toContain('ORD_UNPAID_ACCUMULATION');
    // The rule counts live `orders` rows but its evidence comes from ledger snapshots, and it says so.
    const flags = assessments.items[0]?.data_quality.map((flag) => flag.code) ?? [];
    expect(flags).toContain('SNAPSHOT_VS_LIVE_STATE');
    expect(assessments.items[0]?.triggered_rules.find((rule) => rule.code === 'ORD_UNPAID_ACCUMULATION')?.reason).toContain(
      'Read live from the orders table'
    );

    // Paying the orders off removes the finding on the next pass: the rule follows live state, so an
    // assessment can never keep accusing a customer who has already settled.
    await db.query(`UPDATE orders SET payment_status = 'paid', updated_at = now() WHERE user_id = $1`, [userId]);
    await runFraudScan(db, { now: new Date(NOW.getTime() + 60 * 60_000) });
    const later = await listAssessments(db, { page: 1, limit: 5, customerId: userId, status: 'active', scope: UNRESTRICTED });
    const laterCodes = later.items[0]?.triggered_rules.map((rule) => rule.code) ?? [];
    expect(laterCodes).not.toContain('ORD_UNPAID_ACCUMULATION');
  });

  /* -------------------------------------------------------- customer scope */

  it('a closed scope reads nothing, and a customer scope never sees another customer', async () => {
    const subject = await seedCardTestingCustomer('subject@example.test');
    const other = await seedCustomer('other@example.test');
    await runFraudScan(db, { now: NOW });

    const closed = await listAlerts(db, { page: 1, limit: 10, scope: CLOSED_SCOPE });
    expect(closed.items).toEqual([]);
    expect(closed.total).toBe(0);
    const closedAssessments = await listAssessments(db, { page: 1, limit: 10, scope: CLOSED_SCOPE });
    expect(closedAssessments.items).toEqual([]);
    expect(closedAssessments.total).toBe(0);

    const asOther = await listAlerts(db, { page: 1, limit: 10, scope: { unrestricted: false, customerIds: [other] } });
    expect(asOther.items).toEqual([]);
    expect(asOther.total).toBe(0);

    const asSubject = await listAlerts(db, { page: 1, limit: 10, scope: { unrestricted: false, customerIds: [subject.userId] } });
    expect(asSubject.total).toBe(1);
    expect(asSubject.items[0]?.customer_id).toBe(subject.userId);

    const scopedAssessments = await listAssessments(db, {
      page: 1,
      limit: 10,
      scope: { unrestricted: false, customerIds: [subject.userId] },
    });
    expect(scopedAssessments.total).toBe(1);
    expect(scopedAssessments.items.every((assessment) => assessment.customer_id === subject.userId)).toBe(true);
  });

  /* ------------------------------------------------------- background jobs */

  it('locks a schedule bucket so two workers cannot run it twice', async () => {
    const runKey = `${FS_JOB_SCAN}:sched:test-bucket`;
    const first = await claimRun(db, { jobName: FS_JOB_SCAN, runKey, trigger: 'schedule' });
    expect(first).not.toBeNull();
    expect(await claimRun(db, { jobName: FS_JOB_SCAN, runKey, trigger: 'schedule' })).toBeNull();

    if (first) {
      await finishRun(db, first.id, {
        status: 'completed',
        counters: { ...EMPTY_COUNTERS, subjectsScanned: 3, alertsCreated: 1 },
        durationMs: 42,
      });
    }
    const { rows } = await db.query<{
      status: string;
      subjects_scanned: number;
      alerts_created: number;
      duration_ms: number;
      finished_at: string | null;
    }>(
      `SELECT status, subjects_scanned, alerts_created, duration_ms, finished_at FROM fraud_sentinel_runs WHERE run_key = $1`,
      [runKey]
    );
    expect(rows[0]?.status).toBe('completed');
    expect(Number(rows[0]?.subjects_scanned)).toBe(3);
    expect(Number(rows[0]?.alerts_created)).toBe(1);
    expect(Number(rows[0]?.duration_ms)).toBe(42);
    expect(rows[0]?.finished_at).not.toBeNull();
  });

  it('reclaims a lock left behind by a crashed worker and frees the bucket', async () => {
    const runKey = `${FS_JOB_SCAN}:sched:crashed`;
    expect(await claimRun(db, { jobName: FS_JOB_SCAN, runKey, trigger: 'schedule' })).not.toBeNull();
    // Backdate the start so the row is stale; a `running` row is indistinguishable from a wedged lock.
    await db.query(`UPDATE fraud_sentinel_runs SET started_at = now() - interval '3 hours' WHERE run_key = $1`, [runKey]);
    expect(await reclaimStaleRuns(db, 60)).toBe(1);

    const { rows } = await db.query<{ status: string; error: string | null }>(
      `SELECT status, error FROM fraud_sentinel_runs WHERE run_key = $1`,
      [runKey]
    );
    expect(rows[0]?.status).toBe('failed');
    // The text says the run did not complete rather than inventing a reason.
    expect(rows[0]?.error).toContain('stale lock reclaimed');
    // The reclaimed bucket keeps its key: one attempt per bucket, recorded as failed rather than
    // silently retried. The next bucket gets a fresh key and re-does the work — a scan reads the whole
    // window and ingestion is idempotent, so nothing is lost by not retrying under the same key.
    expect(await claimRun(db, { jobName: FS_JOB_SCAN, runKey, trigger: 'schedule' })).toBeNull();
    const nextBucket = `${FS_JOB_SCAN}:sched:next-bucket`;
    expect(await claimRun(db, { jobName: FS_JOB_SCAN, runKey: nextBucket, trigger: 'schedule' })).not.toBeNull();
    expect(await reclaimStaleRuns(db, 60)).toBe(0); // the fresh row is not stale yet
  });

  it('runs a job through the runner and records the outcome on the run row', async () => {
    await seedCardTestingCustomer();
    const runKey = manualRunKey(FS_JOB_SCAN, NOW);
    const outcome = await executeJob(db, FS_JOB_SCAN, { trigger: 'manual', runKey, triggeredBy: null, now: NOW });
    expect(outcome.status).toBe('completed');
    expect(outcome.result?.counters.alertsCreated).toBe(1);
    expect(outcome.result?.counters.eventsIngested).toBe(6);
    expect(outcome.run?.id).toBeTruthy();
    expect(outcome.notes.join('\n')).toContain('alerts created 1');

    const { rows } = await db.query<{ status: string; job_name: string; trigger: string }>(
      `SELECT status, job_name, trigger FROM fraud_sentinel_runs WHERE run_key = $1`,
      [runKey]
    );
    expect(rows[0]?.status).toBe('completed');
    expect(rows[0]?.job_name).toBe(FS_JOB_SCAN);
    expect(rows[0]?.trigger).toBe('manual');

    // The same key cannot be claimed twice, so a double-click does not double-run the scan.
    const repeat = await executeJob(db, FS_JOB_SCAN, { trigger: 'manual', runKey, now: NOW });
    expect(repeat.status).toBe('locked');
    expect(await countRows('fraud_sentinel_alerts')).toBe(1);
    expect(await countRows('fraud_sentinel_runs')).toBe(1);

    // An unknown job name is reported, not thrown.
    const unknown = await executeJob(db, 'fraud_sentinel_nope', { trigger: 'manual', runKey: 'x', now: NOW });
    expect(unknown.status).toBe('unknown_job');
  });

  it('runs the whole scheduler cycle once per bucket and does nothing when disabled', async () => {
    await seedCardTestingCustomer();
    const pass = await runFraudSentinelCycle(db, NOW);
    expect(pass.skipped).toBe(false);
    expect(pass.ran.length).toBeGreaterThan(0);
    expect(pass.failed).toEqual([]);
    expect(pass.reclaimed).toBe(0);
    expect(await countRows('fraud_sentinel_alerts')).toBe(1);

    // A second pass in the same bucket finds every job already claimed: no duplicate work.
    const repeat = await runFraudSentinelCycle(db, NOW);
    expect(repeat.ran).toEqual([]);
    expect(repeat.locked.length).toBeGreaterThan(0);
    expect(await countRows('fraud_sentinel_alerts')).toBe(1);

    await db.query(`UPDATE platform_settings SET value = 'false' WHERE key = 'fraud_sentinel.enabled'`);
    const disabled = await runFraudSentinelCycle(db, new Date(NOW.getTime() + 3_600_000));
    expect(disabled.skipped).toBe(true);
    expect(disabled.ran).toEqual([]);

    const report = await runFraudScan(db, { now: NOW });
    expect(report.enabled).toBe(false);
    expect(report.ingestion.ingested).toBe(0);
    expect(report.assessmentsCreated).toBe(0);
    expect(report.alertsCreated).toBe(0);
  });

  /* --------------------------------------------------------------- retention */

  it("prunes on the retention horizons without destroying an alert's evidence basis", async () => {
    const { userId } = await seedCardTestingCustomer();
    await runFraudScan(db, { now: NOW });

    // Backdate the ledger beyond the 180-day event horizon.
    await db.query(`UPDATE fraud_sentinel_events SET occurred_at = occurred_at - interval '400 days'`);
    // Backdated from the fixed evaluation instant, NOT from the database's now(): the retention
    // horizons are measured against the injected clock, so the fixture has to be too.
    const old = daysBefore(400).toISOString();
    const older = daysBefore(500).toISOString();
    const insertSuperseded = async (id: string, score: number) => {
      await db.query(
        `INSERT INTO fraud_sentinel_assessments
           (id, subject_type, subject_id, customer_id, risk_score, risk_level, rule_set_version, scoring_version,
            window_started_at, window_ended_at, events_examined, status, assessed_at, created_at)
         VALUES ($1,'customer',$2,$2,$3,'medium','aaaaaaaaaaaaaaaa',1,
                 $4::timestamptz,$5::timestamptz,4,'superseded',$5::timestamptz,$5::timestamptz)`,
        [id, userId, score, older, old]
      );
    };
    await insertSuperseded(randomUUID(), 5);
    const referencedId = randomUUID();
    await insertSuperseded(referencedId, 30);
    const alerts = await listAlerts(db, { page: 1, limit: 5, scope: UNRESTRICTED });
    const alert = alerts.items[0];
    expect(alert).toBeDefined();
    if (alert) {
      await db.query(`UPDATE fraud_sentinel_alerts SET assessment_id = $2 WHERE id = $1`, [alert.id, referencedId]);
    }

    const report = await applyRetention(db, { now: NOW });
    expect(report.horizons.eventDays).toBe(180);
    expect(report.eventsPruned).toBe(6);
    expect(report.supersededAssessmentsPruned).toBe(1);
    // The assessment an alert points at survives, so no alert ever loses the evidence it cites.
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM fraud_sentinel_assessments WHERE id = $1`, [
      referencedId,
    ]);
    expect(Number(rows[0]?.n)).toBe(1);
    // Alerts, investigation entries and false-positive reports are the audit trail: never pruned.
    expect(await countRows('fraud_sentinel_alerts')).toBe(1);
    expect(await countRows('fraud_sentinel_investigations')).toBe(1);
    expect(await countRows('fraud_sentinel_runs')).toBe(0);
  });
});
