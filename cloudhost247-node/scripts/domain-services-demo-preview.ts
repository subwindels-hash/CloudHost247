/**
 * DEVELOPMENT PREVIEW ONLY — never used in production.
 *
 * Boots the real CloudHost247 app (full migration chain, real route handlers, real provider
 * adapters, real payment-gated workflows) against an EMBEDDED Postgres engine (PGlite — the same
 * engine the integration tests use), with SIMULATED provider endpoints (tests/helpers/
 * mock-registrar.ts: a local Namecheap-protocol XML API + a local RDAP service), so the entire
 * Domain Services platform can be explored end to end without real registrar credentials.
 *
 * Everything visible in the preview is produced by the production code paths — search results,
 * quotes, orders, invoices, auction bidding, club pricing and admin connection tests all run
 * through the real services. The only simulation is the registrar/RDAP wire endpoint itself,
 * exactly like the Revenue Guardian preview's MockCloudflare.
 *
 * Usage:
 *   npm run build && npx tsx scripts/domain-services-demo-preview.ts
 * Logins (password "demo-password-123"):
 *   root@demo.cloudhost247.test   (super_admin — /admin/domain-services)
 *   amaka@demo-customer.test      (customer — /domains, /dashboard/domains)
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { loadEnv } from '../src/config/env';
import { buildApp } from '../src/app';
import { PgliteClient } from '../database/db-client';
import { migrateUp } from '../database/migrate';
import { hashPassword } from '../src/lib/password';
import { buildKeyRing } from '../src/lib/crypto';
import { setKeyRingForTesting } from '../src/lib/keyring';
import { sweepDomainServices } from '../src/worker/domain-services-sweep';
import { MockNamecheap, MockRdap } from '../tests/helpers/mock-registrar';

const PASSWORD = 'demo-password-123';

async function main() {
  const db = new PGlite();
  await migrateUp(new PgliteClient(db), { isProduction: false });

  process.env.DATABASE_URL = 'postgresql://embedded:embedded@localhost:5432/embedded';
  process.env.JWT_SECRET = 'demo-preview-secret-demo-preview-secret';
  process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'development',
    PORT: process.env.PORT ?? '3000',
  } as NodeJS.ProcessEnv);
  setKeyRingForTesting(buildKeyRing('a'.repeat(64), undefined));

  // ------------------------------------------------- simulated provider endpoints (dev only)
  const mockNamecheap = new MockNamecheap();
  const mockRdap = new MockRdap();
  await mockNamecheap.start();
  await mockRdap.start();

  // ----------------------------------------------------------------------------- seed users
  const hash = await hashPassword(PASSWORD);
  const mkUser = async (email: string, role: string, name: string) => {
    const id = randomUUID();
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`, [
      id, email, hash, name, role,
    ]);
    return id;
  };
  const rootId = await mkUser('root@demo.cloudhost247.test', 'super_admin', 'Root Admin (demo)');
  const amakaId = await mkUser('amaka@demo-customer.test', 'customer', 'Amaka Demo (customer)');

  // ------------------------------------------------------------------- internal marketplace
  await db.query(
    `INSERT INTO domain_club_plans (id, name, description, status, currency, billing_period, price_amount, discount_type, discount_value, eligible_extensions, created_by)
     VALUES ($1,'Domain Club Monthly','Member pricing on domain registrations and renewals.','published','USD','monthly','9.99','percentage','25','[]'::jsonb,$2)`,
    [randomUUID(), rootId]
  );

  await db.query(
    `INSERT INTO domain_auctions (id, seller_id, domain_name, status, currency, minimum_bid, bid_increment, starts_at, ends_at, created_by)
     VALUES ($1,$2,'brandstack.com','live','USD','250.00','10.00', now() - interval '2 hours', now() + interval '2 days', $3)`,
    [randomUUID(), rootId, rootId]
  );
  await db.query(
    `INSERT INTO domain_auctions (id, seller_id, domain_name, status, currency, minimum_bid, bid_increment, starts_at, ends_at, created_by)
     VALUES ($1,$2,'cloudmetrics.io','scheduled','USD','500.00','25.00', now() + interval '1 day', now() + interval '8 days', $3)`,
    [randomUUID(), rootId, rootId]
  );

  // --------------------------------------------------------------------------- build the app
  const app = buildApp(env, {
    serveFrontend: true,
    publicDir: path.join(process.cwd(), 'public'),
    pool: db as never,
  });

  async function login(email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
    if (res.statusCode !== 200) throw new Error(`demo login failed for ${email}: ${res.body}`);
    return res.json().token as string;
  }

  const rootToken = await login('root@demo.cloudhost247.test');
  const amakaToken = await login('amaka@demo-customer.test');

  // -------------------------------------------- configure providers through the REAL admin API
  // This exercises the genuine flow a Super Admin would use: create provider → store credentials
  // (encrypted) → run a REAL Test Connection → sync the extension catalogue.
  const createdProvider = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/domain-services/providers',
    headers: { authorization: `Bearer ${rootToken}` },
    payload: {
      providerKey: 'demo-registrar',
      name: 'Simulated Registrar (dev preview)',
      adapterKey: 'namecheap',
      providerType: 'registrar',
      apiBaseUrl: mockNamecheap.url(),
      environment: 'sandbox',
    },
  });
  if (createdProvider.statusCode !== 201) throw new Error(`provider create failed: ${createdProvider.body}`);
  const registrarId = createdProvider.json().provider.id as string;

  await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/domain-services/providers/${registrarId}/credentials`,
    headers: { authorization: `Bearer ${rootToken}` },
    payload: { credentials: { apiUser: 'demo-user', apiKey: 'demo-key', userName: 'demo-user', clientIp: '127.0.0.1' } },
  });

  const tested = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/domain-services/providers/${registrarId}/test`,
    headers: { authorization: `Bearer ${rootToken}` },
  });
  if (tested.json().result.status !== 'connected') throw new Error(`registrar test failed: ${tested.body}`);

  const synced = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/domain-services/extensions/sync',
    headers: { authorization: `Bearer ${rootToken}` },
  });
  if (synced.statusCode !== 200) throw new Error(`extension sync failed: ${synced.body}`);

  // RDAP provider for WHOIS lookups, same real flow.
  const rdapProvider = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/domain-services/providers',
    headers: { authorization: `Bearer ${rootToken}` },
    payload: {
      providerKey: 'demo-rdap',
      name: 'Simulated RDAP Registry (dev preview)',
      adapterKey: 'rdap',
      providerType: 'rdap',
      apiBaseUrl: mockRdap.bootstrapUrl(),
      environment: 'production',
    },
  });
  const rdapId = rdapProvider.json().provider.id as string;
  await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/domain-services/providers/${rdapId}/credentials`,
    headers: { authorization: `Bearer ${rootToken}` },
    // RDAP is a public service; the platform still requires a stored (encrypted) credential row.
    payload: { credentials: { public: 'no-authentication-required' } },
  });
  const rdapTest = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/domain-services/providers/${rdapId}/test`,
    headers: { authorization: `Bearer ${rootToken}` },
  });
  if (rdapTest.json().result.status !== 'connected') throw new Error(`rdap test failed: ${rdapTest.body}`);

  // Mark a couple of extensions trending — the admin-curated editorial badge (bare labels).
  await db.query(
    `UPDATE domain_extensions SET is_trending = true, updated_at = now() WHERE extension IN ('ai','io','dev')`
  );

  // --------------------------------------- demo customer activity through the REAL customer API
  // Amaka searches, registers a domain, and bids on the live auction — all real workflows.
  const search = await app.inject({
    method: 'POST',
    url: '/api/v1/domain-services/search',
    headers: { authorization: `Bearer ${amakaToken}` },
    payload: { query: 'amaka-brand' },
  });
  if (search.json().status !== 'completed') throw new Error(`demo search failed: ${search.body}`);

  const contact = {
    firstName: 'Amaka', lastName: 'Demo', email: 'amaka@demo-customer.test', phone: '+234.8012345678',
    addressLine1: '12 Demo Lane', city: 'Abuja', state: 'FCT', postalCode: '900001', countryCode: 'NG',
  };
  const registration = await app.inject({
    method: 'POST',
    url: '/api/v1/domain-services/registrations',
    headers: { authorization: `Bearer ${amakaToken}` },
    payload: { domainName: 'amaka-brand.com', years: 1, contact },
  });
  if (registration.statusCode !== 201) throw new Error(`demo registration failed: ${registration.body}`);

  // Simulate verified payment the same way the payment webhook would, then let the real sweep
  // register the domain with the (simulated) registrar and link it to her account.
  await (async () => {
    const registrationId = registration.json().registrationId as string;
    const { markRegistrationPaymentVerified } = await import('../src/domain-services/registration-service');
    await markRegistrationPaymentVerified(db as never, registrationId);
    const { rows } = await db.query(`UPDATE orders SET payment_status='paid', status='completed'
      WHERE id = (SELECT order_id FROM domain_registrations WHERE id=$1) RETURNING id`, [registrationId]);
    void rows;
  })();
  await sweepDomainServices(db as never);

  // A bid on the live auction (minimum 250 + increment 10).
  const { rows: liveAuctionRows } = await db.query<{ id: string }>(
    `SELECT id FROM domain_auctions WHERE domain_name='brandstack.com' LIMIT 1`
  );
  const liveAuctionId = liveAuctionRows[0]?.id;
  if (!liveAuctionId) throw new Error('demo auction seed missing');
  const bid = await app.inject({
    method: 'POST',
    url: `/api/v1/domain-services/auctions/${liveAuctionId}/bids`,
    headers: { authorization: `Bearer ${amakaToken}` },
    payload: { amount: '260.00' },
  });
  if (bid.statusCode !== 201) throw new Error(`demo bid failed: ${bid.body}`);

  // A WHOIS lookup (public registry data through the simulated RDAP service).
  await app.inject({
    method: 'POST',
    url: '/api/v1/domain-services/whois',
    headers: { authorization: `Bearer ${amakaToken}` },
    payload: { domainName: 'taken-public.com' },
  });

  // ------------------------------------------------------------------------------- serve ---
  const port = Number(env.PORT) || 3000;
  await app.listen({ port, host: '0.0.0.0' });

  // Keep the platform's background state machine honest in the preview too.
  setInterval(() => void sweepDomainServices(db as never).catch(() => undefined), 30_000);

  // eslint-disable-next-line no-console
  console.log(`
Domain Services demo preview ready on http://0.0.0.0:${port}

  /domains                  — services hub (3 groups × 9 cards) + live search
  /domains/search           — search + registration checkout (try "amaka-brand" or any name)
  /domains/extensions       — synced TLD catalogue with admin-curated trending badges
  /domains/auctions         — live auction (brandstack.com) + scheduled (cloudmetrics.io)
  /domains/whois            — RDAP lookup (try "taken-public.com" vs "taken-private.net")
  /domains/club             — published club plan with server-computed member pricing
  /domains/appraisal        — honest "Service Provider Not Configured" (no valuation provider)
  /dashboard/domains        — registrations, transfers, auctions, appraisals, transactions
  /admin/domain-services    — providers, Test Connection, extensions, auctions, transfers, club

  Registrar/RDAP endpoints are SIMULATED (tests/helpers/mock-registrar.ts); production uses the
  real Namecheap/GoDaddy/RDAP services. Appraisal is intentionally left unconfigured to show the
  honest not-configured state.

  Logins (password "${PASSWORD}"):
    root@demo.cloudhost247.test   (super_admin)
    amaka@demo-customer.test      (customer — already has a registration, a bid and a lookup)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
