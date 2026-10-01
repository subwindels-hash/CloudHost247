import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { sweepDomainServices } from '../../src/worker/domain-services-sweep';
import { expireLapsedMemberships, sendMembershipRenewalReminders } from '../../src/domain-services/club-service';
import { MockNamecheap } from '../helpers/mock-registrar';

/**
 * Domain Services notification + broker-management behaviour against real embedded Postgres.
 *
 *  - Auction notifications: "ending soon" reaches every bidder exactly once; when the auction
 *    closes, the winner is told they won and every other bidder is told they lost — once.
 *  - Club notifications: an expiring membership notifies ITS owner in the same sweep that lapses
 *    it (previously the notification could be silently skipped), and the renewal reminder is
 *    sent once inside the 7-day window — never for far-future renewals, never twice.
 *  - Registration: the customer is told only after the registrar confirms, and repeated sweeps
 *    cannot duplicate the message.
 *  - Broker service: admin case-status workflow, offer recording with supersede semantics,
 *    staff notes vs customer messages, server-computed payment totals, transfer tracking, and
 *    the customer notification each step produces. Internal notes never leak to the customer API.
 */

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
process.env.JWT_SECRET ??= 'g'.repeat(32);
process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY,
} as NodeJS.ProcessEnv);

type TestDb = PGlite;

async function createUser(db: TestDb, email: string, role: 'customer' | 'admin' | 'super_admin' = 'customer', fullName = 'Test User') {
  const id = randomUUID();
  const hash = await hashPassword('password123');
  await db.query(
    `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)`,
    [id, email, hash, fullName, role]
  );
  const token = signAuthToken(env, { sub: id, email, role });
  return { id, email, role, token };
}

async function notificationTypes(db: TestDb, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ type: string }>(
    `SELECT type FROM user_notifications WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId]
  );
  return rows.map((row) => row.type);
}

describe('Domain Services notifications (auctions, club, broker)', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createLiveAuction(adminToken: string, domainName: string): Promise<string> {
    const app = buildTestApp();
    const startsAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/domain-services/auctions',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { domainName, minimumBid: '100.00', bidIncrement: '5.00', startsAt, endsAt },
    });
    expect(created.statusCode).toBe(201);
    return created.json().auction.id as string;
  }

  it('notifies every bidder once when an auction is ending soon', async () => {
    const app = buildTestApp();
    const admin = await createUser(db, 'ending-admin@example.com', 'super_admin');
    const alice = await createUser(db, 'ending-alice@example.com');
    const bob = await createUser(db, 'ending-bob@example.com');
    const auctionId = await createLiveAuction(admin.token, 'ending-soon-notify.example');

    await sweepDomainServices(db as never); // scheduled → live
    for (const [user, amount] of [[alice, '105.00'], [bob, '110.00']] as const) {
      const bid = await app.inject({
        method: 'POST',
        url: `/api/v1/domain-services/auctions/${auctionId}/bids`,
        headers: { authorization: `Bearer ${user.token}` },
        payload: { amount },
      });
      expect(bid.statusCode).toBe(201);
    }

    // Move the end time inside the final hour and sweep: transition + notifications.
    await db.query(`UPDATE domain_auctions SET ends_at = now() + interval '30 minutes' WHERE id = $1`, [auctionId]);
    await sweepDomainServices(db as never);

    expect(await notificationTypes(db, alice.id)).toContain('DOMAIN_AUCTION_ENDING_SOON');
    expect(await notificationTypes(db, bob.id)).toContain('DOMAIN_AUCTION_ENDING_SOON');

    // A repeat sweep while still in the final hour must not re-notify anyone.
    await sweepDomainServices(db as never);
    const aliceTypes = await notificationTypes(db, alice.id);
    expect(aliceTypes.filter((type) => type === 'DOMAIN_AUCTION_ENDING_SOON')).toHaveLength(1);
  });

  it('notifies the winner and every losing bidder exactly once when an auction ends', async () => {
    const app = buildTestApp();
    const admin = await createUser(db, 'end-admin@example.com', 'super_admin');
    const winner = await createUser(db, 'end-winner@example.com');
    const loser = await createUser(db, 'end-loser@example.com');
    const auctionId = await createLiveAuction(admin.token, 'auction-end-notify.example');

    await sweepDomainServices(db as never);
    for (const [user, amount] of [[loser, '105.00'], [winner, '150.00']] as const) {
      const bid = await app.inject({
        method: 'POST',
        url: `/api/v1/domain-services/auctions/${auctionId}/bids`,
        headers: { authorization: `Bearer ${user.token}` },
        payload: { amount },
      });
      expect(bid.statusCode).toBe(201);
    }

    await db.query(`UPDATE domain_auctions SET ends_at = now() - interval '1 minute' WHERE id = $1`, [auctionId]);
    await sweepDomainServices(db as never);
    await sweepDomainServices(db as never); // idempotency: second sweep must not duplicate

    const winnerTypes = await notificationTypes(db, winner.id);
    expect(winnerTypes).toContain('DOMAIN_AUCTION_WON');
    expect(winnerTypes).not.toContain('DOMAIN_AUCTION_LOST');
    expect(winnerTypes.filter((type) => type === 'DOMAIN_AUCTION_WON')).toHaveLength(1);

    const loserTypes = await notificationTypes(db, loser.id);
    expect(loserTypes).toContain('DOMAIN_AUCTION_LOST');
    expect(loserTypes.filter((type) => type === 'DOMAIN_AUCTION_LOST')).toHaveLength(1);

    const lost = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/auctions/my/lost',
      headers: { authorization: `Bearer ${loser.token}` },
    });
    expect(lost.statusCode).toBe(200);
    expect(lost.json().auctions.map((a: { id: string }) => a.id)).toContain(auctionId);
  });

  it('club expiry notifies the member in the same sweep that lapses the membership', async () => {
    const member = await createUser(db, 'club-member@example.com');
    const quietMember = await createUser(db, 'club-quiet@example.com');
    const planId = randomUUID();
    await db.query(
      `INSERT INTO domain_club_plans (id, name, status, currency, billing_period, price_amount, discount_type, discount_value)
       VALUES ($1, 'Test Club', 'published', 'USD', 'annually', 99.00, 'percentage', 40)`,
      [planId]
    );
    // Expired an hour ago: the very first sweep must tell this member.
    const expiredMembership = randomUUID();
    await db.query(
      `INSERT INTO domain_club_memberships (id, user_id, plan_id, status, starts_at, renews_at)
       VALUES ($1, $2, $3, 'active', now() - interval '1 year', now() - interval '1 hour')`,
      [expiredMembership, member.id, planId]
    );
    // Active with plenty of runway: must stay silent.
    await db.query(
      `INSERT INTO domain_club_memberships (id, user_id, plan_id, status, starts_at, renews_at)
       VALUES ($1, $2, $3, 'active', now() - interval '1 month', now() + interval '11 months')`,
      [randomUUID(), quietMember.id, planId]
    );

    const expiredCount = await expireLapsedMemberships(db as never);
    expect(expiredCount).toBe(1);
    expect(await notificationTypes(db, member.id)).toContain('DOMAIN_CLUB_EXPIRED');
    expect(await notificationTypes(db, quietMember.id)).toHaveLength(0);

    // Repeat sweeps never re-send.
    await expireLapsedMemberships(db as never);
    const types = await notificationTypes(db, member.id);
    expect(types.filter((type) => type === 'DOMAIN_CLUB_EXPIRED')).toHaveLength(1);
  });

  it('sends the club renewal reminder once inside the window, never outside it', async () => {
    const soonMember = await createUser(db, 'club-soon@example.com');
    const farMember = await createUser(db, 'club-far@example.com');
    const planId = randomUUID();
    await db.query(
      `INSERT INTO domain_club_plans (id, name, status, currency, billing_period, price_amount, discount_type, discount_value)
       VALUES ($1, 'Reminder Club', 'published', 'USD', 'annually', 120.00, 'percentage', 25)`,
      [planId]
    );
    await db.query(
      `INSERT INTO domain_club_memberships (id, user_id, plan_id, status, starts_at, renews_at)
       VALUES ($1, $2, $3, 'active', now() - interval '11 months', now() + interval '5 days')`,
      [randomUUID(), soonMember.id, planId]
    );
    await db.query(
      `INSERT INTO domain_club_memberships (id, user_id, plan_id, status, starts_at, renews_at)
       VALUES ($1, $2, $3, 'active', now() - interval '1 month', now() + interval '30 days')`,
      [randomUUID(), farMember.id, planId]
    );

    const firstRun = await sendMembershipRenewalReminders(db as never);
    expect(firstRun).toBe(1);
    expect(await notificationTypes(db, soonMember.id)).toContain('DOMAIN_CLUB_RENEWAL_REMINDER');
    expect(await notificationTypes(db, farMember.id)).toHaveLength(0);

    // The reminder is once-per-membership: later sweeps in the same window send nothing.
    const secondRun = await sendMembershipRenewalReminders(db as never);
    expect(secondRun).toBe(0);
    const types = await notificationTypes(db, soonMember.id);
    expect(types.filter((type) => type === 'DOMAIN_CLUB_RENEWAL_REMINDER')).toHaveLength(1);
  });

  it('runs the broker case workflow with customer notifications, superseded offers and hidden internal notes', async () => {
    const app = buildTestApp();
    const admin = await createUser(db, 'broker-admin@example.com', 'admin');
    const customer = await createUser(db, 'broker-customer@example.com');

    // Customer submits a broker request → immediate confirmation notification.
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/account/domain-brokerage/cases',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: {
        domain: 'wanted-premium.example',
        customerName: 'Casey Customer',
        contactInformation: 'casey@example.com / +1 555 0100',
        maxBudget: 25000,
        currency: 'usd',
        openingOffer: 5000,
        termsAccepted: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json().case.id as string;
    expect(await notificationTypes(db, customer.id)).toContain('DOMAIN_BROKER_CASE_CREATED');

    // Admin moves the case through the workflow → one notification per distinct status.
    const underReview = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/domain-brokerage/cases/${caseId}/status`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: 'under_review', note: 'Reviewing market comparables' },
    });
    expect(underReview.statusCode).toBe(200);
    // Repeating the same status is a no-op (no duplicate event or notification).
    const repeat = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/domain-brokerage/cases/${caseId}/status`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: 'under_review' },
    });
    expect(repeat.statusCode).toBe(200);

    // Admin records a seller offer → case becomes offer_received, customer is told.
    const offerOne = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/domain-brokerage/cases/${caseId}/offers`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { amount: 18000, currency: 'usd', senderType: 'seller' },
    });
    expect(offerOne.statusCode).toBe(201);
    const offerOneId = offerOne.json().offer.id as string;

    // A second seller offer supersedes the first — only one offer is actionable.
    const offerTwo = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/domain-brokerage/cases/${caseId}/offers`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { amount: 16000, currency: 'usd', senderType: 'seller' },
    });
    expect(offerTwo.statusCode).toBe(201);
    const offerTwoId = offerTwo.json().offer.id as string;

    const stale = await db.query<{ status: string }>(`SELECT status FROM domain_broker_offers WHERE id = $1`, [offerOneId]);
    expect(stale.rows[0].status).toBe('superseded');

    // The customer cannot accept the superseded offer, but can accept the live one.
    const staleDecision = await app.inject({
      method: 'POST',
      url: `/api/v1/account/domain-brokerage/cases/${caseId}/offers/${offerOneId}/decision`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { action: 'accept' },
    });
    expect(staleDecision.statusCode).toBe(404);
    const accept = await app.inject({
      method: 'POST',
      url: `/api/v1/account/domain-brokerage/cases/${caseId}/offers/${offerTwoId}/decision`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { action: 'accept' },
    });
    expect(accept.statusCode).toBe(200);

    // Fees + payment: total is computed server-side from the components.
    const payment = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/domain-brokerage/cases/${caseId}/payment`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { acquisitionAmount: 16000, brokerageFee: 800, transferFee: 50, paymentFee: 25.5, currency: 'usd', status: 'paid' },
    });
    expect(payment.statusCode).toBe(200);
    expect(Number(payment.json().payment.total_amount)).toBeCloseTo(16875.5, 2);
    const caseAfterPayment = await db.query<{ payment_status: string }>(`SELECT payment_status FROM domain_broker_cases WHERE id = $1`, [caseId]);
    expect(caseAfterPayment.rows[0].payment_status).toBe('paid');

    // Acquisition transfer tracking.
    const transfer = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/domain-brokerage/cases/${caseId}/transfer`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: 'initiated', registrar: 'Example Registrar', providerReference: 'xfer-123' },
    });
    expect(transfer.statusCode).toBe(200);

    // Staff note vs customer message visibility.
    const note = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/domain-brokerage/cases/${caseId}/messages`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { body: 'Internal: seller seemed flexible on escrow terms', visibility: 'internal' },
    });
    expect(note.statusCode).toBe(201);
    const update = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/domain-brokerage/cases/${caseId}/messages`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { body: 'Escrow has been opened — we will keep you posted.', visibility: 'customer' },
    });
    expect(update.statusCode).toBe(201);

    const customerView = await app.inject({
      method: 'GET',
      url: `/api/v1/account/domain-brokerage/cases/${caseId}`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(customerView.statusCode).toBe(200);
    const visibleBodies = (customerView.json().messages as Array<{ body: string }>).map((message) => message.body);
    expect(visibleBodies).toContain('Escrow has been opened — we will keep you posted.');
    expect(visibleBodies.join(' ')).not.toContain('seller seemed flexible');
    expect(customerView.json().case.status).toBe('offer_accepted');

    // The full customer notification trail for the case lifecycle.
    const types = await notificationTypes(db, customer.id);
    for (const expected of [
      'DOMAIN_BROKER_CASE_CREATED',
      'DOMAIN_BROKER_CASE_UNDER_REVIEW',
      'DOMAIN_BROKER_OFFER_RECEIVED',
      'DOMAIN_BROKER_PAYMENT_PAID',
      'DOMAIN_BROKER_TRANSFER_INITIATED',
      'DOMAIN_BROKER_MESSAGE',
    ]) {
      expect(types).toContain(expected);
    }
    // StatusNotification dedupe: the repeated under_review update produced no re-notification.
    expect(types.filter((type) => type === 'DOMAIN_BROKER_CASE_UNDER_REVIEW')).toHaveLength(1);

    // Admin detail exposes everything, including the internal note.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/domain-brokerage/cases/${caseId}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(detail.statusCode).toBe(200);
    const adminBodies = (detail.json().messages as Array<{ body: string; visibility: string }>);
    expect(adminBodies.some((message) => message.visibility === 'internal' && message.body.includes('seller seemed flexible'))).toBe(true);
    expect(detail.json().payment.total_amount).toBeTruthy();
    expect(detail.json().transfer.status).toBe('initiated');
  });

  it('rejects customers from broker admin endpoints', async () => {
    const app = buildTestApp();
    const admin = await createUser(db, 'broker-rbac-admin@example.com', 'admin');
    const customer = await createUser(db, 'broker-rbac-customer@example.com');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/account/domain-brokerage/cases',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        domain: 'rbac-broker.example',
        customerName: 'Admin Case',
        contactInformation: 'admin@example.com',
        maxBudget: 1000,
        currency: 'usd',
        termsAccepted: true,
      },
    });
    const caseId = created.json().case.id as string;

    for (const attempt of [
      { method: 'PATCH' as const, url: `/api/v1/admin/domain-brokerage/cases/${caseId}/status`, payload: { status: 'under_review' } },
      { method: 'POST' as const, url: `/api/v1/admin/domain-brokerage/cases/${caseId}/offers`, payload: { amount: 100, currency: 'usd', senderType: 'seller' } },
      { method: 'PUT' as const, url: `/api/v1/admin/domain-brokerage/cases/${caseId}/payment`, payload: { acquisitionAmount: 100, currency: 'usd', status: 'paid' } },
      { method: 'PUT' as const, url: `/api/v1/admin/domain-brokerage/cases/${caseId}/transfer`, payload: { status: 'initiated' } },
      { method: 'GET' as const, url: `/api/v1/admin/domain-brokerage/cases/${caseId}` },
    ]) {
      const response = await app.inject({
        method: attempt.method,
        url: attempt.url,
        headers: { authorization: `Bearer ${customer.token}` },
        payload: 'payload' in attempt ? attempt.payload : undefined,
      });
      expect(response.statusCode).toBe(403);
    }
  });
});

describe('Domain availability watches', () => {
  let db: PGlite;
  let mockNamecheap: MockNamecheap;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    mockNamecheap = new MockNamecheap();
    await mockNamecheap.start();
  });

  afterEach(async () => {
    await mockNamecheap.stop();
    await db.close();
  });

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function connectRegistrar(app: ReturnType<typeof buildTestApp>, adminToken: string) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/domain-services/providers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        providerKey: 'watch-registrar',
        name: 'Watch Registrar',
        adapterKey: 'namecheap',
        providerType: 'registrar',
        apiBaseUrl: mockNamecheap.url(),
        environment: 'sandbox',
      },
    });
    const providerId = created.json().provider.id as string;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/domain-services/providers/${providerId}/credentials`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { credentials: { apiUser: 'u', apiKey: 'k', userName: 'u', clientIp: '127.0.0.1' } },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/domain-services/providers/${providerId}/test`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
  }

  it('refuses to create watches when no registrar is connected (honest not-configured state)', async () => {
    const app = buildTestApp();
    const user = await createUser(db, 'watch-noprovider@example.com');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/watches',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { domainName: 'taken-something.com' },
    });
    expect(created.statusCode).toBe(400);
    expect(created.json().message).toContain('Service Provider Not Configured');

    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/watches',
      payload: { domainName: 'taken-something.com' },
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it('fulfils a watch only from a fresh provider answer, notifying exactly once', async () => {
    const app = buildTestApp();
    const admin = await createUser(db, 'watch-admin@example.com', 'super_admin');
    await connectRegistrar(app, admin.token);
    const user = await createUser(db, 'watcher@example.com');
    const other = await createUser(db, 'other-watcher@example.com');

    // Watch a registered domain (mock: "taken" labels are registered) and an available one.
    const taken = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/watches',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { domainName: 'taken-watch.com' },
    });
    expect(taken.statusCode).toBe(201);
    const takenWatchId = taken.json().watch.id as string;
    expect(taken.json().watch.status).toBe('watching');

    // Re-watching is idempotent — the same active watch comes back, never a second row.
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/watches',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { domainName: 'TAKEN-watch.com' },
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json().watch.id).toBe(takenWatchId);
    const watchRows = await db.query(`SELECT count(*)::int AS count FROM domain_availability_watches`);
    expect(watchRows.rows[0].count).toBe(1);

    const fresh = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/watches',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { domainName: 'freshbrand.com' },
    });
    expect(fresh.statusCode).toBe(201);

    // First sweep: taken stays watching silently; the available one flips + notifies.
    const report = await sweepDomainServices(db as never);
    expect(report.availabilityWatches.checked).toBe(2);
    expect(report.availabilityWatches.becameAvailable).toBe(1);

    let types = await notificationTypes(db, user.id);
    expect(types).toContain('DOMAIN_AVAILABILITY_ALERT');
    expect(types.filter((type) => type === 'DOMAIN_AVAILABILITY_ALERT')).toHaveLength(1);

    const states = await db.query<{ domain_name: string; status: string; last_availability: string | null }>(
      `SELECT domain_name, status, last_availability FROM domain_availability_watches ORDER BY domain_name`
    );
    expect(states.rows).toEqual([
      { domain_name: 'freshbrand.com', status: 'available', last_availability: 'available' },
      { domain_name: 'taken-watch.com', status: 'watching', last_availability: 'registered' },
    ]);

    // Repeated sweeps never re-notify and never re-flip.
    await sweepDomainServices(db as never);
    types = await notificationTypes(db, user.id);
    expect(types.filter((type) => type === 'DOMAIN_AVAILABILITY_ALERT')).toHaveLength(1);

    // Ownership: someone else's watch is indistinguishable from missing.
    const foreign = await app.inject({
      method: 'DELETE',
      url: `/api/v1/domain-services/watches/${takenWatchId}`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(foreign.statusCode).toBe(404);

    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/api/v1/domain-services/watches/${takenWatchId}`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(cancelled.statusCode).toBe(204);
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/v1/domain-services/watches/${takenWatchId}`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(again.statusCode).toBe(404);

    // The list endpoint reflects the final state for the owner only.
    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/watches',
      headers: { authorization: `Bearer ${user.token}` },
    });
    const mineWatches = mine.json().watches as Array<{ domainName: string; status: string }>;
    expect(mineWatches).toHaveLength(2);
    const theirs = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/watches',
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(theirs.json().watches).toHaveLength(0);
  });
});

describe('Domain Services notifications with a connected (simulated) registrar', () => {
  let db: PGlite;
  let mockNamecheap: MockNamecheap;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    mockNamecheap = new MockNamecheap();
    await mockNamecheap.start();
  });

  afterEach(async () => {
    await mockNamecheap.stop();
    await db.close();
  });

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  it('tells the customer exactly once when the registrar confirms the registration', async () => {
    const app = buildTestApp();
    const admin = await createUser(db, 'reg-notify-admin@example.com', 'super_admin');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/domain-services/providers',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        providerKey: 'notify-registrar',
        name: 'Notify Registrar',
        adapterKey: 'namecheap',
        providerType: 'registrar',
        apiBaseUrl: mockNamecheap.url(),
        environment: 'sandbox',
      },
    });
    expect(created.statusCode).toBe(201);
    const providerId = created.json().provider.id as string;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/domain-services/providers/${providerId}/credentials`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { credentials: { apiUser: 'u', apiKey: 'k', userName: 'u', clientIp: '127.0.0.1' } },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/domain-services/providers/${providerId}/test`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/domain-services/extensions/sync',
      headers: { authorization: `Bearer ${admin.token}` },
    });

    const user = await createUser(db, 'reg-notified@example.com');
    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/registrations',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        domainName: 'notify-me.com',
        years: 1,
        contact: {
          firstName: 'Nia', lastName: 'Notify', email: 'nia@example.com', phone: '+234.8012345678',
          addressLine1: '1 Demo Way', city: 'Lagos', state: 'LA', postalCode: '100001', countryCode: 'NG',
        },
      },
    });
    expect(order.statusCode).toBe(201);
    const registrationId = order.json().registrationId as string;

    // Before verified payment: no registration-result notification may exist.
    const { markRegistrationPaymentVerified } = await import('../../src/domain-services/registration-service');
    expect(await notificationTypes(db, user.id)).toHaveLength(0);

    await markRegistrationPaymentVerified(db as never, registrationId);
    await sweepDomainServices(db as never);

    const reg = await db.query<{ status: string }>(`SELECT status FROM domain_registrations WHERE id = $1`, [registrationId]);
    expect(reg.rows[0].status).toBe('registered');
    const typesAfterFirstSweep = await notificationTypes(db, user.id);
    expect(typesAfterFirstSweep).toContain('DOMAIN_REGISTRATION_COMPLETED');
    expect(typesAfterFirstSweep).not.toContain('DOMAIN_REGISTRATION_FAILED');

    // Repeated sweeps (settle path + polling path) must never duplicate the message.
    await sweepDomainServices(db as never);
    const typesAfterSecondSweep = await notificationTypes(db, user.id);
    expect(typesAfterSecondSweep.filter((type) => type === 'DOMAIN_REGISTRATION_COMPLETED')).toHaveLength(1);
  });
});
