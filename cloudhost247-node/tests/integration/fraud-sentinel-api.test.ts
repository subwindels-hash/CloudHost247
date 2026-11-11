/**
 * Fraud Sentinel HTTP surface — /api/admin/fraud-sentinel/* — against a real embedded Postgres
 * (PGlite) with the full committed migration chain and the real Fastify application.
 *
 * What this file pins down is the contract a reviewer's browser actually meets:
 *   * the role gate (only admin/super_admin, re-read from the database, never from the JWT claim);
 *   * the permission vocabulary, including the super_admin-only settings surface;
 *   * "exists but not yours / not there" is a 404, never a 403, so the API cannot be used to
 *     enumerate alerts;
 *   * every verdict-adjacent payload carries the advisory contract;
 *   * evidence is re-checked for secrets ON THE WAY OUT and a failing description is withheld and
 *     reported, not returned and not silently rewritten;
 *   * the alert state machine refuses an illegal move with a 409 and a reason;
 *   * a rule weight change and a scoring-settings change both require a stated reason, are versioned
 *     into rule history and written to audit_logs with the actor;
 *   * /meta publishes the vocabulary and the state machine so the UI hardcodes neither.
 */
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { RULE_CATALOGUE } from '../../src/fraud-sentinel/rules/catalogue';
import { getAlertDetail } from '../../src/fraud-sentinel/services/alert-service';
import { CLOSED_SCOPE } from '../../src/fraud-sentinel/types';

const BASE = '/api/admin/fraud-sentinel';

/** The evidence placeholder the outbound secret check substitutes for a description it refuses. */
const WITHHELD = '[evidence withheld: this description failed the secret-redaction check and was not returned]';

interface TestUser {
  id: string;
  email: string;
  role: string;
  token: string;
}

function body<T>(response: { json(): unknown }): T {
  return response.json() as T;
}

describe('Fraud Sentinel API (/api/admin/fraud-sentinel)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function buildTestApp(): FastifyInstance {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createUser(email: string, role: 'customer' | 'staff' | 'admin' | 'super_admin' = 'customer'): Promise<TestUser> {
    const id = randomUUID();
    const hash = await hashPassword('password12345');
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`, [
      id,
      email,
      hash,
      `User ${email}`,
      role,
    ]);
    return { id, email, role, token: signAuthToken(env, { sub: id, email, role }) };
  }

  const auth = (user: TestUser) => ({ authorization: `Bearer ${user.token}` });
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

  /** Real billing rows, the way billing-service writes them. */
  async function seedInvoice(userId: string, amount: string, at: Date) {
    const orderId = randomUUID();
    const invoiceId = randomUUID();
    await db.query(
      `INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status, created_at, updated_at)
       VALUES ($1,$2,'USD',$3,$3,'completed','unpaid',$4::timestamptz,$4::timestamptz)`,
      [orderId, userId, amount, at.toISOString()]
    );
    await db.query(
      `INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status, due_date, issued_at, created_at, updated_at)
       VALUES ($1,$2,$3,'USD',$4,$4,'unpaid',CURRENT_DATE + 7,$5::timestamptz,$5::timestamptz,$5::timestamptz)`,
      [invoiceId, orderId, userId, amount, at.toISOString()]
    );
    return invoiceId;
  }

  async function seedPayment(userId: string, invoiceId: string, status: string, amount: string, at: Date) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO payments (id, invoice_id, user_id, provider, provider_reference, method, amount, currency,
                             status, failure_reason, initiated_at, completed_at, created_at, updated_at)
       VALUES ($1,$2,$3,'paystack',$4,'card',$5,'USD',$6,$7,$8::timestamptz,$8::timestamptz,$8::timestamptz,$8::timestamptz)`,
      [id, invoiceId, userId, `ref_${id.slice(0, 8)}`, amount, status, status === 'failed' ? 'card_declined' : null, at.toISOString()]
    );
    return id;
  }

  /** Three declines then one approval: the card-testing shape, which raises exactly one alert. */
  async function seedSuspect(email = 'suspect@example.test') {
    const id = randomUUID();
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role, created_at, updated_at)
                    VALUES ($1,$2,'hash',$3,'customer',$4::timestamptz,$4::timestamptz)`, [
      id,
      email,
      `User ${email}`,
      daysAgo(400).toISOString(),
    ]);
    const invoiceId = await seedInvoice(id, '49.99', minutesAgo(120));
    await seedPayment(id, invoiceId, 'failed', '49.99', minutesAgo(60));
    await seedPayment(id, invoiceId, 'failed', '49.99', minutesAgo(40));
    await seedPayment(id, invoiceId, 'failed', '49.99', minutesAgo(20));
    await seedPayment(id, invoiceId, 'successful', '49.99', minutesAgo(10));
    return { id, email, invoiceId };
  }

  interface Platform {
    app: FastifyInstance;
    root: TestUser;
    admin: TestUser;
    staff: TestUser;
    customer: TestUser;
    suspect: { id: string; email: string; invoiceId: string };
    alert: Record<string, unknown> & { id: string; alert_number: string; status: string };
  }

  /** Boots the app, seeds the roles and runs one real scan so there is an alert to investigate. */
  async function seedPlatform(): Promise<Platform> {
    const app = buildTestApp();
    const root = await createUser('root@example.test', 'super_admin');
    const admin = await createUser('reviewer@example.test', 'admin');
    const staff = await createUser('staff@example.test', 'staff');
    const customer = await createUser('victim@example.test', 'customer');
    const suspect = await seedSuspect();

    const scan = await app.inject({ method: 'POST', url: `${BASE}/scan`, headers: auth(root) });
    expect(scan.statusCode, scan.body).toBe(200);
    expect(body<{ alertsCreated: number }>(scan).alertsCreated).toBe(1);

    const list = await app.inject({ method: 'GET', url: `${BASE}/alerts`, headers: auth(root) });
    expect(list.statusCode).toBe(200);
    const alert = body<{ items: Array<Record<string, unknown> & { id: string; alert_number: string; status: string }> }>(list).items[0];
    if (!alert) throw new Error('fixture produced no alert');
    return { app, root, admin, staff, customer, suspect, alert };
  }

  async function auditRows(action: string) {
    const { rows } = await db.query<{ action: string; resource_type: string; resource_id: string | null; metadata: unknown }>(
      `SELECT action, resource_type, resource_id, metadata FROM audit_logs WHERE action = $1 ORDER BY created_at ASC`,
      [action]
    );
    return rows;
  }

  /* ------------------------------------------------------------------- RBAC */

  it('refuses an unauthenticated caller on every route', async () => {
    const app = buildTestApp();
    for (const url of [
      `${BASE}/overview`,
      `${BASE}/meta`,
      `${BASE}/alerts`,
      `${BASE}/alerts/export.csv`,
      `${BASE}/assessments`,
      `${BASE}/rules`,
      `${BASE}/settings`,
      `${BASE}/runs`,
      `${BASE}/rule-feedback`,
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(body<{ error: string }>(res).error).toBe('UNAUTHORIZED');
    }
    const scan = await app.inject({ method: 'POST', url: `${BASE}/scan` });
    expect(scan.statusCode).toBe(401);
  });

  it('refuses staff and customer roles outright, and refuses a forged role claim', async () => {
    const app = buildTestApp();
    const staff = await createUser('staff@example.test', 'staff');
    const customer = await createUser('victim@example.test', 'customer');

    for (const user of [staff, customer]) {
      const res = await app.inject({ method: 'GET', url: `${BASE}/alerts`, headers: auth(user) });
      expect(res.statusCode, user.role).toBe(403);
      expect(body<{ error: string; message: string }>(res)).toEqual({
        error: 'FORBIDDEN',
        message: 'Insufficient permissions for this action',
      });
    }

    // The role is re-read from the database on every request: a token minted while the account was an
    // administrator stops working the moment the role is revoked, without waiting for it to expire.
    const demoted = await createUser('demoted@example.test', 'admin');
    expect((await app.inject({ method: 'GET', url: `${BASE}/alerts`, headers: auth(demoted) })).statusCode).toBe(200);
    await db.query(`UPDATE users SET role = 'customer' WHERE id = $1`, [demoted.id]);
    const afterRevoke = await app.inject({ method: 'GET', url: `${BASE}/alerts`, headers: auth(demoted) });
    expect(afterRevoke.statusCode).toBe(403);

    // A disabled account is refused at the authentication layer, not the role layer.
    const disabled = await createUser('disabled@example.test', 'super_admin');
    await db.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [disabled.id]);
    const disabledRes = await app.inject({ method: 'GET', url: `${BASE}/alerts`, headers: auth(disabled) });
    expect(disabledRes.statusCode).toBe(401);
    expect(body<{ message: string }>(disabledRes).message).toBe('Account is not active');
  });

  it('reserves the settings surface for super_admin while letting admin read it', async () => {
    const { app, root, admin } = await seedPlatform();

    const asAdmin = await app.inject({ method: 'GET', url: `${BASE}/settings`, headers: auth(admin) });
    expect(asAdmin.statusCode).toBe(200);
    expect(body<{ canEdit: boolean }>(asAdmin).canEdit).toBe(false);

    const patch = await app.inject({
      method: 'PATCH',
      url: `${BASE}/settings`,
      headers: auth(admin),
      payload: { lookbackDays: 45 },
    });
    expect(patch.statusCode).toBe(403);
    expect(body<{ error: string; message: string }>(patch)).toEqual({
      error: 'FORBIDDEN',
      message: 'Missing permission: fraud_sentinel.settings',
    });

    const asRoot = await app.inject({ method: 'GET', url: `${BASE}/settings`, headers: auth(root) });
    expect(body<{ canEdit: boolean }>(asRoot).canEdit).toBe(true);
    // Settings carry the retention horizons, i.e. the deletion of evidence: the reason they are
    // super_admin-only is stated in permissions.ts and enforced here.
    expect(await auditRows('fraud_sentinel.settings_updated')).toEqual([]);
  });

  it('publishes the vocabulary, the state machine and the advisory contract on /meta', async () => {
    const { app, admin } = await seedPlatform();
    const res = await app.inject({ method: 'GET', url: `${BASE}/meta`, headers: auth(admin) });
    expect(res.statusCode).toBe(200);
    const meta = body<{
      permissions: string[];
      statuses: string[];
      levels: string[];
      categories: string[];
      subjectTypes: string[];
      falsePositiveReasons: string[];
      investigationActions: string[];
      transitions: Record<string, string[]>;
      sortColumns: string[];
      jobs: Array<{ name: string; description: string }>;
      minResolutionNote: number;
      minFalsePositiveExplanation: number;
      advisory: { advisoryOnly: boolean; performsNoEnforcement: boolean; forbiddenActions: string[]; statement: string };
    }>(res);

    expect(meta.statuses).toEqual(['new', 'under_review', 'escalated', 'resolved', 'false_positive']);
    expect(meta.levels).toEqual(['low', 'medium', 'high', 'critical']);
    expect(meta.subjectTypes).toEqual(['customer', 'ip', 'actor', 'gateway']);
    expect(meta.falsePositiveReasons).toHaveLength(6);
    // The investigation ledger is filterable by action; the UI must not hardcode the vocabulary.
    expect(meta.investigationActions).toHaveLength(12);
    expect(meta.investigationActions).toEqual(expect.arrayContaining(['note_added', 'evidence_reviewed', 'escalated']));
    expect(meta.sortColumns).toEqual(['detected_at', 'last_assessed_at', 'risk_score', 'status', 'alert_number']);
    expect(meta.jobs.map((job) => job.name)).toEqual([
      'fraud_sentinel_ingest',
      'fraud_sentinel_scan',
      'fraud_sentinel_retention',
      'fraud_sentinel_rule_sync',
    ]);
    expect(meta.minResolutionNote).toBe(10);
    expect(meta.minFalsePositiveExplanation).toBe(15);

    // The whole state machine, so the UI can disable the buttons it may not press.
    expect(meta.transitions.new.sort()).toEqual(['escalated', 'false_positive', 'resolved', 'under_review']);
    expect(meta.transitions.under_review.sort()).toEqual(['escalated', 'false_positive', 'new', 'resolved']);
    expect(meta.transitions.escalated.sort()).toEqual(['false_positive', 'resolved', 'under_review']);
    expect(meta.transitions.resolved.sort()).toEqual(['new', 'under_review']);
    expect(meta.transitions.false_positive.sort()).toEqual(['new', 'under_review']);
    for (const [from, to] of Object.entries(meta.transitions)) {
      expect(to, `a status may not transition to itself: ${from}`).not.toContain(from);
    }

    expect(meta.advisory.advisoryOnly).toBe(true);
    expect(meta.advisory.performsNoEnforcement).toBe(true);
    expect(meta.advisory.forbiddenActions).toContain('issue_refunds');
    expect(meta.advisory.forbiddenActions).toContain('suspend_accounts');
    expect(meta.advisory.forbiddenActions).toContain('change_customer_balances');
    expect(meta.permissions).toEqual(
      expect.arrayContaining(['fraud_sentinel.view', 'fraud_sentinel.investigate', 'fraud_sentinel.rules', 'fraud_sentinel.export'])
    );
    expect(meta.permissions).not.toContain('fraud_sentinel.settings');
  });

  /* ----------------------------------------------------------------- alerts */

  it('lists alerts with the advisory contract and honours the filters', async () => {
    const { app, admin, alert, suspect } = await seedPlatform();

    const all = await app.inject({ method: 'GET', url: `${BASE}/alerts`, headers: auth(admin) });
    expect(all.statusCode).toBe(200);
    const page = body<{
      items: Array<Record<string, unknown>>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      advisory: { advisoryOnly: boolean };
    }>(all);
    expect(page.total).toBe(1);
    expect(page.advisory.advisoryOnly).toBe(true);
    expect(page.items[0]?.alert_number).toBe(alert.alert_number);
    expect(page.items[0]?.customer_email).toBe(suspect.email);

    const byStatus = await app.inject({ method: 'GET', url: `${BASE}/alerts?status=open`, headers: auth(admin) });
    expect(body<{ total: number }>(byStatus).total).toBe(1);
    const byRule = await app.inject({ method: 'GET', url: `${BASE}/alerts?ruleCode=PAY_SUCCESS_AFTER_FAILURES`, headers: auth(admin) });
    expect(body<{ total: number }>(byRule).total).toBe(1);
    const byOtherRule = await app.inject({ method: 'GET', url: `${BASE}/alerts?ruleCode=ACC_MFA_TAMPERING`, headers: auth(admin) });
    expect(body<{ total: number }>(byOtherRule).total).toBe(0);
    const bySearch = await app.inject({ method: 'GET', url: `${BASE}/alerts?search=suspect%40example.test`, headers: auth(admin) });
    expect(body<{ total: number }>(bySearch).total).toBe(1);
    const unassigned = await app.inject({ method: 'GET', url: `${BASE}/alerts?unassigned=true`, headers: auth(admin) });
    expect(body<{ total: number }>(unassigned).total).toBe(1);

    // `?unassigned=false` must mean false. A coerced boolean would read Boolean('false') === true and
    // silently invert the filter, so the literal is parsed and anything else is refused.
    const assigned = await app.inject({ method: 'GET', url: `${BASE}/alerts?unassigned=false`, headers: auth(admin) });
    expect(body<{ total: number }>(assigned).total).toBe(0);
    const bogus = await app.inject({ method: 'GET', url: `${BASE}/alerts?unassigned=maybe`, headers: auth(admin) });
    expect(bogus.statusCode).toBe(400);
    expect(body<{ error: string }>(bogus).error).toBe('VALIDATION_ERROR');

    const badStatus = await app.inject({ method: 'GET', url: `${BASE}/alerts?status=nonsense`, headers: auth(admin) });
    expect(badStatus.statusCode).toBe(400);
    const badPage = await app.inject({ method: 'GET', url: `${BASE}/alerts?limit=5000`, headers: auth(admin) });
    expect(badPage.statusCode).toBe(400);
  });

  it('returns one alert with its assessment, timeline and an evidence-integrity verdict', async () => {
    const { app, admin, root, alert, suspect } = await seedPlatform();
    const res = await app.inject({ method: 'GET', url: `${BASE}/alerts/${alert.id}`, headers: auth(admin) });
    expect(res.statusCode).toBe(200);
    const detail = body<{
      alert: Record<string, unknown> & { customer_id: string | null };
      assessment: { evidence: Array<{ table: string; id: string | null; description: string }>; triggered_rules: Array<{ code: string }> } | null;
      investigations: Array<{ action: string; actor_type: string; actor_id: string | null }>;
      falsePositive: unknown;
      riskHistory: Array<{ risk_score: number }>;
      evidenceIntegrity: { ok: boolean; withheld: string[] };
      advisory: { advisoryOnly: boolean; forbiddenActions: string[] };
    }>(res);

    expect(detail.alert.id).toBe(alert.id);
    expect(detail.alert.customer_id).toBe(suspect.id);
    expect(detail.advisory.advisoryOnly).toBe(true);
    expect(detail.evidenceIntegrity).toEqual({ ok: true, withheld: [] });
    expect(detail.falsePositive).toBeNull();
    expect(detail.investigations.map((entry) => entry.action)).toContain('created');
    // This alert was raised by a scan a super_admin started through the API, so the timeline names
    // them. A scheduled pass has no human to name and records actor_type 'system' instead.
    expect(detail.investigations[0]?.actor_type).toBe('staff');
    expect(detail.investigations[0]?.actor_id).toBe(root.id);
    expect(detail.riskHistory.length).toBe(1);

    const codes = detail.assessment?.triggered_rules.map((rule) => rule.code) ?? [];
    expect(codes).toContain('PAY_SUCCESS_AFTER_FAILURES');
    for (const ref of detail.assessment?.evidence ?? []) {
      expect(ref.table).toBe('payments');
      expect(ref.description.length).toBeGreaterThan(10);
    }
  });

  it('answers 404 rather than 403 for an alert that is not there or not the caller\'s', async () => {
    const { app, admin, alert } = await seedPlatform();

    const missing = await app.inject({ method: 'GET', url: `${BASE}/alerts/${randomUUID()}`, headers: auth(admin) });
    expect(missing.statusCode).toBe(404);
    // The message does not distinguish "exists but not yours" from "does not exist".
    expect(body<{ error: string; message: string }>(missing)).toEqual({ error: 'NOT_FOUND', message: 'Alert not found' });

    const malformed = await app.inject({ method: 'GET', url: `${BASE}/alerts/not-a-uuid`, headers: auth(admin) });
    expect(malformed.statusCode).toBe(400);

    // The route's 404 is fed by a scope-filtered read: a caller whose scope excludes the alert gets
    // null from the service, exactly as if the row did not exist. No caller reaching these routes
    // holds a partial scope today (admin and super_admin are both unrestricted), which is precisely
    // why the boundary is asserted here rather than left to the role gate.
    expect(await getAlertDetail(db, alert.id, CLOSED_SCOPE)).toBeNull();
    const unrestricted = await getAlertDetail(db, alert.id, { unrestricted: true, customerIds: [] });
    expect(unrestricted?.alert.id).toBe(alert.id);
  });

  it('withholds an evidence description that fails the outbound secret check and says so', async () => {
    const { app, admin, alert } = await seedPlatform();

    // Poison one stored description directly: redaction on the way in should make this impossible, and
    // the outbound check exists because "should" is not a guarantee across 40 detectors.
    const poisoned = 'gateway said card 4242424242424242 declined';
    await db.query(
      `UPDATE fraud_sentinel_assessments
          SET evidence = jsonb_set(evidence, '{0,description}', $2::jsonb)
        WHERE id = (SELECT assessment_id FROM fraud_sentinel_alerts WHERE id = $1::uuid)`,
      [alert.id, JSON.stringify(poisoned)]
    );

    const res = await app.inject({ method: 'GET', url: `${BASE}/alerts/${alert.id}`, headers: auth(admin) });
    expect(res.statusCode).toBe(200);
    const detail = body<{
      assessment: { evidence: Array<{ description: string }> } | null;
      evidenceIntegrity: { ok: boolean; withheld: string[] };
    }>(res);

    expect(detail.evidenceIntegrity.ok).toBe(false);
    expect(detail.evidenceIntegrity.withheld).toHaveLength(1);
    expect(detail.assessment?.evidence[0]?.description).toBe(WITHHELD);
    // The rest of the evidence still arrives: one bad description does not fail the whole request.
    expect((detail.assessment?.evidence ?? []).length).toBeGreaterThan(1);
    expect(res.body).not.toContain('4242424242424242');
  });

  it('moves an alert through its lifecycle, auto-assigns on claim, and records every step', async () => {
    const { app, admin, alert } = await seedPlatform();

    // new → under_review claims the alert for the reviewer, because "under review" with nobody named
    // is a claim no one can check.
    const claim = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/transition`,
      headers: auth(admin),
      payload: { toStatus: 'under_review' },
    });
    expect(claim.statusCode, claim.body).toBe(200);
    const claimed = body<{
      alert: Record<string, unknown>;
      investigations: Array<{ action: string; to_status: string | null; actor_type: string }>;
      advisory: { advisoryOnly: boolean };
    }>(claim);
    expect(claimed.alert.status).toBe('under_review');
    expect(claimed.alert.assigned_reviewer_id).toBe(admin.id);
    expect(claimed.alert.assigned_at).not.toBeNull();
    // A mutation response carries the contract too: the screen that renders it cannot forget.
    expect(claimed.advisory.advisoryOnly).toBe(true);
    expect(claimed.investigations.map((entry) => entry.action)).toContain('status_changed');
    expect(claimed.investigations.every((entry) => entry.actor_type === 'staff' || entry.actor_type === 'system')).toBe(true);

    // Closing without a reason is refused: a fraud alert that disappears without a sentence behind it
    // is how a real case is lost.
    const noNote = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/transition`,
      headers: auth(admin),
      payload: { toStatus: 'resolved' },
    });
    expect(noNote.statusCode).toBe(400);
    expect(body<{ message: string }>(noNote).message).toBe('A note of at least 10 characters is required to mark an alert resolved');

    const shortNote = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/transition`,
      headers: auth(admin),
      payload: { toStatus: 'resolved', note: 'ok' },
    });
    expect(shortNote.statusCode).toBe(400);

    const resolve = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/transition`,
      headers: auth(admin),
      payload: { toStatus: 'resolved', note: 'Called the customer; the declines were their own bank.' },
    });
    expect(resolve.statusCode, resolve.body).toBe(200);
    const resolved = body<{ alert: Record<string, unknown> }>(resolve);
    expect(resolved.alert.status).toBe('resolved');
    expect(resolved.alert.resolved_at).not.toBeNull();
    expect(resolved.alert.resolution_note).toContain('Called the customer');

    // Both the timeline and the platform's audit log carry the actor and the move.
    const audits = await auditRows('fraud_sentinel.alert_resolved');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.resource_type).toBe('fraud_sentinel_alert');
    expect(audits[0]?.resource_id).toBe(alert.id);
    expect(JSON.stringify(audits[0]?.metadata)).toContain('"from":"under_review"');
    const { rows: timeline } = await db.query<{ action: string }>(
      `SELECT action FROM fraud_sentinel_investigations WHERE alert_id = $1 ORDER BY created_at ASC`,
      [alert.id]
    );
    expect(timeline.map((row) => row.action)).toEqual(['created', 'status_changed', 'resolved']);
  });

  it('refuses an illegal transition with 409 and the allowed next statuses', async () => {
    const { app, admin, alert } = await seedPlatform();

    const selfMove = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/transition`,
      headers: auth(admin),
      payload: { toStatus: 'new' },
    });
    expect(selfMove.statusCode).toBe(409);
    expect(body<{ error: string; message: string }>(selfMove)).toEqual({
      error: 'ILLEGAL_ALERT_TRANSITION',
      message: "An alert in status 'new' cannot move to 'new'. Allowed next statuses: under_review, escalated, resolved, false_positive.",
    });

    // Resolve, then try to escalate: a closed alert has to be reopened first.
    await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/transition`,
      headers: auth(admin),
      payload: { toStatus: 'resolved', note: 'Confirmed with the customer by telephone.' },
    });
    const escalate = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/transition`,
      headers: auth(admin),
      payload: { toStatus: 'escalated' },
    });
    expect(escalate.statusCode).toBe(409);
    expect(body<{ message: string }>(escalate).message).toBe(
      "An alert in status 'resolved' cannot move to 'escalated'. Allowed next statuses: under_review, new."
    );
    // The refusal wrote nothing: the alert is still resolved and no timeline entry was added.
    const after = await app.inject({ method: 'GET', url: `${BASE}/alerts/${alert.id}`, headers: auth(admin) });
    expect(body<{ alert: { status: string }; investigations: unknown[] }>(after).alert.status).toBe('resolved');
    expect(body<{ investigations: unknown[] }>(after).investigations).toHaveLength(2);

    // Reopening is allowed, and is recorded as a reopen.
    const reopen = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/transition`,
      headers: auth(admin),
      payload: { toStatus: 'under_review', note: 'Customer called back: the charges were not theirs.' },
    });
    expect(reopen.statusCode, reopen.body).toBe(200);
    expect(body<{ alert: { status: string } }>(reopen).alert.status).toBe('under_review');
    const { rows } = await db.query<{ metadata: unknown }>(
      `SELECT metadata FROM fraud_sentinel_investigations WHERE alert_id = $1 AND action = 'status_changed' ORDER BY created_at DESC LIMIT 1`,
      [alert.id]
    );
    expect(JSON.stringify(rows[0]?.metadata)).toContain('"reopened":true');
  });

  it('assigns only an active administrator, and unassigns on request', async () => {
    const { app, root, admin, alert, customer } = await seedPlatform();

    const toCustomer = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/assign`,
      headers: auth(admin),
      payload: { reviewerId: customer.id },
    });
    expect(toCustomer.statusCode).toBe(400);
    expect(body<{ message: string }>(toCustomer).message).toBe('A reviewer must hold the admin or super_admin role');

    const toNobody = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/assign`,
      headers: auth(admin),
      payload: { reviewerId: randomUUID() },
    });
    expect(toNobody.statusCode).toBe(400);
    expect(body<{ message: string }>(toNobody).message).toBe('Reviewer not found or not active');

    const assign = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/assign`,
      headers: auth(admin),
      payload: { reviewerId: root.id, note: 'Handing to the on-call super_admin.' },
    });
    expect(assign.statusCode, assign.body).toBe(200);
    expect(body<{ alert: { assigned_reviewer_id: string; reviewer_name: string | null } }>(assign).alert.assigned_reviewer_id).toBe(root.id);

    const unassign = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/assign`,
      headers: auth(admin),
      payload: { reviewerId: null },
    });
    expect(unassign.statusCode).toBe(200);
    const after = body<{ alert: { assigned_reviewer_id: string | null; assigned_at: string | null } }>(unassign);
    // Both columns are null or both are set — the table CHECK says so, and the API keeps it true.
    expect(after.alert.assigned_reviewer_id).toBeNull();
    expect(after.alert.assigned_at).toBeNull();

    const actions = (await db.query<{ action: string }>(
      `SELECT action FROM fraud_sentinel_investigations WHERE alert_id = $1 ORDER BY created_at ASC`,
      [alert.id]
    )).rows.map((row) => row.action);
    expect(actions).toEqual(['created', 'assigned', 'unassigned']);
    expect(await auditRows('fraud_sentinel.alert_assigned')).toHaveLength(1);
    expect(await auditRows('fraud_sentinel.alert_unassigned')).toHaveLength(1);
  });

  it('takes a false-positive report once, with a reason long enough to tune a rule', async () => {
    const { app, admin, alert } = await seedPlatform();

    const tooShort = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/false-positive`,
      headers: auth(admin),
      payload: { reasonCategory: 'legitimate_customer', explanation: 'fine' },
    });
    expect(tooShort.statusCode).toBe(400);

    const badReason = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/false-positive`,
      headers: auth(admin),
      payload: { reasonCategory: 'not_a_category', explanation: 'The customer confirmed the attempts were their own.' },
    });
    expect(badReason.statusCode).toBe(400);

    const report = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/false-positive`,
      headers: auth(admin),
      payload: {
        reasonCategory: 'legitimate_customer',
        explanation: 'The customer confirmed all four attempts were their own, on a declining card.',
        ruleCodes: ['PAY_SUCCESS_AFTER_FAILURES'],
      },
    });
    expect(report.statusCode, report.body).toBe(200);
    const detail = body<{ alert: { status: string }; falsePositive: { reason_category: string; explanation: string } | null }>(report);
    expect(detail.alert.status).toBe('false_positive');
    expect(detail.falsePositive?.reason_category).toBe('legitimate_customer');

    // Reporting an alert that is ALREADY false_positive is a self-transition, which the state machine
    // refuses first — before any write, and with the allowed next statuses named.
    const again = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/false-positive`,
      headers: auth(admin),
      payload: { reasonCategory: 'other', explanation: 'A second, contradictory report that must not replace the first.' },
    });
    expect(again.statusCode).toBe(409);
    expect(body<{ error: string; message: string }>(again)).toEqual({
      error: 'ILLEGAL_ALERT_TRANSITION',
      message:
        "An alert in status 'false_positive' cannot move to 'false_positive'. Allowed next statuses: under_review, new.",
    });

    // The reachable path to the unique-report conflict: a reviewer reopens the alert and then reports
    // it a false positive again with a different reason. The table is UNIQUE per alert, so the first
    // report stands and the second is refused rather than silently overwriting a colleague's finding.
    const reopen = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/transition`,
      headers: auth(admin),
      payload: { toStatus: 'under_review', note: 'Reopening to record a second opinion.' },
    });
    expect(reopen.statusCode, reopen.body).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/false-positive`,
      headers: auth(admin),
      payload: { reasonCategory: 'other', explanation: 'A second, contradictory report that must not replace the first.' },
    });
    expect(second.statusCode).toBe(409);
    expect(body<{ error: string; message: string }>(second)).toEqual({
      error: 'CONFLICT',
      message: `Alert ${alert.alert_number} already has a false-positive report`,
    });

    const { rows } = await db.query<{ reason_category: string }>(
      `SELECT reason_category FROM fraud_sentinel_false_positives WHERE alert_id = $1`,
      [alert.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason_category).toBe('legitimate_customer');

    // The report is now rule-tuning feedback, and it says so with a rate rather than a guess.
    const feedback = await app.inject({ method: 'GET', url: `${BASE}/rule-feedback`, headers: auth(admin) });
    expect(feedback.statusCode).toBe(200);
    const rules = body<{ rules: Array<{ code: string; alerts: number; falsePositives: number; falsePositiveRate: number | null }> }>(feedback).rules;
    const tuned = rules.find((rule) => rule.code === 'PAY_SUCCESS_AFTER_FAILURES');
    expect(tuned?.alerts).toBe(1);
    expect(tuned?.falsePositives).toBe(1);
    expect(tuned?.falsePositiveRate).toBe(1);
    // A rule that never fired has no rate at all — null, not 0, because 0% would claim evidence.
    const silent = rules.find((rule) => rule.code === 'ACC_MFA_TAMPERING');
    expect(silent?.alerts).toBe(0);
    expect(silent?.falsePositiveRate).toBeNull();

    const listed = await app.inject({ method: 'GET', url: `${BASE}/false-positives`, headers: auth(admin) });
    expect(body<{ total: number }>(listed).total).toBe(1);
  });

  it('appends reviewer notes to the timeline and refuses a note that says nothing', async () => {
    const { app, admin, root, alert } = await seedPlatform();

    const empty = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/notes`,
      headers: auth(admin),
      payload: { note: 'x' },
    });
    expect(empty.statusCode).toBe(400);
    // The route schema refuses it first; the service repeats the check for callers that are not HTTP.
    expect(body<{ error: string; message: string }>(empty).message).toContain('expected string to have >=3 characters');

    const note = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/notes`,
      headers: auth(admin),
      payload: { note: 'Spoke to the customer; they recognise the first two attempts.' },
    });
    expect(note.statusCode, note.body).toBe(200);
    expect(body<{ investigations: Array<{ action: string; note: string | null }> }>(note).investigations.map((entry) => entry.action)).toContain(
      'note_added'
    );

    const reviewed = await app.inject({
      method: 'POST',
      url: `${BASE}/alerts/${alert.id}/notes`,
      headers: auth(admin),
      payload: { note: 'Checked the four payments rows against the gateway dashboard.', kind: 'evidence_reviewed' },
    });
    expect(reviewed.statusCode).toBe(200);

    const history = await app.inject({ method: 'GET', url: `${BASE}/investigations?alertId=${alert.id}`, headers: auth(admin) });
    expect(history.statusCode).toBe(200);
    const entries = body<{ items: Array<{ action: string; note: string | null; actor_id: string | null }> }>(history);
    // Newest first: the timeline screen opens on the last thing a reviewer did. Every entry names the
    // human who made it — the two notes the admin who is running this test, the alert's creation the
    // super_admin whose scan raised it.
    expect(entries.items.map((entry) => [entry.action, entry.actor_id])).toEqual([
      ['evidence_reviewed', admin.id],
      ['note_added', admin.id],
      ['created', root.id],
    ]);
  });

  /* ------------------------------------------------------------ CSV export */

  it('exports the filtered alerts as RFC-4180 CSV and audits the export', async () => {
    const { app, admin, alert } = await seedPlatform();

    const res = await app.inject({ method: 'GET', url: `${BASE}/alerts/export.csv`, headers: auth(admin) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(String(res.headers['content-disposition'])).toContain('fraud-sentinel-alerts.csv');

    const lines = res.body.split('\r\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);
    const headers = lines[0]?.split(',') ?? [];
    expect(headers).toContain('alert_number');
    expect(headers).toContain('advisory_only');
    expect(lines[1]?.split(',')[0]).toBe(alert.alert_number);
    // advisory_only is the last column, so the row ends with it whatever else needed quoting.
    expect(headers[headers.length - 1]).toBe('advisory_only');
    expect(lines[1]?.endsWith(',true')).toBe(true);
    expect(res.body).toContain('PAY_SUCCESS_AFTER_FAILURES');

    const audits = await auditRows('fraud_sentinel.alerts_exported');
    expect(audits).toHaveLength(1);
    const metadata = audits[0]?.metadata as { rows: number; total: number; window: unknown };
    expect(metadata.rows).toBe(1);
    expect(metadata.total).toBe(1);
    // No window was requested, and the audit says so rather than implying one that was not applied.
    expect(metadata.window).toBeNull();

    // The static export path is not swallowed by /alerts/:id, whose param is a uuid.
    expect(res.body).not.toContain('VALIDATION_ERROR');
  });

  it('exports exactly the rows the list shows, including ones older than 30 days', async () => {
    const { app, admin, alert } = await seedPlatform();
    await db.query(`UPDATE fraud_sentinel_alerts SET detected_at = $2 WHERE id = $1`, [alert.id, daysAgo(90).toISOString()]);

    const list = await app.inject({ method: 'GET', url: `${BASE}/alerts`, headers: auth(admin) });
    expect(body<{ total: number }>(list).total).toBe(1);

    // An export that silently defaulted to the last 30 days would drop the row the screen is showing.
    const everything = await app.inject({ method: 'GET', url: `${BASE}/alerts/export.csv`, headers: auth(admin) });
    expect(everything.body).toContain(alert.alert_number);

    const lastWeek = await app.inject({ method: 'GET', url: `${BASE}/alerts/export.csv?days=7`, headers: auth(admin) });
    expect(lastWeek.statusCode).toBe(200);
    expect(lastWeek.body).toBe('');
    const audits = await auditRows('fraud_sentinel.alerts_exported');
    expect(audits).toHaveLength(2);
    expect((audits[1]?.metadata as { rows: number; window: { since: string } | null }).rows).toBe(0);
    expect((audits[1]?.metadata as { window: { since: string } | null }).window?.since).toBeTruthy();
  });

  /* --------------------------------------------------- assessments, customers */

  it('serves assessments, one assessment, and a customer risk profile', async () => {
    const { app, admin, suspect, alert } = await seedPlatform();

    const list = await app.inject({ method: 'GET', url: `${BASE}/assessments?customerId=${suspect.id}`, headers: auth(admin) });
    expect(list.statusCode).toBe(200);
    const page = body<{ items: Array<Record<string, unknown>>; total: number; advisory: { advisoryOnly: boolean } }>(list);
    expect(page.total).toBe(1);
    expect(page.advisory.advisoryOnly).toBe(true);
    expect(page.items[0]?.customer_email).toBe(suspect.email);
    const assessmentId = String(page.items[0]?.id ?? '');

    const one = await app.inject({ method: 'GET', url: `${BASE}/assessments/${assessmentId}`, headers: auth(admin) });
    expect(one.statusCode).toBe(200);
    const detail = body<{
      assessment: { risk_score: number; triggered_rules: Array<{ code: string; cappedWeight: number }> };
      evidenceIntegrity: { ok: boolean; withheld: string[] };
      advisory: { advisoryOnly: boolean };
    }>(one);
    expect(detail.assessment.risk_score).toBe(30);
    expect(detail.evidenceIntegrity.ok).toBe(true);
    expect(detail.advisory.advisoryOnly).toBe(true);
    expect(detail.assessment.triggered_rules.every((rule) => rule.cappedWeight >= 0)).toBe(true);

    const missing = await app.inject({ method: 'GET', url: `${BASE}/assessments/${randomUUID()}`, headers: auth(admin) });
    expect(missing.statusCode).toBe(404);
    expect(body<{ message: string }>(missing).message).toBe('Assessment not found');

    const profile = await app.inject({ method: 'GET', url: `${BASE}/customers/${suspect.id}/risk-profile`, headers: auth(admin) });
    expect(profile.statusCode).toBe(200);
    const risk = body<{
      customerId: string;
      account: { email: string | null; role: string; status: string } | null;
      current: { risk_score: number } | null;
      history: unknown[];
      openAlerts: Array<{ id: string }>;
      closedAlerts: unknown[];
      recentEvents: Array<{ source_table: string }>;
      assessments: unknown[];
      advisory: { advisoryOnly: boolean };
    }>(profile);
    expect(risk.customerId).toBe(suspect.id);
    expect(risk.account?.email).toBe(suspect.email);
    expect(risk.current?.risk_score).toBe(30);
    expect(risk.openAlerts.map((row) => row.id)).toEqual([alert.id]);
    expect(risk.closedAlerts).toEqual([]);
    expect(risk.recentEvents.length).toBe(6);
    expect(risk.recentEvents.every((event) => ['payments', 'orders', 'invoices'].includes(event.source_table))).toBe(true);
    expect(risk.advisory.advisoryOnly).toBe(true);

    // A uuid that is not a customer at all returns an honest empty profile rather than inventing one.
    const nobody = await app.inject({ method: 'GET', url: `${BASE}/customers/${randomUUID()}/risk-profile`, headers: auth(admin) });
    expect(nobody.statusCode).toBe(200);
    expect(body<{ account: unknown; current: unknown }>(nobody)).toMatchObject({ account: null, current: null });
  });

  it('serves the customer event ledger with its evidence re-checked', async () => {
    const { app, admin, suspect } = await seedPlatform();

    const res = await app.inject({ method: 'GET', url: `${BASE}/customers/${suspect.id}/events`, headers: auth(admin) });
    expect(res.statusCode).toBe(200);
    const page = body<{ items: Array<{ source_table: string; source_event_type: string; evidence: unknown }>; total: number }>(res);
    expect(page.total).toBe(6);
    expect(page.items.map((event) => event.source_event_type)).toContain('payment_failed');
    expect(page.items.every((event) => event.evidence !== null)).toBe(true);

    // The payment category covers the four payments rows AND the invoice: an invoice is a
    // payment-domain object, while the order behind it is order_service.
    const paymentsOnly = await app.inject({
      method: 'GET',
      url: `${BASE}/customers/${suspect.id}/events?category=payment`,
      headers: auth(admin),
    });
    expect(body<{ total: number }>(paymentsOnly).total).toBe(5);
    const ordersOnly = await app.inject({
      method: 'GET',
      url: `${BASE}/customers/${suspect.id}/events?category=order_service`,
      headers: auth(admin),
    });
    expect(body<{ total: number }>(ordersOnly).total).toBe(1);

    // A poisoned ledger payload is withheld on the way out, with the reason named.
    const { rows: ledger } = await db.query<{ id: string }>(
      `SELECT id FROM fraud_sentinel_events WHERE source_table = 'payments' AND customer_id = $1 LIMIT 1`,
      [suspect.id]
    );
    await db.query(
      `UPDATE fraud_sentinel_events
          SET evidence = jsonb_set(evidence, '{failureReason}', '"card 4242424242424242 declined"')
        WHERE id = $1`,
      [String(ledger[0]?.id ?? '')]
    );

    const after = await app.inject({ method: 'GET', url: `${BASE}/customers/${suspect.id}/events?category=payment`, headers: auth(admin) });
    expect(after.statusCode).toBe(200);
    expect(after.body).not.toContain('4242424242424242');
    expect(after.body).toContain('"withheld":true');
  });

  it('re-assesses one customer on demand and audits it, without touching the customer', async () => {
    const { app, admin, suspect } = await seedPlatform();
    const before = await db.query<{ status: string; role: string }>(`SELECT status, role FROM users WHERE id = $1`, [suspect.id]);

    const res = await app.inject({ method: 'POST', url: `${BASE}/customers/${suspect.id}/assess`, headers: auth(admin) });
    expect(res.statusCode, res.body).toBe(200);
    const outcome = body<{
      assessmentId: string | null;
      alertId: string | null;
      result: { riskScore: number; riskLevel: string; triggeredRules: Array<{ code: string }> };
      evidenceIntegrity: { ok: boolean };
      advisory: { advisoryOnly: boolean; performsNoEnforcement: boolean };
    }>(res);
    expect(outcome.assessmentId).toBeTruthy();
    expect(outcome.result.riskScore).toBe(30);
    expect(outcome.result.riskLevel).toBe('medium');
    expect(outcome.result.triggeredRules.map((rule) => rule.code)).toContain('PAY_SUCCESS_AFTER_FAILURES');
    expect(outcome.advisory.advisoryOnly).toBe(true);
    expect(outcome.advisory.performsNoEnforcement).toBe(true);
    expect(outcome.evidenceIntegrity.ok).toBe(true);
    // The alert already exists and is open, so this refreshes it rather than creating a second one.
    expect(outcome.alertId).toBeTruthy();

    const audits = await auditRows('fraud_sentinel.customer_assessed');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.resource_type).toBe('fraud_sentinel_assessment');
    expect(JSON.stringify(audits[0]?.metadata)).toContain(suspect.id);

    const after = await db.query<{ status: string; role: string }>(`SELECT status, role FROM users WHERE id = $1`, [suspect.id]);
    expect(after.rows).toEqual(before.rows);
    // An on-demand assessment is a human act, so it is always recorded: the earlier assessment is
    // superseded rather than overwritten, and the open alert is refreshed rather than duplicated.
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM fraud_sentinel_alerts`);
    expect(Number(rows[0]?.n)).toBe(1);
    const { rows: stored } = await db.query<{ status: string }>(
      `SELECT status FROM fraud_sentinel_assessments ORDER BY assessed_at ASC, created_at ASC`
    );
    expect(stored.map((row) => row.status)).toEqual(['superseded', 'active']);
    const { rows: redetected } = await db.query<{ action: string; actor_type: string; note: string | null }>(
      `SELECT action, actor_type, note FROM fraud_sentinel_investigations WHERE action = 're_detected'`
    );
    expect(redetected).toHaveLength(1);
    expect(redetected[0]?.actor_type).toBe('staff');
    expect(redetected[0]?.note).toContain('On-demand assessment: medium risk (30/100).');
  });

  /* ------------------------------------------------------------------ rules */

  it('lists the rule set with its drift report and the reviewed catalogue beside it', async () => {
    const { app, admin } = await seedPlatform();

    const res = await app.inject({ method: 'GET', url: `${BASE}/rules`, headers: auth(admin) });
    expect(res.statusCode).toBe(200);
    const payload = body<{
      items: Array<{ code: string; weight: number; version: number; enabled: boolean; drift: string[]; hasEvaluator: boolean; catalogueDefault: unknown }>;
      total: number;
      drift: { missingInDatabase: string[]; withoutEvaluator: Array<{ code: string }>; tuned: Array<{ code: string; drift: string[] }> };
      canEdit: boolean;
    }>(res);
    expect(payload.total).toBe(RULE_CATALOGUE.length);
    expect(payload.canEdit).toBe(true);
    expect(payload.items.every((rule) => rule.hasEvaluator)).toBe(true);
    expect(payload.items.every((rule) => rule.drift.length === 0)).toBe(true);
    expect(payload.drift.missingInDatabase).toEqual([]);
    expect(payload.drift.withoutEvaluator).toEqual([]);
    expect(payload.drift.tuned).toEqual([]);

    const filtered = await app.inject({ method: 'GET', url: `${BASE}/rules?category=payment&search=card`, headers: auth(admin) });
    expect(filtered.statusCode).toBe(200);
    const items = body<{ items: Array<{ code: string; category: string }> }>(filtered).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((rule) => rule.category === 'payment')).toBe(true);

    const catalogue = await app.inject({ method: 'GET', url: `${BASE}/rules/catalogue`, headers: auth(admin) });
    expect(catalogue.statusCode).toBe(200);
    expect(body<{ total: number }>(catalogue).total).toBe(RULE_CATALOGUE.length);

    const one = await app.inject({ method: 'GET', url: `${BASE}/rules/PAY_SUCCESS_AFTER_FAILURES`, headers: auth(admin) });
    expect(one.statusCode).toBe(200);
    const detail = body<{ rule: { code: string; weight: number; version: number }; history: Array<{ change_type: string; version: number }> }>(one);
    expect(detail.rule.code).toBe('PAY_SUCCESS_AFTER_FAILURES');
    expect(detail.rule.weight).toBe(22);
    expect(detail.history.map((row) => row.change_type)).toEqual(['created']);

    const missing = await app.inject({ method: 'GET', url: `${BASE}/rules/NOT_A_RULE`, headers: auth(admin) });
    expect(missing.statusCode).toBe(404);
    expect(body<{ message: string }>(missing).message).toBe('Rule not found');
  });

  it('requires a stated reason for a rule weight change and versions the change', async () => {
    const { app, admin } = await seedPlatform();

    const noReason = await app.inject({
      method: 'PATCH',
      url: `${BASE}/rules/PAY_SUCCESS_AFTER_FAILURES`,
      headers: auth(admin),
      payload: { weight: 28 },
    });
    expect(noReason.statusCode).toBe(400);
    expect(body<{ message: string }>(noReason).message).toBe('A reason is required to change a rule weight');

    const outOfRange = await app.inject({
      method: 'PATCH',
      url: `${BASE}/rules/PAY_SUCCESS_AFTER_FAILURES`,
      headers: auth(admin),
      payload: { weight: 900, reason: 'Because the family cap allows it.' },
    });
    expect(outOfRange.statusCode).toBe(400);

    const empty = await app.inject({
      method: 'PATCH',
      url: `${BASE}/rules/PAY_SUCCESS_AFTER_FAILURES`,
      headers: auth(admin),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    expect(body<{ message: string }>(empty).message).toBe('No rule changes supplied');

    const change = await app.inject({
      method: 'PATCH',
      url: `${BASE}/rules/PAY_SUCCESS_AFTER_FAILURES`,
      headers: auth(admin),
      payload: { weight: 28, reason: 'Two confirmed card-testing incidents this month; raising the weight inside the family cap.' },
    });
    expect(change.statusCode, change.body).toBe(200);
    const updated = body<{ rule: { weight: number; version: number; drift: string[] }; history: Array<{ change_type: string; reason: string | null; snapshot: unknown }>; changeType: string }>(change);
    expect(updated.rule.weight).toBe(28);
    expect(updated.rule.version).toBe(2);
    expect(updated.changeType).toBe('updated');
    expect(updated.rule.drift.sort()).toEqual(['version', 'weight']);
    expect(updated.history[0]?.change_type).toBe('updated');
    expect(updated.history[0]?.reason).toContain('card-testing incidents');
    expect(JSON.stringify(updated.history[0]?.snapshot)).toContain('"weight":28');

    // The change is in the platform's audit log with the actor, the before/after weight and the reason.
    const audits = await auditRows('fraud_sentinel.rule_updated');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.resource_type).toBe('fraud_sentinel_rule');
    const metadata = audits[0]?.metadata as { weightBefore: number; weightAfter: number; reason: string | null; changedFields: string[] };
    expect(metadata.weightBefore).toBe(22);
    expect(metadata.weightAfter).toBe(28);
    expect(metadata.changedFields).toEqual(['weight']);
    expect(metadata.reason).toContain('card-testing');

    // Disabling a rule needs no reason (it removes signal, it does not move a score) and is recorded
    // with its own change type.
    const disable = await app.inject({
      method: 'PATCH',
      url: `${BASE}/rules/PAY_SUCCESS_AFTER_FAILURES`,
      headers: auth(admin),
      payload: { enabled: false },
    });
    expect(disable.statusCode, disable.body).toBe(200);
    expect(body<{ changeType: string; rule: { enabled: boolean; version: number } }>(disable).changeType).toBe('disabled');
    expect(body<{ rule: { enabled: boolean; version: number } }>(disable).rule.version).toBe(3);

    const history = await app.inject({ method: 'GET', url: `${BASE}/rule-history?code=PAY_SUCCESS_AFTER_FAILURES`, headers: auth(admin) });
    expect(history.statusCode).toBe(200);
    expect(body<{ items: Array<{ change_type: string }>; total: number }>(history).items.map((row) => row.change_type)).toEqual([
      'disabled',
      'updated',
      'created',
    ]);
  });

  it('syncs the catalogue without resetting what an operator tuned', async () => {
    const { app, root } = await seedPlatform();
    await app.inject({
      method: 'PATCH',
      url: `${BASE}/rules/PAY_FAILURE_BURST`,
      headers: auth(root),
      payload: { weight: 20, reason: 'Local tuning after two confirmed card-testing incidents.' },
    });

    const sync = await app.inject({ method: 'POST', url: `${BASE}/rules/sync`, headers: auth(root) });
    expect(sync.statusCode).toBe(200);
    // Every reviewed rule is already seeded, so a sync inserts nothing…
    expect(body<{ inserted: string[] }>(sync)).toEqual({ inserted: [] });

    // …and above all it does not reset the tuned weight back to the shipped default.
    const rule = await app.inject({ method: 'GET', url: `${BASE}/rules/PAY_FAILURE_BURST`, headers: auth(root) });
    const detail = body<{ rule: { weight: number; drift: string[] }; history: Array<{ change_type: string }> }>(rule);
    expect(detail.rule.weight).toBe(20);
    expect(detail.rule.drift).toContain('weight');
    expect(detail.history.map((row) => row.change_type)).toEqual(['updated', 'created']);
    expect(await auditRows('fraud_sentinel.rules_synced')).toHaveLength(1);
  });

  /* --------------------------------------------------------------- settings */

  it('requires a reason for a scoring setting, clamps an inverted ladder, and records both values', async () => {
    const { app, root } = await seedPlatform();

    const view = await app.inject({ method: 'GET', url: `${BASE}/settings`, headers: auth(root) });
    expect(view.statusCode).toBe(200);
    const settings = body<{
      settings: Record<string, unknown>;
      defaults: Record<string, unknown>;
      overridden: string[];
      scoringKeys: string[];
      families: string[];
    }>(view);
    expect(settings.overridden).toEqual([]);
    expect(settings.scoringKeys.sort()).toEqual(['alertMinLevel', 'alertOnCriticalRule', 'familyCaps', 'riskThresholds']);
    expect(settings.families).toContain('payment_failures');
    expect(settings.defaults.enabled).toBe(true);

    // A non-scoring setting needs no reason.
    const lookback = await app.inject({
      method: 'PATCH',
      url: `${BASE}/settings`,
      headers: auth(root),
      payload: { lookbackDays: 45 },
    });
    expect(lookback.statusCode, lookback.body).toBe(200);
    expect(body<{ settings: { lookbackDays: number }; overridden: string[] }>(lookback).settings.lookbackDays).toBe(45);
    expect(body<{ overridden: string[] }>(lookback).overridden).toContain('lookbackDays');

    // A scoring setting does: it changes how every future score is computed.
    const noReason = await app.inject({
      method: 'PATCH',
      url: `${BASE}/settings`,
      headers: auth(root),
      payload: { alertMinLevel: 'medium' },
    });
    expect(noReason.statusCode).toBe(400);
    expect(body<{ message: string }>(noReason).message).toBe(
      'A reason is required to change scoring settings (alertMinLevel): they change how every future score is computed'
    );

    const unknown = await app.inject({
      method: 'PATCH',
      url: `${BASE}/settings`,
      headers: auth(root),
      payload: { notASetting: 1, reason: 'Testing the unknown-key path.' },
    });
    expect(unknown.statusCode).toBe(400);

    // An inverted ladder is corrected rather than stored: a level that means nothing is worse than a
    // refused request, and the audit row keeps both the requested and the stored value.
    const inverted = await app.inject({
      method: 'PATCH',
      url: `${BASE}/settings`,
      headers: auth(root),
      payload: { riskThresholds: { medium: 90, high: 10, critical: 5 }, reason: 'Operator tried to invert the ladder; the clamp must win.' },
    });
    expect(inverted.statusCode, inverted.body).toBe(200);
    const stored = body<{ settings: { riskThresholds: { medium: number; high: number; critical: number } } }>(inverted).settings.riskThresholds;
    expect(stored).toEqual({ medium: 90, high: 90, critical: 90 });

    const audits = await auditRows('fraud_sentinel.settings_updated');
    expect(audits.length).toBe(2);
    expect(audits[0]?.resource_type).toBe('platform_setting');
    const changes = (audits[1]?.metadata as { changes: Array<{ key: string; requested: unknown; to: unknown; scoring: boolean }>; reason: string | null }).changes;
    expect(changes[0]?.key).toBe('riskThresholds');
    expect(changes[0]?.scoring).toBe(true);
    expect(changes[0]?.requested).toMatchObject({ medium: 90, high: 10, critical: 5 });
    expect(changes[0]?.to).toMatchObject({ medium: 90, high: 90, critical: 90 });

    // Turning the module off is honoured, and the dashboard says so rather than showing stale numbers.
    const off = await app.inject({ method: 'PATCH', url: `${BASE}/settings`, headers: auth(root), payload: { enabled: false } });
    expect(off.statusCode).toBe(200);
    expect(body<{ settings: { enabled: boolean } }>(off).settings.enabled).toBe(false);
    const scan = await app.inject({ method: 'POST', url: `${BASE}/scan`, headers: auth(root) });
    expect(scan.statusCode).toBe(200);
    expect(body<{ enabled: boolean; assessmentsCreated: number }>(scan)).toMatchObject({ enabled: false, assessmentsCreated: 0 });
  });

  /* ------------------------------------------------------------ operations */

  it('runs a scan and a named job on demand, lists runs, and 404s an unknown job', async () => {
    const { app, root, admin } = await seedPlatform();

    const scan = await app.inject({ method: 'POST', url: `${BASE}/scan`, headers: auth(root) });
    expect(scan.statusCode).toBe(200);
    const report = body<{
      enabled: boolean;
      subjectsConsidered: number;
      assessmentsCreated: number;
      assessmentsUnchanged: number;
      alertsCreated: number;
      ingestion: { ingested: number; skippedSources: unknown[] };
      counters: Record<string, number>;
      advisory: { advisoryOnly: boolean };
    }>(scan);
    // The fixture alert already exists, so this pass finds nothing new and says so plainly.
    expect(report.assessmentsUnchanged).toBe(1);
    expect(report.alertsCreated).toBe(0);
    expect(report.ingestion.skippedSources).toEqual([]);
    expect(report.advisory.advisoryOnly).toBe(true);
    const scanAudits = await auditRows('fraud_sentinel.scan_run');
    expect(scanAudits).toHaveLength(2); // the fixture's scan and this one
    expect(scanAudits[0]?.resource_type).toBe('fraud_sentinel_run');

    const runs = await app.inject({ method: 'GET', url: `${BASE}/runs`, headers: auth(admin) });
    expect(runs.statusCode).toBe(200);
    const runPage = body<{
      items: Array<{ job_name: string; trigger: string; status: string }>;
      total: number;
      latestPerJob: Array<{ job_name: string }>;
      jobs: Array<{ name: string }>;
    }>(runs);
    expect(runPage.jobs.map((job) => job.name)).toHaveLength(4);
    // POST /scan assesses synchronously and does not claim a run row; only the jobs do.
    expect(runPage.total).toBe(0);

    const job = await app.inject({ method: 'POST', url: `${BASE}/jobs/fraud_sentinel_retention/run`, headers: auth(admin) });
    expect(job.statusCode, job.body).toBe(200);
    const outcome = body<{ status: string; notes: string[]; run?: { job_name: string; trigger: string } }>(job);
    expect(outcome.status).toBe('completed');
    expect(outcome.run?.job_name).toBe('fraud_sentinel_retention');
    expect(outcome.run?.trigger).toBe('manual');

    const afterJob = await app.inject({ method: 'GET', url: `${BASE}/runs`, headers: auth(admin) });
    expect(body<{ total: number; latestPerJob: Array<{ job_name: string }> }>(afterJob).total).toBe(1);
    expect(body<{ latestPerJob: Array<{ job_name: string }> }>(afterJob).latestPerJob.map((row) => row.job_name)).toEqual([
      'fraud_sentinel_retention',
    ]);
    expect(await auditRows('fraud_sentinel.job_run')).toHaveLength(1);

    // A second manual run inside the same wall-clock minute is locked, not double-executed. The key is
    // the wall-clock minute, so a request that straddles a minute boundary legitimately runs again.
    const minuteBefore = new Date().toISOString().slice(0, 16);
    const repeat = await app.inject({ method: 'POST', url: `${BASE}/jobs/fraud_sentinel_retention/run`, headers: auth(admin) });
    const minuteAfter = new Date().toISOString().slice(0, 16);
    expect(repeat.statusCode).toBe(200);
    const repeatStatus = body<{ status: string }>(repeat).status;
    if (minuteBefore === minuteAfter) {
      expect(repeatStatus).toBe('locked');
    } else {
      expect(['locked', 'completed']).toContain(repeatStatus);
    }

    const unknown = await app.inject({ method: 'POST', url: `${BASE}/jobs/fraud_sentinel_destroy/run`, headers: auth(admin) });
    expect(unknown.statusCode).toBe(404);
    expect(body<{ message: string }>(unknown).message).toBe('Unknown job: fraud_sentinel_destroy');
  });

  it('serves the dashboard overview with counts derived only from stored rows', async () => {
    const { app, admin } = await seedPlatform();
    const res = await app.inject({ method: 'GET', url: `${BASE}/overview`, headers: auth(admin) });
    expect(res.statusCode).toBe(200);
    const overview = body<{
      window: { since: string; until: string };
      alerts: { total: number; open: number; new: number; resolved: number; highOrCritical: number; unassigned: number };
      riskDistribution: Array<{ level: string; subjects: number }>;
      byCategory: Array<{ category: string; alerts: number }>;
      topRules: Array<{ code: string; alerts: number; falsePositives: number }>;
      confidenceBreakdown: Array<{ confidence: string; assessments: number }>;
      recentAlerts: Array<{ alert_number: string }>;
      highestRiskCustomers: Array<{ customer_id: string; risk_score: number; open_alerts: number }>;
      lastRun: unknown;
      advisory: { advisoryOnly: boolean };
      permissions: string[];
    }>(res);

    expect(overview.alerts.total).toBe(1);
    expect(overview.alerts.open).toBe(1);
    expect(overview.alerts.new).toBe(1);
    expect(overview.alerts.resolved).toBe(0);
    expect(overview.alerts.unassigned).toBe(1);
    // One MEDIUM assessment: highOrCritical counts levels, not alerts, and must not overstate.
    expect(overview.alerts.highOrCritical).toBe(0);
    expect(overview.byCategory).toEqual([{ category: 'payment', alerts: 1 }]);
    expect(overview.topRules[0]).toMatchObject({ code: 'PAY_SUCCESS_AFTER_FAILURES', alerts: 1, falsePositives: 0 });
    expect(overview.recentAlerts).toHaveLength(1);
    expect(overview.highestRiskCustomers[0]?.risk_score).toBe(30);
    expect(overview.highestRiskCustomers[0]?.open_alerts).toBe(1);
    expect(overview.riskDistribution.find((entry) => entry.level === 'medium')?.subjects).toBe(1);
    expect(overview.confidenceBreakdown.every((entry) => entry.assessments >= 0)).toBe(true);
    expect(overview.lastRun).toBeNull(); // no background job has run in this process
    expect(overview.advisory.advisoryOnly).toBe(true);
    expect(overview.permissions).toContain('fraud_sentinel.view');
    expect(Date.parse(overview.window.since)).toBeLessThan(Date.parse(overview.window.until));
  });
});
