/**
 * End-to-end tests of the SPA's admin client against the real server.
 *
 * The admin console has more sensitive boundaries than any other page in the SPA, so this file pins
 * the things a UI cannot be trusted to enforce:
 *
 *   - a customer account is refused by the API on every staff route, and a staff account is refused
 *     on the admin-only routes (status, role, delegation, the staff directory);
 *   - only a super admin may change an account's status or role, and a super admin cannot change
 *     their own role — the server says so, and the message the page renders is the server's;
 *   - "switch to customer" mints a customer-scoped token, and the client-side bookkeeping parks the
 *     admin's refresh token so the delegated session cannot be refreshed back into an admin;
 *   - ending the session restores the admin's own credentials and closes the session server-side
 *     (the end-session endpoint is admin-only, so the naive order — call it while delegated — is a
 *     403, which is asserted here).
 *
 * What is deliberately NOT claimed: no browser has rendered these pages (there is no DOM in this
 * environment). The JSX is exercised by the production build and `npm run smoke`.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { startServer } = require('./helpers');
const { uuidv7 } = require('../src/lib/ids');
const { hashPassword } = require('../src/lib/password');

const API_PATH = path.join(__dirname, '..', 'spa/src/lib/api.js');
const SUPPORT_PATH = path.join(__dirname, '..', 'spa/src/lib/support-session.js');

const PASSWORD = 'StaffPassword123!';

/**
 * Imports the SPA client (and the support-session helper, which shares its token store) with the
 * browser globals they expect: localStorage, sessionStorage, and a fetch that resolves the client's
 * relative paths against the test server.
 */
async function loadClient(base) {
  const local = new Map();
  const session = new Map();
  const memoryStorage = (map) => ({
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => map.clear(),
  });
  globalThis.localStorage = memoryStorage(local);
  globalThis.sessionStorage = memoryStorage(session);

  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => realFetch(String(url).startsWith('http') ? url : `${base}${url}`, options);

  const tag = `?v=${Date.now()}-${Math.random()}`;
  const api = await import(`${pathToFileURL(API_PATH).href}${tag}`);
  const supportSession = await import(`${pathToFileURL(SUPPORT_PATH).href}${tag}`);

  return {
    ...api,
    supportSession,
    restore: () => {
      globalThis.fetch = realFetch;
      delete globalThis.localStorage;
      delete globalThis.sessionStorage;
    },
  };
}

/** The published product (/admin/catalog/products is what the service form reads). */
async function seedCatalog(store) {
  const productId = uuidv7();
  await store.table('catalog_products').insert({
    id: productId, slug: 'web-hosting', name: 'Web Hosting', category: 'hosting',
    description: 'Shared hosting', status: 'active', sort_order: 1,
  });

  const planId = uuidv7();
  await store.table('catalog_product_plans').insert({
    id: planId, product_id: productId, slug: 'starter', name: 'Starter', status: 'active', sort_order: 1,
  });
  await store.table('catalog_plan_pricing').insert({
    id: uuidv7(), plan_id: planId, currency: 'USD', billing_cycle: 'monthly',
    price: 2.99, setup_fee: 0, is_active: true,
  });
  await store.table('catalog_plan_features').insert({
    id: uuidv7(), plan_id: planId, label: '10 GB SSD', sort_order: 1,
  });

  return { productId, planId };
}

test('spa admin client: role boundaries, delegation and the way back', async (t) => {
  const accounts = {};
  const seeded = {};

  const { base, close } = await startServer({
    seed: async (ctx) => {
      const catalog = await seedCatalog(ctx.store);
      seeded.productId = catalog.productId;
      seeded.planId = catalog.planId;

      // Each account gets a real scrypt hash, so these logins are the same code path a deployment uses.
      const passwordHash = await hashPassword(PASSWORD);
      for (const [key, email, role, fullName] of [
        ['superAdmin', 'super@example.com', 'super_admin', 'Super Admin'],
        ['admin', 'admin@example.com', 'admin', 'Ada Admin'],
        ['staff', 'staff@example.com', 'staff', 'Sam Staff'],
        ['customer', 'customer@example.com', 'customer', 'Cass Customer'],
        ['other', 'other@example.com', 'customer', 'Ola Other'],
      ]) {
        const id = uuidv7();
        accounts[key] = { id, email, role };
        await ctx.store.table('users').insert({
          id, email, password_hash: passwordHash, full_name: fullName, role,
        });
      }

      // Real rows for the customer the console opens, so the detail page renders data, not placeholders.
      seeded.serviceId = uuidv7();
      await ctx.store.table('customer_services').insert({
        id: seeded.serviceId, user_id: accounts.customer.id,
        product_id: catalog.productId, plan_id: catalog.planId,
        label: 'Starter hosting', status: 'active', domain: 'customer.example.com',
        next_due_date: new Date(Date.now() + 14 * 86400_000).toISOString(), amount: 2.99, currency: 'USD',
      });

      seeded.domainId = uuidv7();
      await ctx.store.table('customer_domains').insert({
        id: seeded.domainId, user_id: accounts.customer.id, domain: 'customer.example.com',
        registrar: 'CloudHost247', status: 'active',
        expires_at: new Date(Date.now() + 200 * 86400_000).toISOString(),
      });

      seeded.ticketId = uuidv7();
      await ctx.store.table('support_tickets').insert({
        id: seeded.ticketId, user_id: accounts.customer.id, reference: 'TKT-1001',
        subject: 'Cannot sign in', department: 'support', priority: 'normal', status: 'open',
      });
      await ctx.store.table('support_ticket_messages').insert({
        id: uuidv7(), ticket_id: seeded.ticketId, author_id: accounts.customer.id,
        author_role: 'customer', body: 'I cannot sign in from my laptop.',
      });
    },
  });

  const client = await loadClient(base);
  const login = async (key) => {
    const session = await client.authApi.login({ email: accounts[key].email, password: PASSWORD });
    client.store.save(session);
    return session;
  };

  try {
    await t.test('a signed-out visitor is refused, not served an empty console', async () => {
      await assert.rejects(() => client.adminApi.customers(), (err) => err.status === 401);
      await assert.rejects(() => client.adminApi.tickets(), (err) => err.status === 401);
      await assert.rejects(() => client.adminApi.users(), (err) => err.status === 401);
    });

    await t.test('a customer account is refused by every staff route', async () => {
      await login('customer');
      const refused = [
        () => client.adminApi.customers(),
        () => client.adminApi.customer(accounts.other.id),
        () => client.adminApi.tickets(),
        () => client.adminApi.ticket(seeded.ticketId),
        () => client.adminApi.users(),
        () => client.adminApi.supportSessions(),
        () => client.adminApi.switchToCustomer(accounts.other.id, 'nope'),
      ];
      for (const call of refused) {
        await assert.rejects(call, (err) => {
          assert.strictEqual(err.status, 403, `expected 403, got ${err.status}: ${err.message}`);
          assert.match(err.message, /Insufficient permissions/);
          return true;
        });
      }
      // The customer keeps their own account tools; the console being closed does not lock them out.
      const services = await client.accountApi.services();
      assert.strictEqual(services.total, 1);
    });

    await t.test('staff work the directory and the queue but cannot touch account integrity', async () => {
      await login('staff');

      const search = await client.adminApi.customers({ search: 'customer@example.com' });
      assert.strictEqual(search.total, 1, 'search is the server\'s, over the whole directory');
      const [found] = search.customers;
      assert.strictEqual(found.id, accounts.customer.id);
      assert.strictEqual(found.email, 'customer@example.com');
      assert.strictEqual(found.fullName, 'Cass Customer');
      assert.strictEqual(found.role, 'customer');
      assert.strictEqual(found.status, 'active');
      assert.ok(found.createdAt, 'the directory row shows a join date');

      const byRole = await client.adminApi.customers({ role: 'staff' });
      assert.ok(byRole.customers.every((c) => c.role === 'staff'));
      assert.ok(byRole.total >= 1);

      const detail = await client.adminApi.customer(accounts.customer.id);
      assert.strictEqual(detail.customer.email, 'customer@example.com');
      assert.strictEqual(detail.services.length, 1);
      assert.strictEqual(detail.services[0].label, 'Starter hosting');
      assert.strictEqual(detail.services[0].planName, 'Starter');
      assert.strictEqual(detail.services[0].productName, 'Web Hosting');
      assert.strictEqual(detail.domains.length, 1);
      assert.strictEqual(detail.domains[0].domainName, 'customer.example.com');
      assert.strictEqual(detail.tickets.length, 1);
      assert.strictEqual(detail.tickets[0].reference, 'TKT-1001');

      // Passive records are a staff job: create, then edit, then read back.
      const created = await client.adminApi.createCustomerService(accounts.customer.id, {
        label: 'Mail hosting', status: 'active', notes: 'created from the console',
      });
      assert.strictEqual(created.service.label, 'Mail hosting');
      assert.strictEqual(created.service.user_id, undefined, 'the DTO does not leak raw columns');

      const updated = await client.adminApi.updateCustomerService(
        accounts.customer.id, created.service.id, { status: 'suspended' },
      );
      assert.strictEqual(updated.service.status, 'suspended');

      const domain = await client.adminApi.createCustomerDomain(accounts.customer.id, {
        domainName: 'new.example.com', registrar: 'CloudHost247',
      });
      assert.strictEqual(domain.domain.domainName, 'new.example.com');
      const movedDomain = await client.adminApi.updateCustomerDomain(
        accounts.customer.id, domain.domain.id, { status: 'expired' },
      );
      assert.strictEqual(movedDomain.domain.status, 'expired');

      await assert.rejects(
        () => client.adminApi.updateCustomerService(accounts.customer.id, created.service.id, {}),
        (err) => err.status === 400 && /At least one field/.test(err.message),
      );
      await assert.rejects(
        () => client.adminApi.updateCustomerService(accounts.other.id, seeded.serviceId, { status: 'active' }),
        (err) => err.status === 404,
        'a service record belonging to another customer is not reachable',
      );

      const queue = await client.adminApi.tickets({ status: 'open' });
      assert.strictEqual(queue.total, 1);
      assert.strictEqual(queue.tickets[0].subject, 'Cannot sign in');

      const ticket = await client.adminApi.ticket(seeded.ticketId);
      assert.strictEqual(ticket.customer.id, accounts.customer.id);
      assert.strictEqual(ticket.ticket.messages.length, 1);
      assert.strictEqual(ticket.ticket.messages[0].body, 'I cannot sign in from my laptop.');
      assert.strictEqual(ticket.ticket.messages[0].isOwn, false, 'the customer\'s message is not the staff member\'s');

      const replied = await client.adminApi.replyToTicket(seeded.ticketId, 'Please try the reset link I just sent.');
      assert.strictEqual(replied.ticket.messages.length, 2);
      assert.strictEqual(replied.ticket.messages[1].isOwn, true);
      assert.ok(replied.ticket.lastReplyAt, 'a reply bumps last_reply_at');

      const closed = await client.adminApi.setTicketStatus(seeded.ticketId, 'closed');
      assert.strictEqual(closed.ticket.status, 'closed');
      assert.ok(closed.ticket.closedAt, 'closing stamps the time');

      // The boundaries: all four of these are admin+ or super_admin only.
      const forbidden = [
        () => client.adminApi.setCustomerStatus(accounts.customer.id, 'suspended'),
        () => client.adminApi.setCustomerRole(accounts.customer.id, 'admin'),
        () => client.adminApi.switchToCustomer(accounts.customer.id, 'no'),
        () => client.adminApi.users(),
        () => client.adminApi.supportSessions(),
        () => client.adminApi.catalogProducts(),
      ];
      for (const call of forbidden) {
        await assert.rejects(call, (err) => err.status === 403);
      }
    });

    await t.test('an admin may delegate into a customer session, and the client parks their own', async () => {
      const adminSession = await login('admin');

      const delegation = await client.adminApi.switchToCustomer(accounts.customer.id, 'Ticket TKT-1001');
      assert.strictEqual(delegation.customer.id, accounts.customer.id);
      assert.ok(delegation.supportSessionId);
      assert.ok(delegation.accessToken);

      // The token says who it is for and who is acting — both, and for an hour.
      const claims = JSON.parse(Buffer.from(delegation.accessToken.split('.')[1], 'base64url').toString('utf8'));
      assert.strictEqual(claims.sub, accounts.customer.id);
      assert.strictEqual(claims.act, accounts.admin.id);
      assert.strictEqual(claims.sup, delegation.supportSessionId);
      assert.strictEqual(claims.role, 'customer');
      assert.strictEqual(claims.exp - claims.iat, 3600);

      const parked = client.supportSession.begin({
        delegatedAccessToken: delegation.accessToken,
        customer: delegation.customer,
        sessionId: delegation.supportSessionId,
      });
      assert.strictEqual(parked.accessToken, adminSession.accessToken, 'the admin session is parked, not lost');
      assert.strictEqual(parked.refreshToken, adminSession.refreshToken);

      const stored = client.supportSession.read();
      assert.strictEqual(stored.sessionId, delegation.supportSessionId);
      assert.strictEqual(stored.customer.email, 'customer@example.com');
      assert.strictEqual(client.supportSession.isActing(), true);

      // The security-relevant bit: the delegated session has no refresh token to convert back with.
      assert.strictEqual(client.store.token, delegation.accessToken);
      assert.strictEqual(client.store.refreshToken, null, 'a delegated session is never refreshable');

      const me = await client.authApi.me();
      assert.strictEqual(me.user.id, accounts.customer.id, 'the tab now speaks for the customer');
      assert.strictEqual(me.user.role, 'customer');
      const asCustomer = await client.accountApi.services();
      assert.strictEqual(asCustomer.total, 2, 'including the record the staff member added moments ago');
      await assert.rejects(() => client.adminApi.customers(), (err) => err.status === 403);

      // Calling the admin-only end endpoint while still delegated is refused — which is why the
      // helper restores first. The refusal must not have closed the session.
      await assert.rejects(
        () => client.adminApi.endSupportSession(delegation.supportSessionId),
        (err) => err.status === 403,
      );

      client.store.save(adminSession);
      const open = await client.adminApi.supportSessions();
      const row = open.sessions.find((s) => s.id === delegation.supportSessionId);
      assert.ok(row, 'the session is listed for an admin');
      assert.strictEqual(row.endedAt, null);
      assert.strictEqual(row.adminId, accounts.admin.id);
      assert.strictEqual(row.customerId, accounts.customer.id);

      // Now the helper: it restores the parked admin, then ends the session with their own token.
      const finished = await client.supportSession.finish();
      assert.strictEqual(finished.restored, true);
      assert.strictEqual(finished.error, '');
      assert.strictEqual(client.store.token, adminSession.accessToken, 'the admin is themselves again');
      assert.strictEqual(client.store.refreshToken, adminSession.refreshToken);
      assert.strictEqual(client.supportSession.read(), null, 'nothing is left parked');
      assert.strictEqual(client.supportSession.isActing(), false);

      const after = await client.adminApi.supportSessions();
      const ended = after.sessions.find((s) => s.id === delegation.supportSessionId);
      assert.ok(Date.parse(ended.endedAt) > 0, 'ending the session stamps ended_at');
    });

    await t.test('only a super admin may change status or role, and never their own role', async () => {
      await login('superAdmin');

      const suspended = await client.adminApi.setCustomerStatus(accounts.other.id, 'suspended');
      assert.strictEqual(suspended.customer.status, 'suspended');
      await assert.rejects(
        () => client.adminApi.switchToCustomer(accounts.other.id, 'suspended'),
        (err) => err.status === 404,
        'a non-active account cannot be delegated into',
      );

      // The refusal is the login path's own, word for word — the console shows the server's message.
      client.store.clear();
      await assert.rejects(
        () => client.authApi.login({ email: accounts.other.email, password: PASSWORD }),
        (err) => err.status === 403 && /suspended, please contact support/.test(err.message),
      );
      await login('superAdmin');

      const reactivated = await client.adminApi.setCustomerStatus(accounts.other.id, 'active');
      assert.strictEqual(reactivated.customer.status, 'active');

      const promoted = await client.adminApi.setCustomerRole(accounts.other.id, 'staff');
      assert.strictEqual(promoted.customer.role, 'staff');
      // ...and promote them back: the console must not leave the fixture in a state later tests read.
      const demoted = await client.adminApi.setCustomerRole(accounts.other.id, 'customer');
      assert.strictEqual(demoted.customer.role, 'customer');

      await assert.rejects(
        () => client.adminApi.setCustomerRole(accounts.superAdmin.id, 'admin'),
        (err) => err.status === 400 && /cannot change your own role/.test(err.message),
      );
      await assert.rejects(
        () => client.adminApi.setCustomerStatus(accounts.customer.id, 'deleted'),
        (err) => err.status === 400,
      );
    });

    await t.test('the admin catalog gives the service form real product and plan ids', async () => {
      await login('admin');

      const products = await client.adminApi.catalogProducts();
      const product = products.products.find((p) => p.id === seeded.productId);
      assert.ok(product, 'the seeded product is listed');
      assert.strictEqual(product.name, 'Web Hosting');

      const detail = await client.adminApi.catalogProduct(seeded.productId);
      assert.strictEqual(detail.product.id, seeded.productId);
      assert.strictEqual(detail.plans.length, 1);
      assert.strictEqual(detail.plans[0].id, seeded.planId);
      assert.strictEqual(detail.plans[0].pricing[0].price, 2.99);
      assert.strictEqual(detail.plans[0].features[0].label, '10 GB SSD');

      const created = await client.adminApi.createCustomerService(accounts.customer.id, {
        label: 'Second site', productId: seeded.productId, planId: seeded.planId, status: 'active',
      });
      assert.strictEqual(created.service.productSlug, 'web-hosting');
      assert.strictEqual(created.service.planSlug, 'starter');
      assert.ok(created.service.createdBy, 'the record names the staff member who created it');
    });

    await t.test('the staff directory is the admin-only, capped list the page describes', async () => {
      await login('admin');
      const users = await client.adminApi.users();
      assert.ok(users.total >= 5);
      assert.strictEqual(users.users.length, users.total, 'the first page holds every seeded account');
      const emails = users.users.map((u) => u.email);
      for (const key of Object.keys(accounts)) assert.ok(emails.includes(accounts[key].email));
      assert.ok(users.users.every((u) => u.fullName && u.role && u.status));
    });
  } finally {
    client.restore();
    await close();
  }
});
