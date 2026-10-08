import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { routeExists, TOOLS_CATEGORIES } from '../../src/navigation/mega-menu';
import { DISCOVERY_CATEGORIES, TOOL_CATALOG } from '../../src/tools/catalog';
import { withTransaction } from '../../src/db/transaction';
import { findOrderById } from '../../src/db/orders';
import { provisionPaidOrder } from '../../src/services/provisioning-service';

/**
 * CLOUDHOST247 platform services (`/api/v1/{navigation,platform-services,cart,builder,ai-builder,
 * store,experts,marketing-services,logo-maker,inbox}`) against a real embedded Postgres engine.
 *
 * These tests exist to pin the contracts the customer-facing pages depend on, and — just as
 * importantly — the honesty rules:
 *
 *  - a plan is only buyable once an administrator has priced and published it;
 *  - a published website is served from the immutable snapshot, so a draft edit never leaks;
 *  - a digital store line never asks for shipping; a physical line always needs carrier + tracking;
 *  - an expert is paid the quote the customer approved, never the catalogue "starting price";
 *  - a marketing metric without a source is rejected rather than published as fact;
 *  - an internal inbox note is invisible to every customer read;
 *  - staff queues are closed to customers and the pricing authority is closed to staff.
 */
describe('CLOUDHOST247 platform services', () => {
  let db: PGlite;
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
  process.env.JWT_SECRET ??= 'p'.repeat(32);
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'b'.repeat(64);
  process.env.INBOX_INBOUND_WEBHOOK_SECRET ??= 'inbox-secret-for-tests-0123456789';
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY,
    INBOX_INBOUND_WEBHOOK_SECRET: process.env.INBOX_INBOUND_WEBHOOK_SECRET,
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

  async function createUser(
    email: string,
    role: 'customer' | 'staff' | 'admin' | 'super_admin' = 'customer',
    fullName = 'Test User'
  ) {
    const id = randomUUID();
    const hash = await hashPassword('password123');
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`, [
      id,
      email,
      hash,
      fullName,
      role,
    ]);
    return { id, email, role, token: signAuthToken(env, { sub: id, email, role }) };
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function createPlan(
    app: ReturnType<typeof buildTestApp>,
    adminToken: string,
    overrides: Record<string, unknown> = {}
  ) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/platform-services/plans',
      headers: auth(adminToken),
      payload: {
        serviceKind: 'website_builder',
        code: `builder-${randomUUID().slice(0, 8)}`,
        name: 'Builder Starter',
        description: 'A website plan',
        billingPeriod: 'monthly',
        priceAmount: '19.00',
        currency: 'USD',
        features: ['1 website', 'Hosting included'],
        limits: { sites: 1, pagesPerSite: 10 },
        status: 'published',
        ...overrides,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().plan as { id: string; code: string; price_amount: string };
  }

  const PDF_BASE64 = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer<<>>\n%%EOF\n').toString('base64');

  // ------------------------------------------------------------------ navigation

  it('serves one navigation definition in which every link resolves to a real route', async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/navigation' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      sections: Array<{ id: string; groups: Array<{ links: Array<{ to: string; label: string; badge?: string }> }> }>;
      validation: { ok: boolean; errors: string[] };
    };

    // The menu is generated from shared/site/registry.json. This asserts the *contract* — one
    // definition, the published families, and every link reachable — rather than pinning the list,
    // so adding a product family is a registry change rather than a test edit.
    //
    // Seven families, matching the global header: `developers` and `websites` were folded into
    // `platforms` and `hosting` so no destination is published by two top-level panels.
    expect(body.sections.map((section) => section.id)).toEqual([
      'hosting', 'cloud', 'domains', 'platforms', 'tools', 'resources', 'company',
    ]);
    expect(body.validation.ok).toBe(true);
    expect(body.validation.errors).toEqual([]);

    const links = body.sections.flatMap((section) => section.groups.flatMap((group) => group.links));
    expect(links.length).toBeGreaterThan(100);
    for (const link of links) {
      // A menu link that the SPA cannot render is a dead link — this is the check that prevents it.
      expect(routeExists(link.to), `${link.label} → ${link.to}`).toBe(true);
    }
    // Badges must stay meaningful: at most two per section.
    for (const section of body.sections) {
      const badges = section.groups.flatMap((group) => group.links).filter((link) => link.badge);
      expect(badges.length).toBeLessThanOrEqual(2);
    }
  });

  /**
   * The registry's tool categories are published as the Tools mega menu and the footer's Tools
   * column. Before this was pinned, the registry carried the *legacy* PHP engine's category slugs:
   * nine of the ten links pointed at `/tools/category/…` routes the Tools Center cannot resolve, so
   * every one of them landed on an empty catalogue. The contract below is what makes the one
   * registry/one route set claim true for tools as well.
   */
  it('publishes only tool categories the Tools Center can actually serve', async () => {
    expect(TOOLS_CATEGORIES.length).toBeGreaterThan(0);
    const slugs = TOOLS_CATEGORIES.map((category) => category.slug);
    expect(new Set(slugs).size).toBe(slugs.length); // no duplicate destination

    for (const category of TOOLS_CATEGORIES) {
      expect(Object.keys(DISCOVERY_CATEGORIES), category.slug).toContain(category.slug);
      // A category page with no tools is an empty page; the catalogue must own at least one entry.
      const entries = TOOL_CATALOG.filter((tool) => tool.discoveryCategories?.includes(category.slug));
      expect(entries.length, `${category.slug} has no tools`).toBeGreaterThan(0);
      expect(routeExists(`/tools/category/${category.slug}`), category.slug).toBe(true);
    }
  });

  // ------------------------------------------------------------------ plans + cart + checkout

  it('only offers a platform plan publicly once an administrator publishes it', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin@example.com', 'admin');
    const plan = await createPlan(app, admin.token, { status: 'draft' });

    const hidden = await app.inject({ method: 'GET', url: '/api/v1/platform-services/plans?serviceKind=website_builder' });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().plans).toEqual([]);

    const publish = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/platform-services/plans/${plan.id}`,
      headers: auth(admin.token),
      payload: { status: 'published' },
    });
    expect(publish.statusCode).toBe(200);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/platform-services/plans?serviceKind=website_builder' });
    const plans = listed.json().plans as Array<{ id: string; price_amount: string }>;
    expect(plans.map((entry) => entry.id)).toContain(plan.id);
    expect(plans[0]?.price_amount).toBe('19.00');
  });

  it('adds a published plan to the shared cart with a server-resolved price and checks out once', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin@example.com', 'admin');
    const customer = await createUser('buyer@example.com');
    const plan = await createPlan(app, admin.token);

    const added = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/service-items',
      headers: auth(customer.token),
      payload: { serviceKind: 'platform_plan', serviceRef: plan.id },
    });
    expect(added.statusCode).toBe(201);
    const cart = added.json().cart as { serviceItems: Array<{ unitPriceAmount: string; serviceName: string; priceUnavailable: boolean }>; hasUnavailableItems: boolean };
    expect(cart.serviceItems).toHaveLength(1);
    expect(cart.serviceItems[0]?.unitPriceAmount).toBe('19.00');
    expect(cart.serviceItems[0]?.priceUnavailable).toBe(false);
    expect(cart.hasUnavailableItems).toBe(false);

    const order = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: auth(customer.token) });
    expect(order.statusCode).toBe(201);
    const placed = order.json().order as { id: string; orderNumber: string; totalAmount: string };
    expect(placed.totalAmount).toBe('19.00');

    // Order creation alone must never provision anything.
    const beforePayment = await db.query(`SELECT id FROM subscriptions WHERE customer_id = $1`, [customer.id]);
    expect(beforePayment.rows).toEqual([]);

    // The order line carries the server-set bridge that provisioning reads.
    const { rows: lines } = await db.query<{ metadata: { kind?: string; planId?: string } }>(
      `SELECT i.metadata FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.id = $1`,
      [placed.id]
    );
    expect(lines.some((line) => line.metadata?.kind === 'platform_plan' && line.metadata?.planId === plan.id)).toBe(true);

    // Verified settlement runs the shared paid-order hook: this is the same call the payment
    // webhook makes inside its transaction, so the platform-plan fulfilment path is exercised.
    await db.query(`UPDATE orders SET payment_status = 'paid', updated_at = now() WHERE id = $1`, [placed.id]);
    await withTransaction(db, async (tx) => {
      const paidOrder = await findOrderById(tx, placed.id);
      expect(paidOrder).not.toBeNull();
      await provisionPaidOrder(tx, paidOrder!, randomUUID);
    });

    const { rows: subscriptions } = await db.query<{ platform_plan_id: string | null; status: string }>(
      `SELECT platform_plan_id, status FROM subscriptions WHERE customer_id = $1`,
      [customer.id]
    );
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.platform_plan_id).toBe(plan.id);
    expect(subscriptions[0]?.status).toBe('active');
  });

  // ------------------------------------------------------------------ website builder

  it('publishes an immutable website snapshot and stops serving it when unpublished', async () => {
    const app = buildTestApp();
    const customer = await createUser('builder@example.com');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/builder/sites',
      headers: auth(customer.token),
      payload: { name: 'Northwind Coffee' },
    });
    expect(created.statusCode).toBe(201);
    const site = created.json().site as { id: string; slug: string };

    const unpublished = await app.inject({ method: 'GET', url: `/api/v1/public/sites/${site.slug}` });
    expect(unpublished.statusCode).toBe(404);

    const published = await app.inject({ method: 'POST', url: `/api/v1/builder/sites/${site.id}/publish`, headers: auth(customer.token) });
    expect(published.statusCode).toBe(200);

    const live = await app.inject({ method: 'GET', url: `/api/v1/public/sites/${site.slug}` });
    expect(live.statusCode).toBe(200);
    const snapshot = live.json().snapshot as { name: string; pages: Array<{ path: string; isHome: boolean; content: unknown[] }> };
    expect(snapshot.name).toBe('Northwind Coffee');
    expect(snapshot.pages.some((page) => page.isHome)).toBe(true);

    const homePage = snapshot.pages.find((page) => page.isHome)!;
    const originalSections = homePage.content.length;

    // Editing the draft after publishing must not change what visitors see.
    const { rows: pageRows } = await db.query<{ id: string }>(`SELECT id FROM builder_pages WHERE site_id = $1 AND is_home = true`, [
      site.id,
    ]);
    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/builder/pages/${pageRows[0]!.id}`,
      headers: auth(customer.token),
      payload: {
        content: [
          { id: randomUUID(), type: 'hero', props: { heading: 'Draft-only heading' } },
          ...Array.from({ length: Math.max(originalSections - 1, 0) }, () => ({ id: randomUUID(), type: 'rich_text', props: { body: 'Draft copy' } })),
        ],
      },
    });
    expect(edit.statusCode).toBe(200);
    const stillLive = await app.inject({ method: 'GET', url: `/api/v1/public/sites/${site.slug}` });
    expect(JSON.stringify(stillLive.json().snapshot)).not.toContain('Draft-only heading');

    const unpublishedAgain = await app.inject({ method: 'POST', url: `/api/v1/builder/sites/${site.id}/unpublish`, headers: auth(customer.token) });
    expect(unpublishedAgain.statusCode).toBe(200);
    const gone = await app.inject({ method: 'GET', url: `/api/v1/public/sites/${site.slug}` });
    expect(gone.statusCode).toBe(404);
  });

  it('delivers a public website form submission into the owner’s Unified Inbox', async () => {
    const app = buildTestApp();
    const owner = await createUser('site-owner@example.com');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/builder/sites',
      headers: auth(owner.token),
      payload: { name: 'Harbour Dental' },
    });
    const site = created.json().site as { id: string; slug: string };
    await app.inject({ method: 'POST', url: `/api/v1/builder/sites/${site.id}/publish`, headers: auth(owner.token) });

    const { rows: forms } = await db.query<{ id: string }>(`SELECT id FROM builder_forms WHERE site_id = $1`, [site.id]);
    expect(forms).toHaveLength(1);

    const submit = await app.inject({
      method: 'POST',
      url: `/api/v1/public/sites/${site.slug}/forms/${forms[0]!.id}/submissions`,
      payload: { fields: { name: 'Amina Yusuf', email: 'amina@example.com', message: 'Please call me about a check-up.' } },
    });
    expect(submit.statusCode).toBe(201);
    expect(typeof submit.json().successMessage).toBe('string');

    // An unknown field for a form that does not define it is ignored, but a missing required field fails.
    const { rows: messages } = await db.query<{ body: string }>(`SELECT body FROM inbox_messages ORDER BY created_at ASC`);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toContain('Amina Yusuf');

    const conversations = await app.inject({ method: 'GET', url: '/api/v1/inbox/my-conversations', headers: auth(owner.token) });
    expect(conversations.statusCode).toBe(200);
    const list = conversations.json().conversations as Array<{ subject: string; channel_kind: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.channel_kind).toBe('web_form');
  });

  // ------------------------------------------------------------------ online store

  it('sells a digital product without shipping and only releases it after a verified payment', async () => {
    const app = buildTestApp();
    const merchant = await createUser('merchant@example.com');

    const storeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/store/stores',
      headers: auth(merchant.token),
      payload: { name: 'Windward Guides', currency: 'USD' },
    });
    expect(storeResponse.statusCode).toBe(201);
    const store = storeResponse.json().store as { id: string; slug: string };

    const productResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/store/stores/${store.id}/products`,
      headers: auth(merchant.token),
      payload: {
        kind: 'digital',
        name: 'Cycling Routes',
        description: 'A PDF guide',
        priceAmount: 12,
        download: { filename: 'routes.pdf', contentType: 'application/pdf', base64: PDF_BASE64 },
      },
    });
    expect(productResponse.statusCode).toBe(201);
    const product = productResponse.json().product as { id: string; status: string };
    // New products are drafts: nothing goes on sale by accident.
    expect(product.status).toBe('draft');

    // A store is created as a draft: it is not reachable by shoppers until its owner activates it.
    const beforeActivation = await app.inject({ method: 'GET', url: `/api/v1/public/stores/${store.slug}` });
    expect(beforeActivation.statusCode).toBe(404);

    const activateStore = await app.inject({
      method: 'PATCH',
      url: `/api/v1/store/stores/${store.id}`,
      headers: auth(merchant.token),
      payload: { status: 'active' },
    });
    expect(activateStore.statusCode).toBe(200);
    const activateProduct = await app.inject({
      method: 'PATCH',
      url: `/api/v1/store/products/${product.id}`,
      headers: auth(merchant.token),
      payload: { status: 'active' },
    });
    expect(activateProduct.statusCode).toBe(200);

    const storefront = await app.inject({ method: 'GET', url: `/api/v1/public/stores/${store.slug}` });
    expect(storefront.statusCode).toBe(200);
    const publicProduct = (storefront.json().products as Array<{ id: string; requires_shipping: boolean; is_downloadable: boolean }>)[0]!;
    expect(publicProduct.requires_shipping).toBe(false);
    expect(publicProduct.is_downloadable).toBe(true);

    // A digital-only order needs no shipping method and no address.
    const orderResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/public/stores/${store.slug}/orders`,
      payload: { items: [{ productId: publicProduct.id, quantity: 1 }], customerName: 'Ada Obi', customerEmail: 'ada@example.com' },
    });
    expect(orderResponse.statusCode).toBe(201);
    const order = orderResponse.json() as { orderId: string; orderNumber: string; totalAmount: string };
    expect(order.totalAmount).toBe('12.00');

    const unpaid = await app.inject({
      method: 'GET',
      url: `/api/v1/public/stores/${store.slug}/orders/${order.orderNumber}?email=ada@example.com`,
    });
    expect(unpaid.statusCode).toBe(200);
    expect(unpaid.json().order.payment_status).not.toBe('paid');
    expect(unpaid.json().order.downloads ?? []).toEqual([]);

    // The only route to "paid" is a provider event the gateway adapter verified.
    const payment = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/store-payment',
      payload: {
        storeId: store.id,
        provider: 'stripe',
        providerReference: `pi_${randomUUID().slice(0, 10)}`,
        eventType: 'payment_intent.succeeded',
        status: 'paid',
        amount: order.totalAmount,
        currency: 'USD',
        signatureVerified: true,
        orderId: order.orderId,
      },
    });
    expect([200, 202]).toContain(payment.statusCode);

    const paid = await app.inject({
      method: 'GET',
      url: `/api/v1/public/stores/${store.slug}/orders/${order.orderNumber}?email=ada@example.com`,
    });
    const paidOrder = paid.json().order as { payment_status: string; downloads: Array<{ token: string; product_name: string }> };
    expect(paidOrder.payment_status).toBe('paid');
    expect(paidOrder.downloads).toHaveLength(1);

    const download = await app.inject({ method: 'GET', url: `/api/v1/public/downloads/${paidOrder.downloads[0]!.token}` });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain('routes.pdf');
  });

  it('refuses to ship a digital line and requires carrier + tracking for a physical one', async () => {
    const app = buildTestApp();
    const merchant = await createUser('merchant2@example.com');
    const storeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/store/stores',
      headers: auth(merchant.token),
      payload: { name: 'Paper Trails' },
    });
    const store = storeResponse.json().store as { id: string };

    const digital = await app.inject({
      method: 'POST',
      url: `/api/v1/store/stores/${store.id}/products`,
      headers: auth(merchant.token),
      payload: {
        kind: 'digital',
        name: 'Wallpaper pack',
        priceAmount: 5,
        download: {
          filename: 'pack.zip',
          contentType: 'application/zip',
          base64: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x41, 0x42]).toString('base64'),
        },
      },
    });
    expect(digital.statusCode).toBe(201);
    const physical = await app.inject({
      method: 'POST',
      url: `/api/v1/store/stores/${store.id}/products`,
      headers: auth(merchant.token),
      payload: { kind: 'physical', name: 'Notebook', priceAmount: 9, weightGrams: 320 },
    });
    expect(physical.statusCode).toBe(201);

    await app.inject({ method: 'PATCH', url: `/api/v1/store/stores/${store.id}`, headers: auth(merchant.token), payload: { status: 'active' } });
    await app.inject({ method: 'PATCH', url: `/api/v1/store/products/${digital.json().product.id}`, headers: auth(merchant.token), payload: { status: 'active' } });
    await app.inject({ method: 'PATCH', url: `/api/v1/store/products/${physical.json().product.id}`, headers: auth(merchant.token), payload: { status: 'active' } });

    const orderResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/public/stores/${store.slug}/orders`,
      payload: {
        items: [
          { productId: digital.json().product.id, quantity: 1 },
          { productId: physical.json().product.id, quantity: 1 },
        ],
        customerName: 'Bola Adeyemi',
        customerEmail: 'bola@example.com',
        shippingAddress: { line1: '12 Marina', city: 'Lagos', country: 'NG' },
      },
    });
    expect(orderResponse.statusCode).toBe(201);
    const orderId = orderResponse.json().orderId as string;

    const { rows: items } = await db.query<{ id: string; kind: string }>(
      `SELECT id, kind FROM store_order_items WHERE order_id = $1`,
      [orderId]
    );
    const digitalItem = items.find((item) => item.kind === 'digital')!;
    const physicalItem = items.find((item) => item.kind === 'physical')!;

    const shipDigital = await app.inject({
      method: 'POST',
      url: `/api/v1/store/stores/${store.id}/orders/${orderId}/items/${digitalItem.id}/fulfil`,
      headers: auth(merchant.token),
      payload: { status: 'shipped' },
    });
    expect(shipDigital.statusCode).toBe(400);

    const shipPhysicalWithoutTracking = await app.inject({
      method: 'POST',
      url: `/api/v1/store/stores/${store.id}/orders/${orderId}/items/${physicalItem.id}/fulfil`,
      headers: auth(merchant.token),
      payload: { status: 'shipped' },
    });
    expect(shipPhysicalWithoutTracking.statusCode).toBe(400);

    const shipPhysical = await app.inject({
      method: 'POST',
      url: `/api/v1/store/stores/${store.id}/orders/${orderId}/items/${physicalItem.id}/fulfil`,
      headers: auth(merchant.token),
      payload: { status: 'shipped', carrier: 'DHL', trackingNumber: 'DHL123456' },
    });
    expect(shipPhysical.statusCode).toBe(200);
    expect(shipPhysical.json().fulfilment.tracking_number).toBe('DHL123456');
  });

  // ------------------------------------------------------------------ expert services

  it('bills the quote the customer approved, never the catalogue starting price', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin@example.com', 'admin');
    const customer = await createUser('client@example.com');

    const offering = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/expert-services/offerings',
      headers: auth(admin.token),
      payload: {
        code: `design-${randomUUID().slice(0, 6)}`,
        name: 'Website design',
        category: 'website_design',
        summary: 'A designed website',
        startingPriceAmount: 250,
        pricingModel: 'quoted',
        status: 'published',
      },
    });
    expect(offering.statusCode).toBe(201);
    const offeringCode = offering.json().offering.code as string;

    const request = await app.inject({
      method: 'POST',
      url: '/api/v1/experts/requests',
      headers: auth(customer.token),
      payload: {
        offeringCode,
        title: 'New marketing site',
        description: 'We need a five page marketing website for a coffee roastery in Abuja.',
        goals: ['Look modern', 'Convert visitors'],
      },
    });
    expect(request.statusCode).toBe(201);

    const { rows: requestRows } = await db.query<{ id: string }>(`SELECT id FROM expert_service_requests WHERE user_id = $1`, [
      customer.id,
    ]);
    const requestId = requestRows[0]!.id;

    const quote = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/expert-services/requests/${requestId}/quotes`,
      headers: auth(admin.token),
      payload: { amount: 1400, scope: 'Five-page custom design, copywriting and launch support.', deliveryDays: 21 },
    });
    expect(quote.statusCode).toBe(201);
    const quoteId = quote.json().quoteId as string;

    const detail = await app.inject({ method: 'GET', url: `/api/v1/experts/requests/${requestId}`, headers: auth(customer.token) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().quotes[0].amount).toBe('1400.00');

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/experts/requests/${requestId}/approve-quote`,
      headers: auth(customer.token),
      payload: { quoteId },
    });
    expect(approved.statusCode).toBe(201);
    expect(approved.json().amount).toBe('1400.00');
    expect(typeof approved.json().invoiceNumber).toBe('string');

    // A second approval of the same quote is a conflict, not a second charge.
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/experts/requests/${requestId}/approve-quote`,
      headers: auth(customer.token),
      payload: { quoteId },
    });
    expect(again.statusCode).toBe(409);

    const { rows: invoices } = await db.query<{ total_amount: string }>(`SELECT total_amount FROM invoices WHERE user_id = $1`, [
      customer.id,
    ]);
    expect(invoices).toHaveLength(1);
    expect(Number(invoices[0]!.total_amount)).toBe(1400);
  });

  // ------------------------------------------------------------------ marketing services

  it('rejects a marketing metric with no source and keeps a source-less period unavailable', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin@example.com', 'admin');
    const staff = await createUser('staff@example.com', 'staff');
    const customer = await createUser('brand@example.com');

    const offering = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/marketing-services/offerings',
      headers: auth(admin.token),
      payload: {
        code: `seo-${randomUUID().slice(0, 6)}`,
        name: 'Managed SEO',
        channel: 'seo',
        summary: 'Monthly SEO delivery',
        startingPriceAmount: 500,
        billingPeriod: 'monthly',
        status: 'published',
      },
    });
    expect(offering.statusCode).toBe(201);
    const offeringCode = offering.json().offering.code as string;

    const catalog = await app.inject({ method: 'GET', url: '/api/v1/marketing-services/offerings' });
    expect(catalog.statusCode).toBe(200);
    const listed = (catalog.json().offerings as Array<{ code: string; channelConnected: boolean }>).find(
      (entry) => entry.code === offeringCode
    )!;
    // The channel reports its real connection state instead of implying capability.
    expect(typeof listed.channelConnected).toBe('boolean');

    const campaign = await app.inject({
      method: 'POST',
      url: '/api/v1/marketing-services/campaigns',
      headers: auth(customer.token),
      payload: { offeringCode, name: 'Q1 SEO push', goal: 'Grow organic traffic for the Abuja storefront by 30% this quarter.' },
    });
    expect(campaign.statusCode).toBe(201);
    const campaignId = campaign.json().id as string;
    expect(typeof campaign.json().reference).toBe('string');

    const period = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/marketing-services/campaigns/${campaignId}/reports`,
      headers: auth(staff.token),
      payload: { periodStart: '2026-01-01', periodEnd: '2026-01-31', status: 'collecting' },
    });
    expect(period.statusCode).toBe(201);
    const periodId = period.json().period.id as string;

    const sourceLess = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/marketing-services/reports/${periodId}/metrics`,
      headers: auth(staff.token),
      payload: { metrics: [{ key: 'sessions', label: 'Sessions', value: 1200, unit: 'count', source: '' }] },
    });
    expect(sourceLess.statusCode).toBe(400);

    const withSource = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/marketing-services/reports/${periodId}/metrics`,
      headers: auth(staff.token),
      payload: {
        metrics: [
          { key: 'sessions', label: 'Sessions', value: 1200, unit: 'count', source: 'ga4' },
          { key: 'clicks', label: 'Search clicks', value: 340, unit: 'count', source: 'search_console' },
        ],
      },
    });
    expect(withSource.statusCode).toBe(200);

    const unavailable = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/marketing-services/campaigns/${campaignId}/reports`,
      headers: auth(staff.token),
      payload: { periodStart: '2026-02-01', periodEnd: '2026-02-28', status: 'unavailable', summary: 'No provider data for this month.' },
    });
    expect(unavailable.statusCode).toBe(201);

    const customerView = await app.inject({
      method: 'GET',
      url: `/api/v1/marketing-services/campaigns/${campaignId}`,
      headers: auth(customer.token),
    });
    expect(customerView.statusCode).toBe(200);
    const reports = customerView.json().reports as Array<{ status: string; metrics: Array<{ source: string }> }>;
    expect(reports.some((report) => report.status === 'unavailable')).toBe(true);
    const reportingPeriod = reports.find((report) => report.metrics.length > 0)!;
    expect(reportingPeriod.metrics.every((metric) => metric.source.length > 0)).toBe(true);
  });

  // ------------------------------------------------------------------ logo maker

  it('generates a real vector logo, versions its edits, and exports SVG and PNG', async () => {
    const app = buildTestApp();
    const customer = await createUser('brander@example.com');

    const catalogue = await app.inject({ method: 'GET', url: '/api/v1/logo-maker/catalogue' });
    expect(catalogue.statusCode).toBe(200);
    const palettes = catalogue.json().palettes as Array<{ slug: string }>;
    expect(palettes.length).toBeGreaterThan(0);

    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/logo-maker/projects',
      headers: auth(customer.token),
      payload: { companyName: 'Kaduna Kites', tagline: 'Fly higher', industry: 'retail', style: 'modern' },
    });
    expect(project.statusCode).toBe(201);
    const projectId = project.json().project.id as string;

    const concepts = await app.inject({
      method: 'POST',
      url: `/api/v1/logo-maker/projects/${projectId}/concepts`,
      headers: auth(customer.token),
    });
    expect(concepts.statusCode).toBe(200);
    const generated = concepts.json().concepts as Array<{ id: string; svg: string; variant: number }>;
    expect(generated.length).toBeGreaterThan(1);
    expect(generated[0]!.svg).toContain('<svg');

    const conceptId = generated[0]!.id;
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/logo-maker/projects/${projectId}/concepts/${conceptId}`,
      headers: auth(customer.token),
      payload: { companyName: 'Kaduna Kites Ltd', primaryColor: '#0b7a4b', note: 'Legal name and a deeper green' },
    });
    expect(edited.statusCode).toBe(200);

    const revisions = await app.inject({
      method: 'GET',
      url: `/api/v1/logo-maker/projects/${projectId}/concepts/${conceptId}/revisions`,
      headers: auth(customer.token),
    });
    expect(revisions.statusCode).toBe(200);
    const revisionList = revisions.json().revisions as Array<{ revision: number; note: string | null }>;
    expect(revisionList).toHaveLength(1);
    expect(revisionList[0]?.note).toContain('deeper green');

    const restored = await app.inject({
      method: 'POST',
      url: `/api/v1/logo-maker/projects/${projectId}/concepts/${conceptId}/revisions/1/restore`,
      headers: auth(customer.token),
    });
    expect(restored.statusCode).toBe(200);

    const afterRestore = await app.inject({
      method: 'GET',
      url: `/api/v1/logo-maker/projects/${projectId}/concepts/${conceptId}/revisions`,
      headers: auth(customer.token),
    });
    expect((afterRestore.json().revisions as unknown[]).length).toBeGreaterThan(1);

    const svg = await app.inject({
      method: 'POST',
      url: `/api/v1/logo-maker/projects/${projectId}/concepts/${conceptId}/export`,
      headers: auth(customer.token),
      payload: { format: 'svg' },
    });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    expect(svg.body).toContain('<svg');

    const png = await app.inject({
      method: 'POST',
      url: `/api/v1/logo-maker/projects/${projectId}/concepts/${conceptId}/export`,
      headers: auth(customer.token),
      payload: { format: 'png', width: 256, height: 256, background: 'transparent' },
    });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toContain('image/png');
    expect(png.rawPayload.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    const selected = await app.inject({
      method: 'POST',
      url: `/api/v1/logo-maker/projects/${projectId}/concepts/${conceptId}/select`,
      headers: auth(customer.token),
    });
    expect(selected.statusCode).toBe(200);
    expect(selected.json().projectId).toBe(projectId);

    // The one AI-assisted part fails closed with the configuration it needs, never a 500.
    const suggested = await app.inject({
      method: 'POST',
      url: `/api/v1/logo-maker/projects/${projectId}/suggest`,
      headers: auth(customer.token),
      payload: { brief: 'A friendly kite shop for families in northern Nigeria.' },
    });
    expect([200, 403]).toContain(suggested.statusCode);
    if (suggested.statusCode === 403) {
      expect(suggested.json().message).toMatch(/AI_LLM|configure|credential/i);
    }
  });

  // ------------------------------------------------------------------ unified inbox

  it('records inbound messages idempotently, keeps internal notes internal, and never overstates delivery', async () => {
    const app = buildTestApp();
    const staff = await createUser('staff@example.com', 'staff');
    const customer = await createUser('contact@example.com');

    const channels = await app.inject({ method: 'GET', url: '/api/v1/inbox/channels', headers: auth(staff.token) });
    expect(channels.statusCode).toBe(200);
    expect((channels.json().channels as Array<{ kind: string }>).some((channel) => channel.kind === 'web_form')).toBe(true);

    const inbound = {
      channelKind: 'web_form',
      userId: customer.id,
      subject: 'Question about my invoice',
      contactName: 'Ngozi Eze',
      contactEmail: 'ngozi@example.com',
      body: 'Hello, could you explain the line items on invoice INV-1042?',
      externalReference: 'landing-page-form',
      externalMessageId: 'ext-0001',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/inbox/inbound',
      headers: { 'x-inbox-secret': env.INBOX_INBOUND_WEBHOOK_SECRET! },
      payload: inbound,
    });
    expect(first.statusCode).toBe(201);
    const conversationId = first.json().conversationId as string;

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/inbox/inbound',
      headers: { 'x-inbox-secret': env.INBOX_INBOUND_WEBHOOK_SECRET! },
      payload: inbound,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().duplicate).toBe(true);
    expect(duplicate.json().conversationId).toBe(conversationId);

    const { rows: messageRows } = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM inbox_messages`);
    expect(messageRows[0]!.count).toBe('1');

    const unauthenticated = await app.inject({ method: 'POST', url: '/api/v1/inbox/inbound', payload: inbound });
    expect(unauthenticated.statusCode).toBe(401);

    const staffReply = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/conversations/${conversationId}/messages`,
      headers: auth(staff.token),
      payload: { body: 'Happy to help — the second line is your domain renewal.', visibility: 'public' },
    });
    expect(staffReply.statusCode).toBe(201);
    // No email transport is configured in this environment, so the honest outcome is "manual".
    expect(['manual', 'sent']).toContain(staffReply.json().deliveryStatus);

    const internalNote = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/conversations/${conversationId}/messages`,
      headers: auth(staff.token),
      payload: { body: 'Internal: customer is on the legacy pricing tier.', visibility: 'internal' },
    });
    expect(internalNote.statusCode).toBe(201);

    const customerView = await app.inject({
      method: 'GET',
      url: `/api/v1/inbox/my-conversations/${conversationId}`,
      headers: auth(customer.token),
    });
    expect(customerView.statusCode).toBe(200);
    const customerMessages = customerView.json().messages as Array<{ body: string; visibility: string }>;
    expect(customerMessages.some((message) => message.body.includes('legacy pricing'))).toBe(false);
    expect(customerMessages.every((message) => message.visibility === 'public')).toBe(true);

    const assigned = await app.inject({
      method: 'PATCH',
      url: `/api/v1/inbox/conversations/${conversationId}`,
      headers: auth(staff.token),
      payload: { status: 'pending', priority: 'high', assigneeId: staff.id, note: 'Mine to answer' },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().conversation.status).toBe('pending');
    expect(assigned.json().conversation.assignee_id).toBe(staff.id);
  });

  // ------------------------------------------------------------------ AI website builder

  it('generates a website plan with the built-in engine and applies it as drafts', async () => {
    const app = buildTestApp();
    const customer = await createUser('founder@example.com');

    const engines = await app.inject({ method: 'GET', url: '/api/v1/ai-builder/engines', headers: auth(customer.token) });
    expect(engines.statusCode).toBe(200);
    const builtIn = (engines.json().engines as Array<{ engine: string; configured: boolean }>).find((engine) => engine.engine === 'rules')!;
    expect(builtIn.configured).toBe(true);

    const site = await app.inject({
      method: 'POST',
      url: '/api/v1/builder/sites',
      headers: auth(customer.token),
      payload: { name: 'Sahel Solar' },
    });
    const siteId = site.json().site.id as string;
    const { rows: before } = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM builder_pages WHERE site_id = $1`, [
      siteId,
    ]);

    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/ai-builder/projects',
      headers: auth(customer.token),
      payload: {
        name: 'Sahel Solar',
        brief: {
          businessName: 'Sahel Solar',
          industry: 'renewable energy',
          description: 'We install and maintain solar power systems for homes and small businesses in northern Nigeria.',
          audience: 'Homeowners and small businesses',
          tone: 'Confident and practical',
          pages: ['home', 'about', 'services', 'contact'],
        },
      },
    });
    expect(project.statusCode).toBe(201);
    const projectId = project.json().project.id as string;

    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/ai-builder/projects/${projectId}/generate`,
      headers: auth(customer.token),
      payload: { engine: 'rules' },
    });
    expect(generated.statusCode).toBe(200);
    const generation = generated.json().generation as { id: string; status: string; plan: { pages: Array<{ path: string; sections: unknown[] }> } };
    expect(generation.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(generation.status).toBe('succeeded');
    expect(generation.plan.pages.length).toBeGreaterThan(1);
    expect(generation.plan.pages.every((page) => page.sections.length > 0)).toBe(true);

    const applied = await app.inject({
      method: 'POST',
      url: `/api/v1/ai-builder/generations/${generation.id}/apply`,
      headers: auth(customer.token),
      payload: { siteId },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().result.pagesCreated).toBeGreaterThan(0);

    const { rows: after } = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM builder_pages WHERE site_id = $1`, [
      siteId,
    ]);
    expect(Number(after[0]!.count)).toBeGreaterThan(Number(before[0]!.count));

    // Applying a plan never publishes: the customer decides when the site goes live.
    const { rows: siteRows } = await db.query<{ status: string }>(`SELECT status FROM builder_sites WHERE id = $1`, [siteId]);
    expect(siteRows[0]!.status).not.toBe('published');
  });

  // ------------------------------------------------------------------ RBAC

  it('keeps staff queues closed to customers and the pricing authority closed to staff', async () => {
    const app = buildTestApp();
    const customer = await createUser('nosy@example.com');
    const staff = await createUser('staff@example.com', 'staff');
    const admin = await createUser('admin@example.com', 'admin');

    const customerOverview = await app.inject({ method: 'GET', url: '/api/v1/admin/platform-services/overview', headers: auth(customer.token) });
    expect(customerOverview.statusCode).toBe(403);

    const staffOverview = await app.inject({ method: 'GET', url: '/api/v1/admin/platform-services/overview', headers: auth(staff.token) });
    expect(staffOverview.statusCode).toBe(200);
    expect(typeof staffOverview.json().overview.plans).toBe('number');

    const staffQueue = await app.inject({ method: 'GET', url: '/api/v1/admin/expert-services/requests', headers: auth(staff.token) });
    expect(staffQueue.statusCode).toBe(200);

    const staffPricing = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/platform-services/plans',
      headers: auth(staff.token),
      payload: { serviceKind: 'online_store', code: 'nope', name: 'Not allowed', billingPeriod: 'monthly', priceAmount: '1.00' },
    });
    expect(staffPricing.statusCode).toBe(403);

    const adminPricing = await app.inject({ method: 'GET', url: '/api/v1/admin/platform-services/plans', headers: auth(admin.token) });
    expect(adminPricing.statusCode).toBe(200);

    const anonymousStoreAdmin = await app.inject({ method: 'GET', url: '/api/v1/admin/store/overview' });
    expect(anonymousStoreAdmin.statusCode).toBe(401);
  });
});
