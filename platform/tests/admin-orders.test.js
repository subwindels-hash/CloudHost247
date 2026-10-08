/**
 * Admin/staff order surface — the routes `commerce.ts` deferred to Phase 5F.
 *
 * The gap was concrete: staff could open an invoice and see an order *number*, but there was no way
 * to list orders, open one, or see what it turned into. These tests treat the surface as something a
 * support agent actually uses — find the order, read the line items, follow it into billing and
 * fulfilment — and pin the one mutation to the rule that makes it safe: money already moved means the
 * order cannot be quietly cancelled.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { startServer, jsonFetch, register } = require('./helpers');
const { uuidv7 } = require('../src/lib/ids');

const JWT_SECRET = 'admin-orders-test-secret-value-32';

async function signIn(base, app, email, role) {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  if (role) await app.store.table('users').updateById(user.id, { role, full_name: role === 'customer' ? 'Order Customer' : 'Order Staff' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' } });
  return { token: login.data.accessToken, userId: user.id };
}

const list = (base, token, qs = '') => jsonFetch(base, { path: `/api/v1/admin/orders${qs}` }, token);
const detail = (base, token, id) => jsonFetch(base, { path: `/api/v1/admin/orders/${id}` }, token);
const cancel = (base, token, id, reason) => jsonFetch(base, { path: `/api/v1/admin/orders/${id}/cancel`, method: 'POST', body: { reason } }, token);

/** One pending order with a line item, an unpaid invoice, a pending payment and a ledger charge. */
async function seedPendingOrder(app, { userId, reference, total = 1200, createdAt }) {
  const order = await app.store.table('orders').insert({
    id: uuidv7(), user_id: userId, reference, currency: 'USD', subtotal: total, tax_total: 0,
    discount_total: 0, total, status: 'pending', ...(createdAt ? { created_at: createdAt } : {}),
  });
  const plan = await app.store.table('catalog_product_plans').insert({
    id: uuidv7(), product_id: uuidv7(), slug: `plan-${reference}`, name: 'Business Hosting', status: 'active',
  });
  const product = await app.store.table('catalog_products').findById(plan.product_id);
  const productRow = product ?? await app.store.table('catalog_products').insert({
    id: plan.product_id, slug: `product-${reference}`, name: 'Web Hosting', category: 'hosting', status: 'active',
  });
  await app.store.table('order_items').insert({
    id: uuidv7(), order_id: order.id, plan_id: plan.id, description: 'Business Hosting — annual',
    quantity: 1, billing_cycle: 'annual', unit_price: total, line_total: total,
  });
  const invoice = await app.store.table('invoices').insert({
    id: uuidv7(), user_id: userId, order_id: order.id, number: `INV-${reference}`, currency: 'USD',
    subtotal: total, tax_total: 0, discount_total: 0, total, amount_paid: 0, status: 'unpaid',
    issued_at: createdAt ?? new Date().toISOString(),
  });
  const payment = await app.store.table('payments').insert({
    id: uuidv7(), user_id: userId, invoice_id: invoice.id, order_id: order.id, gateway: 'manual',
    currency: 'USD', amount: total, status: 'pending',
  });
  await app.store.table('billing_ledger').insert({
    id: uuidv7(), user_id: userId, invoice_id: invoice.id, entry_type: 'charge', amount: total, currency: 'USD',
    description: `Charge for ${reference}`,
  });
  return { order, invoice, payment, plan, product: productRow };
}

test('staff can list and open orders; customers and anonymous callers cannot', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET });
  t.after(() => close());

  const staff = await signIn(base, app, 'orders-staff@example.com', 'staff');
  const customer = await signIn(base, app, 'orders-customer@example.com', 'customer');
  const other = await signIn(base, app, 'orders-other@example.com', 'customer');

  const first = await seedPendingOrder(app, { userId: customer.userId, reference: 'ORD-1001', total: 1200 });
  const second = await seedPendingOrder(app, { userId: other.userId, reference: 'ORD-1002', total: 450 });

  // Guests and customers are refused: this is the staff console.
  assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/orders' })).status, 401);
  assert.strictEqual((await list(base, customer.token)).status, 403);
  assert.strictEqual((await detail(base, customer.token, first.order.id)).status, 403);

  const all = await list(base, staff.token);
  assert.strictEqual(all.status, 200, JSON.stringify(all.data));
  assert.strictEqual(all.data.total, 2);
  assert.deepStrictEqual(all.data.orders.map((o) => o.reference).sort(), ['ORD-1001', 'ORD-1002']);
  const row = all.data.orders.find((o) => o.reference === 'ORD-1001');
  assert.strictEqual(row.userEmail, 'orders-customer@example.com');
  assert.strictEqual(row.itemCount, 1);
  assert.strictEqual(row.invoiceNumber, 'INV-ORD-1001');
  assert.strictEqual(row.invoiceStatus, 'unpaid');
  assert.strictEqual(row.paymentStatus, 'pending', 'an attempt exists but has not settled');
  assert.strictEqual(row.total, 1200);

  // Filters are applied by the store, and the reported total is the filtered total.
  const byUser = await list(base, staff.token, `?userId=${customer.userId}`);
  assert.strictEqual(byUser.data.total, 1);
  assert.strictEqual(byUser.data.orders[0].reference, 'ORD-1001');
  const byReference = await list(base, staff.token, '?reference=1002');
  assert.strictEqual(byReference.data.total, 1);
  assert.strictEqual(byReference.data.orders[0].reference, 'ORD-1002');
  const byStatus = await list(base, staff.token, '?status=pending');
  assert.strictEqual(byStatus.data.total, 2);
  const noneYet = await list(base, staff.token, '?status=paid');
  assert.strictEqual(noneYet.data.total, 0);
  assert.deepStrictEqual(noneYet.data.orders, []);
  const badStatus = await list(base, staff.token, '?status=whatever');
  assert.strictEqual(badStatus.status, 400, 'an unknown status is refused, not silently matched');

  // Pagination is real: the window and the total are independent.
  const page = await list(base, staff.token, '?limit=1&offset=1');
  assert.strictEqual(page.data.orders.length, 1);
  assert.strictEqual(page.data.total, 2);
  assert.strictEqual(page.data.limit, 1);
  assert.strictEqual(page.data.offset, 1);

  // A bad id is a 400, an unknown one a 404 — never an empty "order".
  assert.strictEqual((await detail(base, staff.token, 'not-a-uuid')).status, 400);
  assert.strictEqual((await detail(base, staff.token, uuidv7())).status, 404);
  const admin = await signIn(base, app, 'orders-admin@example.com', 'admin');
  assert.strictEqual((await cancel(base, admin.token, uuidv7(), 'nope')).status, 404, 'unknown orders are not cancellable either');

  assert.strictEqual(second.order.status, 'pending');
});

test('the order detail shows what the platform actually recorded for it', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET });
  t.after(() => close());

  const staff = await signIn(base, app, 'detail-staff@example.com', 'staff');
  const customer = await signIn(base, app, 'detail-customer@example.com', 'customer');
  const { order, invoice } = await seedPendingOrder(app, { userId: customer.userId, reference: 'ORD-2001', total: 2400 });

  // Fulfilment rows, seeded the way the provisioners write them.
  const installation = await app.store.table('application_installations').insert({
    id: uuidv7(), user_id: customer.userId, application_id: uuidv7(), name: 'WordPress site',
    domain: 'shop.example.com', order_id: order.id, status: 'queued', health_status: 'unknown',
  });
  await app.store.table('deployments').insert({
    id: uuidv7(), user_id: customer.userId, installation_id: installation.id, action: 'install',
    status: 'failed', error_code: 'PROVIDER_TIMEOUT', created_at: new Date().toISOString(),
  });
  const service = await app.store.table('customer_services').insert({
    id: uuidv7(), user_id: customer.userId, label: 'Business Hosting', status: 'pending', order_id: order.id,
  });
  await app.store.table('provisioning_jobs').insert({
    id: uuidv7(), user_id: customer.userId, kind: 'create_service', resource_type: 'service',
    resource_id: service.id, service_id: service.id, status: 'queued', attempts: 0,
  });

  const res = await detail(base, staff.token, order.id);
  assert.strictEqual(res.status, 200, JSON.stringify(res.data));
  const dto = res.data.order;
  assert.strictEqual(dto.reference, 'ORD-2001');
  assert.strictEqual(dto.customer.email, 'detail-customer@example.com');
  assert.strictEqual(dto.items.length, 1);
  assert.strictEqual(dto.items[0].planName, 'Business Hosting');
  assert.strictEqual(dto.items[0].lineTotalAmount, 2400);

  assert.strictEqual(dto.billing.length, 1);
  assert.strictEqual(dto.billing[0].invoice.number, 'INV-ORD-2001');
  assert.strictEqual(dto.billing[0].invoice.totalAmount, 2400);
  assert.strictEqual(dto.billing[0].ledger.length, 1);
  assert.strictEqual(dto.billing[0].ledger[0].entryType, 'charge');
  assert.strictEqual(dto.billing[0].payments.length, 1);
  assert.strictEqual(dto.billing[0].payments[0].status, 'pending');

  assert.strictEqual(dto.fulfilment.installations.length, 1);
  assert.strictEqual(dto.fulfilment.installations[0].name, 'WordPress site');
  assert.strictEqual(dto.fulfilment.installations[0].deployments.length, 1);
  assert.strictEqual(dto.fulfilment.installations[0].deployments[0].errorCode, 'PROVIDER_TIMEOUT');
  assert.strictEqual(dto.fulfilment.services.length, 1);
  assert.strictEqual(dto.fulfilment.services[0].label, 'Business Hosting');
  assert.strictEqual(dto.fulfilment.provisioningJobs.length, 1);
  assert.strictEqual(dto.fulfilment.provisioningJobs[0].kind, 'create_service');

  // Nothing is invented for an order that has no fulfilment yet.
  const bare = await seedPendingOrder(app, { userId: customer.userId, reference: 'ORD-2002', total: 100 });
  const bareDto = (await detail(base, staff.token, bare.order.id)).data.order;
  assert.deepStrictEqual(bareDto.fulfilment, { installations: [], services: [], provisioningJobs: [] });
  assert.strictEqual(bareDto.billing[0].invoice.number, 'INV-ORD-2002');

  // The route reports the guards the cancel route will enforce, including where to refund instead.
  assert.strictEqual(dto.cancellation.cancellable, true);
  assert.strictEqual(dto.cancellation.reason, null);
  assert.strictEqual(dto.cancellation.refundPath, `/api/v1/admin/invoices/${invoice.id}/refund`);
});

test('cancelling a pending order voids its invoice, fails its attempts, and says who and why', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET });
  t.after(() => close());

  const staff = await signIn(base, app, 'cancel-staff@example.com', 'staff');
  const admin = await signIn(base, app, 'cancel-admin@example.com', 'admin');
  const customer = await signIn(base, app, 'cancel-customer@example.com', 'customer');
  const { order, invoice, payment } = await seedPendingOrder(app, { userId: customer.userId, reference: 'ORD-3001', total: 800 });

  // Staff can read the order but not cancel it — the mutation is admin-only.
  const refused = await cancel(base, staff.token, order.id, 'customer asked');
  assert.strictEqual(refused.status, 403, JSON.stringify(refused.data));

  const missingReason = await jsonFetch(base, { path: `/api/v1/admin/orders/${order.id}/cancel`, method: 'POST', body: {} }, admin.token);
  assert.strictEqual(missingReason.status, 400, 'a cancellation without a reason is not a recorded decision');

  const res = await cancel(base, admin.token, order.id, 'duplicate order created by the customer');
  assert.strictEqual(res.status, 200, JSON.stringify(res.data));
  assert.strictEqual(res.data.order.status, 'cancelled');
  assert.deepStrictEqual(res.data.voidedInvoices, [{ id: invoice.id, number: 'INV-ORD-3001' }]);

  const after = await app.store.table('orders').findById(order.id);
  assert.strictEqual(after.status, 'cancelled');
  const afterInvoice = await app.store.table('invoices').findById(invoice.id);
  assert.strictEqual(afterInvoice.status, 'void');
  const afterPayment = await app.store.table('payments').findById(payment.id);
  assert.strictEqual(afterPayment.status, 'failed');
  assert.match(afterPayment.rejection_reason, /Order cancelled: duplicate order created by the customer/);
  assert.strictEqual(afterPayment.confirmed_by, admin.userId);

  const audits = (await app.store.table('audit_logs').all()).filter((row) => row.action === 'admin_order_cancelled');
  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].entity_id, order.id);
  assert.strictEqual(audits[0].after.reason, 'duplicate order created by the customer');
  assert.deepStrictEqual(audits[0].after.voidedInvoices, ['INV-ORD-3001']);
  assert.strictEqual(audits[0].after.customerId, customer.userId);

  // A cancelled order cannot be cancelled again, and the refusal names what its status is.
  const twice = await cancel(base, admin.token, order.id, 'again');
  assert.strictEqual(twice.status, 400);
  assert.match(twice.data.message, /status 'cancelled'/);

  // The read side agrees: it is no longer cancellable and says why.
  const dto = (await detail(base, admin.token, order.id)).data.order;
  assert.strictEqual(dto.cancellation.cancellable, false);
  assert.match(dto.cancellation.reason, /only pending orders can be cancelled/);
  assert.strictEqual(dto.cancellation.refundPath, null, 'a voided invoice is not offered as the refund path');
  assert.strictEqual((await app.store.table('invoices').findById(invoice.id)).status, 'void');
});

test('an order whose money moved is refunded, not cancelled — and the refusal says where', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET });
  t.after(() => close());

  const admin = await signIn(base, app, 'settled-admin@example.com', 'admin');
  const customer = await signIn(base, app, 'settled-customer@example.com', 'customer');
  const { order, invoice, payment } = await seedPendingOrder(app, { userId: customer.userId, reference: 'ORD-4001', total: 5000 });

  // The invoice settled: order paid, invoice paid, payment succeeded.
  await app.store.table('orders').updateById(order.id, { status: 'paid' });
  await app.store.table('invoices').updateById(invoice.id, { status: 'paid', amount_paid: 5000, paid_at: new Date().toISOString() });
  await app.store.table('payments').updateById(payment.id, { status: 'succeeded', confirmed_at: new Date().toISOString() });

  const res = await cancel(base, admin.token, order.id, 'customer changed their mind');
  assert.strictEqual(res.status, 400);
  assert.match(res.data.message, /Cannot cancel an order with status 'paid'/);
  assert.match(res.data.message, /invoices\/:id\/refund/, 'the refusal names the route that can actually help');

  // Nothing moved: the money rows are exactly as they were.
  assert.strictEqual((await app.store.table('orders').findById(order.id)).status, 'paid');
  assert.strictEqual((await app.store.table('invoices').findById(invoice.id)).status, 'paid');
  assert.strictEqual((await app.store.table('payments').findById(payment.id)).status, 'succeeded');
  assert.strictEqual((await app.store.table('audit_logs').all()).filter((row) => row.action === 'admin_order_cancelled').length, 0);

  // The detail view offers the refund path and marks the order uncancellable.
  const dto = (await detail(base, admin.token, order.id)).data.order;
  assert.strictEqual(dto.cancellation.cancellable, false);
  assert.match(dto.cancellation.reason, /settled payment/);
  assert.strictEqual(dto.cancellation.refundPath, `/api/v1/admin/invoices/${invoice.id}/refund`);
});
