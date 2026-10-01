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
import { markAuctionPaymentVerified } from '../../src/domain-services/auction-service';
import { MockNamecheap, MockRdap } from '../helpers/mock-registrar';

/**
 * Domain Services platform behaviour against a real embedded Postgres engine — no mocks. Covers
 * the contract the frontend and customers depend on:
 *
 *  - The honest unconfigured state: with no registrar/RDAP/appraisal provider connected, search,
 *    WHOIS, appraisal, quote and order endpoints never fabricate availability, prices or
 *    valuations. They return "Service Provider Not Configured" or a safe provider error, and
 *    leave no half-created orders behind.
 *  - The auction engine: server-enforced minimum bids (current + increment), self-outbid rules,
 *    idempotent submissions, sweep-driven close that marks the winner, one-time winner payment,
 *    and payment-verified completion.
 *  - The Discount Domain Club: plan lifecycle (draft → published), member pricing computed
 *    server-side, subscription creating a real order + invoice, and cancellation.
 *  - RBAC: admin routes reject customers; the customer's own-data endpoints stay scoped.
 */
describe('Domain Services platform (/api/v1/domain-services)', () => {
  let db: PGlite;
  // getKeyRing() re-reads process.env (see src/lib/keyring.ts), so the same values must exist
  // there as in the loadEnv snapshot — matching the other integration suites' pattern.
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
  process.env.JWT_SECRET ??= 'g'.repeat(32);
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY,
  } as NodeJS.ProcessEnv);

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

  async function createUser(email: string, role: 'customer' | 'admin' | 'super_admin' = 'customer', fullName = 'Test User') {
    const id = randomUUID();
    const hash = await hashPassword('password123');
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, email, hash, fullName, role]
    );
    const token = signAuthToken(env, { sub: id, email, role });
    return { id, email, role, token };
  }

  // ------------------------------------------------------------------ unconfigured provider state

  it('reports honest readiness: nothing configured until a provider passes a real connection test', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/domain-services/readiness' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.registrar).toEqual({ configured: false, providerKey: null });
    expect(body.rdap).toEqual({ configured: false, providerKey: null });
    expect(body.appraisal).toEqual({ configured: false, providerKey: null });
    // The internal auction marketplace is always operational.
    expect(body.auctions).toEqual({ configured: true });
  });

  it('search returns the honest not-configured outcome with zero fabricated results', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/search',
      payload: { query: 'example.com' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('provider_not_configured');
    expect(body.message).toBe('Service Provider Not Configured');
    expect(body.results).toEqual([]);
  });

  it('records search history for signed-in users, including the not-configured outcome', async () => {
    const app = buildTestApp();
    const user = await createUser('searcher@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/search',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { query: 'example.com' },
    });

    const history = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/searches',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(history.statusCode).toBe(200);
    const searches = history.json().searches;
    expect(searches).toHaveLength(1);
    expect(searches[0].query_label).toBe('example.com');
    expect(searches[0].status).toBe('provider_not_configured');
  });

  it('bulk search requires an account and throttles to the honest outcome once signed in', async () => {
    const app = buildTestApp();

    const anon = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/bulk-search',
      payload: { content: 'a.com\nb.com' },
    });
    expect(anon.statusCode).toBe(401);

    const user = await createUser('bulk@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/bulk-search',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { content: 'a.com\nb.com', sourceType: 'text' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('provider_not_configured');
    expect(body.results).toEqual([]);
    // Both submitted entries parsed, but nothing is counted as checked — without a provider no
    // availability claim (even "we accepted it") is made.
    expect(body.submittedCount).toBe(2);
    expect(body.acceptedCount).toBe(0);
    expect(body.rejectedCount).toBe(0);
  });

  it('WHOIS lookup returns not-configured without inventing an owner', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/whois',
      payload: { domainName: 'example.com' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('provider_not_configured');
    expect(body.result).toBeNull();
  });

  it('appraisal refuses to produce a value when no appraisal provider is connected', async () => {
    const app = buildTestApp();
    const user = await createUser('appraiser@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/appraisals',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { domainName: 'example.com' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('provider_not_configured');
    expect(body.appraisal).toBeNull();
    expect(body.orderId).toBeNull();
    // No appraisal row is left claiming a valuation.
    const { rows } = await db.query(`SELECT count(*)::int AS count FROM domain_appraisals`);
    expect(rows[0].count).toBe(0);
  });

  it('quote and registration order surface a safe provider error (not a 500) and create nothing', async () => {
    const app = buildTestApp();
    const user = await createUser('registrar@example.com');
    const contact = {
      firstName: 'Ada', lastName: 'Example', email: 'ada@example.com', phone: '+1.5551234567',
      addressLine1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', countryCode: 'US',
    };

    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/registrations/quote',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { domainName: 'example.com', years: 1 },
    });
    expect(quote.statusCode).toBe(503);
    expect(quote.json().error).toBe('DOMAIN_PROVIDER_NOT_CONFIGURED');
    expect(quote.json().message).toBe('Service Provider Not Configured');

    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/registrations',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { domainName: 'example.com', years: 1, contact },
    });
    expect(order.statusCode).toBe(503);
    expect(order.json().message).toBe('Service Provider Not Configured');

    // Nothing was charged or half-created.
    const { rows } = await db.query(
      `SELECT (SELECT count(*)::int FROM domain_registrations) AS registrations,
              (SELECT count(*)::int FROM domain_contacts) AS contacts,
              (SELECT count(*)::int FROM orders) AS orders`
    );
    expect(rows[0]).toEqual({ registrations: 0, contacts: 0, orders: 0 });
  });

  it('transfer start fails safe with no registrar and leaves no transfer or order behind', async () => {
    const app = buildTestApp();
    const user = await createUser('transfer@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/transfers',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        domainName: 'example.com',
        authCode: 'epp-code-123',
        authorizationConfirmed: true,
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('DOMAIN_PROVIDER_NOT_CONFIGURED');

    const { rows } = await db.query(
      `SELECT (SELECT count(*)::int FROM domain_transfers) AS transfers,
              (SELECT count(*)::int FROM orders) AS orders`
    );
    expect(rows[0]).toEqual({ transfers: 0, orders: 0 });
  });

  it('extension directory is honestly empty until an admin syncs a registrar catalogue', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/domain-services/extensions' });
    expect(res.statusCode).toBe(200);
    expect(res.json().extensions).toEqual([]);

    const admin = await createUser('admin@example.com', 'super_admin');
    const sync = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/domain-services/extensions/sync',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(sync.statusCode).toBe(400);
    expect(sync.json().message).toBe('Service Provider Not Configured');
  });

  // ------------------------------------------------------------------------ auction engine

  it('runs the full auction lifecycle with server-authoritative bidding', async () => {
    const app = buildTestApp();
    const admin = await createUser('auction-admin@example.com', 'super_admin');
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');

    // Create an auction whose window already started (minimum duration 1 hour).
    const startsAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/domain-services/auctions',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { domainName: 'premium-auction.example', minimumBid: '100.00', bidIncrement: '5.00', startsAt, endsAt },
    });
    expect(created.statusCode).toBe(201);
    const auctionId = created.json().auction.id;

    // Scheduled auctions are visible but reject bids until the sweep opens them.
    const earlyBid = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/bids`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { amount: '105.00' },
    });
    expect(earlyBid.statusCode).toBe(409);

    await sweepDomainServices(db as unknown as Parameters<typeof sweepDomainServices>[0]);

    // First bid must clear minimum + increment (server-computed floor).
    const tooLow = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/bids`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { amount: '104.00' },
    });
    expect(tooLow.statusCode).toBe(400);
    expect(tooLow.json().message).toContain('at least 105.00');

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/bids`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { amount: '105.00', idempotencyKey: 'alice-first-bid' },
    });
    expect(first.statusCode).toBe(201);
    const firstBidId = first.json().bidId;

    // Duplicate idempotent submission returns the same bid — never a second row.
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/bids`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { amount: '105.00', idempotencyKey: 'alice-first-bid' },
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json().bidId).toBe(firstBidId);
    const bidCount = await db.query(`SELECT count(*)::int AS count FROM domain_bids`);
    expect(bidCount.rows[0].count).toBe(1);

    // Bob outbids Alice; Alice's duplicate amount is now below the new floor.
    const bobBid = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/bids`,
      headers: { authorization: `Bearer ${bob.token}` },
      payload: { amount: '200.00' },
    });
    expect(bobBid.statusCode).toBe(201);

    const aliceStale = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/bids`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { amount: '200.00' },
    });
    expect(aliceStale.statusCode).toBe(400);
    expect(aliceStale.json().message).toContain('at least 205.00');

    // A bidder cannot re-submit their own highest amount…
    const bobSame = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/bids`,
      headers: { authorization: `Bearer ${bob.token}` },
      payload: { amount: '200.00' },
    });
    expect(bobSame.statusCode).toBe(409);
    // …but raising their own bid (self-outbid) is allowed.
    const bobRaise = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/bids`,
      headers: { authorization: `Bearer ${bob.token}` },
      payload: { amount: '210.00' },
    });
    expect(bobRaise.statusCode).toBe(201);

    // Detail view: anonymized bidder labels, current highest, Bob's own max.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/domain-services/auctions/${auctionId}`,
      headers: { authorization: `Bearer ${bob.token}` },
    });
    const detailBody = detail.json();
    expect(detailBody.auction.currentHighestBid).toBe('210.00');
    expect(detailBody.auction.myHighestBid).toBe('210.00');
    expect(detailBody.bids.length).toBe(3);
    for (const bid of detailBody.bids) {
      expect(bid.bidder_label).toMatch(/^Bidder \d+$/);
    }

    // Dashboard "my bids": Alice is outbid, Bob is winning.
    const aliceBids = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/auctions/my/bids',
      headers: { authorization: `Bearer ${alice.token}` },
    });
    const aliceRow = aliceBids.json().bids.find((b: { auction_id: string }) => b.auction_id === auctionId);
    expect(aliceRow.is_winning).toBe(false);
    const bobBids = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/auctions/my/bids',
      headers: { authorization: `Bearer ${bob.token}` },
    });
    const bobRow = bobBids.json().bids.find((b: { auction_id: string }) => b.auction_id === auctionId);
    expect(bobRow.is_winning).toBe(true);

    // Admin pause stops bidding; resume reopens it.
    const pause = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/domain-services/auctions/${auctionId}/pause`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(pause.statusCode).toBe(200);
    expect(pause.json().auction.status).toBe('scheduled');

    const whilePaused = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/bids`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { amount: '300.00' },
    });
    expect(whilePaused.statusCode).toBe(409);

    const resume = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/domain-services/auctions/${auctionId}/resume`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().auction.status).toBe('live');

    // Close the auction via the sweep: winner is recorded, bids resolve, winner is notified.
    await db.query(`UPDATE domain_auctions SET ends_at = now() - interval '1 minute' WHERE id = $1`, [auctionId]);
    const report = await sweepDomainServices(db as unknown as Parameters<typeof sweepDomainServices>[0]);
    expect(report.auctions.ended).toBe(1);

    const { rows: closed } = await db.query<{ status: string; current_highest_bidder_id: string }>(
      `SELECT status, current_highest_bidder_id FROM domain_auctions WHERE id = $1`,
      [auctionId]
    );
    expect(closed[0].status).toBe('ended');
    expect(closed[0].current_highest_bidder_id).toBe(bob.id);

    const { rows: bidStatuses } = await db.query(
      `SELECT b.status, count(*)::int AS count FROM domain_bids b WHERE b.auction_id = $1 GROUP BY b.status`,
      [auctionId]
    );
    const byStatus = Object.fromEntries(bidStatuses.map((r) => [r.status, r.count]));
    expect(byStatus.won).toBe(2); // Bob's two bids both resolve as won
    expect(byStatus.lost).toBe(1); // Alice's outbid bid

    const { rows: notifications } = await db.query(
      `SELECT type FROM user_notifications WHERE user_id = $1 AND resource_type = 'domain_auction'`,
      [bob.id]
    );
    expect(notifications.some((n) => n.type === 'DOMAIN_AUCTION_WON')).toBe(true);

    // Bids after close are rejected.
    const afterClose = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/bids`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { amount: '500.00' },
    });
    expect(afterClose.statusCode).toBe(409);

    // Winner payment: only the winner, exactly once.
    const notWinner = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/pay`,
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(notWinner.statusCode).toBe(404);

    const pay = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/pay`,
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(pay.statusCode).toBe(201);
    const payment = pay.json();
    expect(payment.amount).toBe('210.00');
    expect(payment.invoiceId).toBeTruthy();

    const payAgain = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/auctions/${auctionId}/pay`,
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(payAgain.statusCode).toBe(409);

    // Verified payment completes the auction and notifies the buyer.
    await markAuctionPaymentVerified(db as unknown as Parameters<typeof markAuctionPaymentVerified>[0], auctionId);
    const { rows: completed } = await db.query<{ status: string }>(
      `SELECT status FROM domain_auctions WHERE id = $1`,
      [auctionId]
    );
    expect(completed[0].status).toBe('completed');
  });

  it('rejects customer access to admin domain-services routes', async () => {
    const app = buildTestApp();
    const customer = await createUser('plain@example.com');

    const overview = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/domain-services/overview',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(overview.statusCode).toBe(403);

    const providers = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/domain-services/providers',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(providers.statusCode).toBe(403);
  });

  // ---------------------------------------------------------------------- Discount Domain Club

  it('runs the Discount Domain Club lifecycle with server-computed member pricing', async () => {
    const app = buildTestApp();
    const admin = await createUser('club-admin@example.com', 'super_admin');
    const member = await createUser('member@example.com');

    // A plan starts as a draft — invisible to customers until published.
    const draft = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/domain-services/club/plans',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: 'Domain Club Monthly',
        description: 'Member pricing on registrations',
        billingPeriod: 'monthly',
        priceAmount: '9.99',
        discountType: 'percentage',
        discountValue: '25',
        eligibleExtensions: [],
      },
    });
    expect(draft.statusCode).toBe(201);
    const planId = draft.json().plan.id;
    expect(draft.json().plan.status).toBe('draft');

    const beforePublish = await app.inject({ method: 'GET', url: '/api/v1/domain-services/club/plans' });
    expect(beforePublish.json().plans).toEqual([]);

    const publish = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/domain-services/club/plans/${planId}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: 'published' },
    });
    expect(publish.statusCode).toBe(200);
    expect(publish.json().plan.status).toBe('published');

    // Anonymous pricing preview applies the cheapest published plan, computed server-side.
    const preview = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/club/pricing-preview?standardPrice=20.00',
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json();
    expect(previewBody.memberPrice).toBe('15.00');
    expect(previewBody.savings).toBe('5.00');

    // Subscribe: a real order + invoice are created; membership starts pending payment.
    const subscribe = await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/club/plans/${planId}/subscribe`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(subscribe.statusCode).toBe(201);
    const subscription = subscribe.json();
    expect(subscription.membershipId).toBeTruthy();
    expect(subscription.invoiceId).toBeTruthy();
    expect(subscription.amount).toBe('9.99');

    const membership = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/club/membership',
      headers: { authorization: `Bearer ${member.token}` },
    });
    const membershipBody = membership.json().membership;
    expect(membershipBody.planName).toBe('Domain Club Monthly');
    expect(membershipBody.status).toBe('pending_payment');

    // A pending membership does not yet grant member pricing on quotes — but the preview for the
    // member still shows the plan price. The active discount is only applied after payment.
    const { rows: activeDiscount } = await db.query(
      `SELECT count(*)::int AS count FROM domain_club_memberships WHERE user_id = $1 AND status = 'active'`,
      [member.id]
    );
    expect(activeDiscount[0].count).toBe(0);

    // Payment verification (as the webhook flow would) activates the membership.
    const { markMembershipPaymentVerified } = await import('../../src/domain-services/club-service');
    await markMembershipPaymentVerified(db as unknown as Parameters<typeof markMembershipPaymentVerified>[0], subscription.membershipId);
    const activated = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/club/membership',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(activated.json().membership.status).toBe('active');

    // An active member now sees their own discount in the preview.
    const memberPreview = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/club/pricing-preview?standardPrice=20.00',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(memberPreview.json().memberPrice).toBe('15.00');

    // Cancellation stops future renewal; the record stays for billing history.
    const cancel = await app.inject({
      method: 'DELETE',
      url: '/api/v1/domain-services/club/membership',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(cancel.statusCode).toBe(204);
    const cancelled = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/club/membership',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(cancelled.json().membership.status).toBe('cancelled');
  });

  it('lists the caller’s domain transactions scoped to their own account', async () => {
    const app = buildTestApp();
    const alice = await createUser('txns@example.com');
    const bob = await createUser('txns-other@example.com');
    const planId = randomUUID();

    await db.query(
      `INSERT INTO domain_club_plans (id, name, status, currency, billing_period, price_amount, discount_type, discount_value, eligible_extensions, created_by)
       VALUES ($1, 'Club', 'published', 'USD', 'monthly', '9.99', 'percentage', '25', '[]'::jsonb, $2)`,
      [planId, alice.id]
    );

    await app.inject({
      method: 'POST',
      url: `/api/v1/domain-services/club/plans/${planId}/subscribe`,
      headers: { authorization: `Bearer ${alice.token}` },
    });

    const aliceTxns = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/transactions',
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(aliceTxns.statusCode).toBe(200);
    const aliceRows = aliceTxns.json().transactions;
    expect(aliceRows).toHaveLength(1);
    expect(aliceRows[0].transaction_type).toBe('club_membership');
    expect(aliceRows[0].status).toBe('pending');

    const bobTxns = await app.inject({
      method: 'GET',
      url: '/api/v1/domain-services/transactions',
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(bobTxns.json().transactions).toEqual([]);
  });
});

// ============================================================================================
// Registrar-backed flows against a SIMULATED provider (tests/helpers/mock-registrar.ts). The
// adapters are transport boundaries — pointing them at the local mock exercises the real
// sync/search/quote/registration code paths end to end without external credentials.
// ============================================================================================
describe('Domain Services with a connected (simulated) registrar', () => {
  let db: PGlite;
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
  process.env.JWT_SECRET ??= 'g'.repeat(32);
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY,
  } as NodeJS.ProcessEnv);

  let mockNamecheap: MockNamecheap;
  let mockRdap: MockRdap;

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createUser(email: string, role: 'customer' | 'admin' | 'super_admin' = 'customer', fullName = 'Test User') {
    const id = randomUUID();
    const hash = await hashPassword('password123');
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, email, hash, fullName, role]
    );
    const token = signAuthToken(env, { sub: id, email, role });
    return { id, email, role, token };
  }

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    mockNamecheap = new MockNamecheap();
    mockRdap = new MockRdap();
    await mockNamecheap.start();
    await mockRdap.start();
  });

  afterEach(async () => {
    await mockNamecheap.stop();
    await mockRdap.stop();
    await db.close();
  });

  async function connectRegistrar(app: ReturnType<typeof buildApp>, adminToken: string): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/domain-services/providers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        providerKey: 'test-registrar',
        name: 'Test Registrar',
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
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { credentials: { apiUser: 'u', apiKey: 'k', userName: 'u', clientIp: '127.0.0.1' } },
    });
    const tested = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/domain-services/providers/${providerId}/test`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(tested.json().result.status).toBe('connected');
    return providerId;
  }

  it('syncs the extension catalogue and serves provider-backed search with real prices', async () => {
    const app = buildTestApp();
    const admin = await createUser('sync-admin@example.com', 'super_admin');
    await connectRegistrar(app, admin.token);

    const sync = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/domain-services/extensions/sync',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(sync.statusCode).toBe(200);
    expect(sync.json().synced).toBeGreaterThan(5);

    // The catalogue stores BARE labels — including multi-label suffixes like com.ng;
    // the directory re-adds the dot and exposes prices.
    const { rows } = await db.query(`SELECT extension FROM domain_extensions ORDER BY extension LIMIT 3`);
    expect(rows.map((r) => r.extension)).toEqual(['ai', 'app', 'co']);
    const suffixRows = await db.query(`SELECT extension FROM domain_extensions WHERE extension LIKE '%.%'`);
    expect(suffixRows.rows.map((r) => r.extension)).toEqual(['com.ng']);

    const directory = await app.inject({ method: 'GET', url: '/api/v1/domain-services/extensions' });
    const entries = directory.json().extensions as Array<{ extension: string; registrationPrice: string | null }>;
    const com = entries.find((entry) => entry.extension === '.com');
    expect(com?.registrationPrice).toBe('10.98');

    // Term search expands across the synced catalogue; availability comes from the provider.
    const user = await createUser('searcher2@example.com');
    const search = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/search',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { query: 'mybrand' },
    });
    expect(search.statusCode).toBe(200);
    const body = search.json();
    expect(body.status).toBe('completed');
    const available = body.results.find((r: { domainName: string }) => r.domainName === 'mybrand.com');
    expect(available.availabilityStatus).toBe('available');
    expect(available.registrationPrice).toBe('10.98');
    const premium = body.results.find((r: { domainName: string }) => r.domainName === 'mybrand.ai');
    expect(premium.availabilityStatus).toBe('premium');

    // A query whose label is taken comes back as registered — never fabricated as available.
    const takenSearch = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/search',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { query: 'mybrand-taken' },
    });
    const takenBody = takenSearch.json();
    const registered = takenBody.results.find((r: { domainName: string }) => r.domainName === 'mybrand-taken.com');
    expect(registered.availabilityStatus).toBe('registered');
  });

  it('runs a registration end to end: quote → order → verified payment → sweep → registrar → customer_domains', async () => {
    const app = buildTestApp();
    const admin = await createUser('reg-admin@example.com', 'super_admin');
    await connectRegistrar(app, admin.token);
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/domain-services/extensions/sync',
      headers: { authorization: `Bearer ${admin.token}` },
    });

    const user = await createUser('buyer@example.com');
    const contact = {
      firstName: 'Bola', lastName: 'Buyer', email: 'bola@example.com', phone: '+234.8012345678',
      addressLine1: '1 Demo Way', city: 'Lagos', state: 'LA', postalCode: '100001', countryCode: 'NG',
    };

    // Quote: availability + price straight from the (simulated) provider.
    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/registrations/quote',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { domainName: 'bola-demo.com', years: 1 },
    });
    expect(quote.statusCode).toBe(200);
    expect(quote.json().quote.standardPrice).toBe('10.98');

    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/registrations',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { domainName: 'bola-demo.com', years: 1, contact },
    });
    expect(order.statusCode).toBe(201);
    const registrationId = order.json().registrationId as string;
    expect(order.json().invoiceId).toBeTruthy();

    // The registration only advances after verified payment — the sweep does nothing before.
    await sweepDomainServices(db as unknown as Parameters<typeof sweepDomainServices>[0]);
    let mid = await db.query(`SELECT status FROM domain_registrations WHERE id=$1`, [registrationId]);
    expect(mid.rows[0].status).toBe('pending_payment');

    // Verified payment (as the webhook flow would), then the sweep registers with the provider.
    const { markRegistrationPaymentVerified } = await import('../../src/domain-services/registration-service');
    await markRegistrationPaymentVerified(db as never, registrationId);
    await sweepDomainServices(db as unknown as Parameters<typeof sweepDomainServices>[0]);

    mid = await db.query(
      `SELECT status, provider_reference FROM domain_registrations WHERE id=$1`,
      [registrationId]
    );
    expect(mid.rows[0].status).toBe('registered');
    expect(mid.rows[0].provider_reference).toMatch(/^demo-order-/);
    expect(mockNamecheap.registered.has('bola-demo.com')).toBe(true);

    // The confirmed domain is linked into the customer's domain list for hosting/DNS.
    const domains = await app.inject({
      method: 'GET',
      url: '/api/v1/domains',
      headers: { authorization: `Bearer ${user.token}` },
    });
    const mine = domains.json().domains as Array<{ domain_name: string; verification_status: string }>;
    const linked = mine.find((d) => d.domain_name === 'bola-demo.com');
    expect(linked?.verification_status).toBe('verified');

    // A second registration for the same domain is rejected while it is live.
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/registrations',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { domainName: 'bola-demo.com', years: 1, contact },
    });
    expect(again.statusCode).toBe(409);
  });

  it('WHOIS lookup through the (simulated) RDAP registry reports privacy protection honestly', async () => {
    const app = buildTestApp();
    const admin = await createUser('rdap-admin@example.com', 'super_admin');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/domain-services/providers',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        providerKey: 'test-rdap',
        name: 'Test RDAP',
        adapterKey: 'rdap',
        providerType: 'rdap',
        apiBaseUrl: mockRdap.bootstrapUrl(),
        environment: 'production',
      },
    });
    const rdapId = created.json().provider.id as string;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/domain-services/providers/${rdapId}/credentials`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { credentials: { public: 'no-authentication-required' } },
    });
    const tested = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/domain-services/providers/${rdapId}/test`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(tested.json().result.status).toBe('connected');

    // A privacy-protected (redacted registrant) record is reported exactly as protected.
    const protectedLookup = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/whois',
      payload: { domainName: 'taken-private.net' },
    });
    expect(protectedLookup.statusCode).toBe(200);
    const protectedBody = protectedLookup.json();
    expect(protectedBody.status).toBe('completed');
    expect(protectedBody.result.source).toBe('rdap');
    expect(protectedBody.result.registrar).toBe('Simulated Registrar LLC');
    expect(protectedBody.result.privacyProtected).toBe(true);

    // A public record shows the registrant.
    const publicLookup = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/whois',
      payload: { domainName: 'taken-public.com' },
    });
    const publicBody = publicLookup.json();
    expect(publicBody.result.privacyProtected).toBe(false);

    // An unregistered domain is a real not-found answer, not a provider failure.
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/domain-services/whois',
      payload: { domainName: 'no-record-anywhere.com' },
    });
    expect(missing.statusCode).toBe(200);
    expect(missing.json().status).toBe('not_found');
  });
});
