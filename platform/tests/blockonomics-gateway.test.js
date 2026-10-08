/**
 * Blockonomics gateway — the platform's Bitcoin callback endpoint.
 *
 * The WHMCS build had a Blockonomics plugin; the `platform/` build had nothing at all, so this suite
 * is written against the plugin's actual rules (`modules/gateways/callback/blockonomics.php`): a
 * timing-safe secret carried in the callback URL's query string, every field shape-checked before
 * use, an address that must be one the platform issued, and a payment that does not move on an
 * unconfirmed transaction.
 *
 * The suite also pins the boundary the port runs into, because it is the honest half of the answer:
 * the platform's money columns hold two decimals (`NUMERIC(16,2)`, mirrored by the JSON backend), so
 * a Bitcoin amount can be *verified and recorded* but not *credited* — it would be stored as 0 while
 * the payment was marked succeeded. Every case below asserts the refusal names that reason and that
 * no money moved, rather than pretending a conversion happened.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { startServer, jsonFetch, register } = require('./helpers');
const { uuidv7 } = require('../src/lib/ids');
const gateway = require('../src/lib/gateways/blockonomics');
const money = require('../src/lib/money');

const JWT_SECRET = 'blockonomics-test-secret-value-32chars';
const CALLBACK_SECRET = 'blockonomics-callback-secret-40chars-abcd';
const ADDRESS = 'bc1qexampleaddress0000000000000000000000';
const TXID = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12';

const question = (params) => new URLSearchParams(params).toString();
const delivery = (base, params, secret = CALLBACK_SECRET) => fetch(
  `${base}/api/v1/webhooks/blockonomics?${question(secret === null ? params : { ...params, secret })}`,
);

/** Read a response body exactly once, as parsed JSON when it is JSON. */
async function bodyOf(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function customer(base, app, email) {
  await register(base, email, 'SuperSecret123!');
  return app.store.table('users').findOne({ email });
}

/** A USD invoice with a pending crypto payment against it — what the plugin's checkout would create. */
async function seedInvoiceWithCryptoPayment(app, { userId, currency = 'USD', total = 25, reference = ADDRESS }) {
  const invoice = await app.store.table('invoices').insert({
    id: uuidv7(), user_id: userId, number: `INV-BTC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    currency, subtotal: total, tax_total: 0, discount_total: 0, total, amount_paid: 0,
    status: 'unpaid', issued_at: new Date().toISOString(),
  });
  const payment = await app.store.table('payments').insert({
    id: uuidv7(), user_id: userId, invoice_id: invoice.id, gateway: 'blockonomics',
    gateway_reference: reference, currency: 'BTC', amount: 0.00042, status: 'pending',
  });
  return { invoice, payment };
}

// ============================================================================ unit: the gateway itself

test('the gateway verifies its callback secret, in constant time, and refuses everything else', async () => {
  const config = { BLOCKONOMICS_CALLBACK_SECRET: CALLBACK_SECRET };

  assert.strictEqual(gateway.queryCallback, true, 'the receiver must know this gateway is query-driven');
  assert.strictEqual(gateway.isConfigured(config), true);
  assert.strictEqual(gateway.isConfigured({}), false);

  const good = await gateway.verify(Buffer.from(''), {}, config, { query: { secret: CALLBACK_SECRET } });
  assert.strictEqual(good, true);
  assert.strictEqual(await gateway.verify(Buffer.from(''), {}, config, { query: { secret: 'nope' } }), false);
  assert.strictEqual(await gateway.verify(Buffer.from(''), {}, config, { query: { secret: '' } }), false);
  assert.strictEqual(await gateway.verify(Buffer.from(''), {}, config, { query: {} }), false);
  assert.strictEqual(await gateway.verify(Buffer.from(''), {}, config, { query: { secret: `${CALLBACK_SECRET} ` } }), false);
  // An unconfigured gateway cannot verify anything — not even with the right secret.
  assert.strictEqual(await gateway.verify(Buffer.from(''), {}, {}, { query: { secret: CALLBACK_SECRET } }), false);
});

test('the parser settles only on confirmation, and refuses malformed or unsupported callbacks', () => {
  const config = { BLOCKONOMICS_CALLBACK_SECRET: CALLBACK_SECRET, BLOCKONOMICS_CONFIRMATIONS: 2 };
  const base = { secret: CALLBACK_SECRET, addr: ADDRESS, txid: TXID, value: '42000' };
  const parse = (query, cfg = config) => gateway.parseEvent(Buffer.from(''), {}, 'hash', { query, config: cfg });

  const confirmed = parse({ ...base, status: '2' });
  assert.strictEqual(confirmed.canonicalEventType, 'payment.success');
  assert.strictEqual(confirmed.outcome, 'succeeded');
  assert.strictEqual(confirmed.currency, 'BTC');
  assert.strictEqual(confirmed.amountCents, 42000, 'minor units are satoshis for BTC');
  assert.strictEqual(confirmed.providerPaymentReference, ADDRESS, 'the address is the payment reference');
  assert.strictEqual(confirmed.confirmationsRequired, 2);

  // Unconfirmed is recorded and ignored — never settled, and never retried forever either.
  for (const status of ['0', '1']) {
    const pending = parse({ ...base, status });
    assert.strictEqual(pending.canonicalEventType, 'unhandled');
    assert.strictEqual(pending.outcome, 'pending');
  }
  // Distinct event ids per confirmation level: the *transition* to confirmed is a new event and must
  // not be deduplicated away, while a re-delivery of the same level must be.
  assert.notStrictEqual(parse({ ...base, status: '1' }).providerEventId, parse({ ...base, status: '2' }).providerEventId);
  assert.strictEqual(parse({ ...base, status: '2' }).providerEventId, confirmed.providerEventId);

  // The required confirmations are the operator's setting, never the caller's.
  const strict = parse({ ...base, status: '2' }, { ...config, BLOCKONOMICS_CONFIRMATIONS: 3 });
  assert.strictEqual(strict.canonicalEventType, 'unhandled');
  assert.strictEqual(strict.confirmationsRequired, 3);
  assert.strictEqual(gateway.confirmationsRequired({}), gateway.DEFAULT_CONFIRMATIONS);

  // Malformed field shapes are refused before anything is used.
  assert.throws(() => parse({ ...base, status: '2x' }), /status is missing or malformed/);
  assert.throws(() => parse({ ...base, status: '2', value: '-100' }), /value is missing or malformed/);
  assert.throws(() => parse({ ...base, status: '2', txid: 'not a txid!' }), /txid is missing or malformed/);
  assert.throws(() => parse({ ...base, status: '2', addr: 'x'.repeat(129) }), /addr is missing or malformed/);
  assert.throws(() => parse({ status: '2', value: '1', addr: ADDRESS }), /txid is missing or malformed/);
  // A confirmed callback that moved nothing is not a payment.
  assert.throws(() => parse({ ...base, status: '2', value: '0' }), /zero amount/);
  // Another crypto is refused by name rather than credited as BTC.
  assert.throws(() => parse({ ...base, status: '2', crypto: 'USDT' }), /settles BTC; the callback reports USDT/);

  // A POST delivery with the parameters in the body works too (the plugin read `$_GET`, which PHP
  // fills either way), and a body that is not JSON fails loudly.
  const fromBody = gateway.parseEvent(Buffer.from(JSON.stringify({ ...base, status: '2' })), {}, 'hash', { config });
  assert.strictEqual(fromBody.canonicalEventType, 'payment.success');
  assert.throws(
    () => gateway.parseEvent(Buffer.from('not json'), {}, 'hash', { config }),
    (err) => err instanceof SyntaxError,
  );
});

test('minor units are per currency, and the ledger precision is stated in one place', () => {
  assert.strictEqual(money.toMinorUnits(0.00042, 'BTC'), 42000);
  assert.strictEqual(money.toMinorUnits(12.34, 'USD'), 1234);
  assert.strictEqual(money.toMinorUnits(1000, 'JPY'), 1000);
  assert.strictEqual(money.toMinorUnits(12.34, 'ZZZ'), 1234, 'an unknown currency keeps the platform default');
  assert.strictEqual(money.roundToMinorUnits(0.00042, 'BTC'), 0.00042);
  assert.strictEqual(money.roundToMinorUnits(12.345, 'USD'), 12.35);
  assert.strictEqual(money.roundToMinorUnits(12.4, 'JPY'), 12);
  assert.throws(() => money.toMinorUnits('not a number', 'USD'), TypeError);

  // What the ledger can hold is asserted against the schema that defines it, not against a comment.
  const schema = require('../src/store/schema');
  assert.strictEqual(schema.TYPES.numeric, `NUMERIC(16,${money.LEDGER_SCALE})`);
  assert.strictEqual(money.exceedsLedgerPrecision('BTC'), true);
  assert.strictEqual(money.exceedsLedgerPrecision('btc'), true);
  assert.strictEqual(money.exceedsLedgerPrecision('USD'), false);
  assert.strictEqual(money.exceedsLedgerPrecision('JPY'), false);
});

// ============================================================================ integration

test('a Blockonomics callback is verified, gated, deduplicated and audited — and never credited blindly', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET, BLOCKONOMICS_CALLBACK_SECRET: CALLBACK_SECRET });
  t.after(() => close());

  const user = await customer(base, app, 'btc-payer@example.com');
  const { invoice, payment } = await seedInvoiceWithCryptoPayment(app, { userId: user.id });
  const params = { addr: ADDRESS, txid: TXID, value: '42000' };

  // ---- unconfirmed: recorded, ignored, and nothing moves --------------------
  const unconfirmed = await delivery(base, { ...params, status: '1' });
  const unconfirmedBody = await bodyOf(unconfirmed);
  assert.strictEqual(unconfirmed.status, 200, JSON.stringify(unconfirmedBody));
  assert.deepStrictEqual(unconfirmedBody, { received: true, status: 'ignored', applied: false });
  assert.strictEqual((await app.store.table('invoices').findById(invoice.id)).status, 'unpaid');
  assert.strictEqual((await app.store.table('payments').findById(payment.id)).status, 'pending');
  assert.strictEqual(
    (await app.store.table('webhook_events').findOne({ provider: 'blockonomics', event_id: `${ADDRESS}:${TXID}:1` })).status,
    'ignored',
  );

  // ---- once confirmed: verified and recorded, but refused by name -----------
  const confirmed = await delivery(base, { ...params, status: '2' });
  const confirmedBody = await bodyOf(confirmed);
  assert.strictEqual(confirmed.status, 400, JSON.stringify(confirmedBody));
  assert.match(confirmedBody.message, /money columns hold 2 decimal places/);
  assert.match(confirmedBody.message, /0\.00042 BTC \(42000 minor units\) would be stored as 0\.00/);
  assert.match(confirmedBody.message, /manual gateway/);

  const event = await app.store.table('webhook_events').findOne({ provider: 'blockonomics', event_id: `${ADDRESS}:${TXID}:2` });
  assert.strictEqual(event.status, 'rejected', 'the refusal is recorded as evidence, not swallowed');
  assert.strictEqual(event.signature_valid, true);
  assert.strictEqual(event.event_type, 'payment.success');
  assert.strictEqual(event.payload.currency, 'BTC');
  assert.strictEqual(event.payload.amount_cents, 42000);
  assert.ok(event.payload.payload_hash, 'the raw material received is hashed for audit');
  assert.strictEqual(event.payload.provider_payload.secret, CALLBACK_SECRET, 'the platform never rewrites what the provider sent');

  // Nothing was credited, and no ledger row exists in a currency the ledger cannot hold.
  const settledInvoice = await app.store.table('invoices').findById(invoice.id);
  assert.strictEqual(settledInvoice.status, 'unpaid');
  assert.strictEqual(Number(settledInvoice.amount_paid), 0);
  assert.strictEqual((await app.store.table('payments').findById(payment.id)).status, 'pending');
  assert.strictEqual((await app.store.table('billing_ledger').find({ invoice_id: invoice.id })).rows.length, 0);

  // ---- a re-delivery of the same confirmation level is deduplicated ---------
  const replay = await delivery(base, { ...params, status: '2' });
  assert.deepStrictEqual(await bodyOf(replay), { received: true, status: 'rejected', applied: false });
  assert.strictEqual((await app.store.table('billing_ledger').find({ invoice_id: invoice.id })).rows.length, 0);
});

test('an unverified, unknown or malformed callback changes nothing at all', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET, BLOCKONOMICS_CALLBACK_SECRET: CALLBACK_SECRET });
  t.after(() => close());

  const user = await customer(base, app, 'btc-unverified@example.com');
  const { invoice, payment } = await seedInvoiceWithCryptoPayment(app, { userId: user.id });
  const params = { addr: ADDRESS, txid: TXID, value: '42000', status: '2' };

  // Wrong secret → 401, and not one row is written: verification happens before any database access.
  const before = await app.store.table('webhook_events').count({});
  const wrongSecret = await delivery(base, params, 'a-different-secret-of-the-same-length!!');
  assert.strictEqual(wrongSecret.status, 401);
  assert.strictEqual(await app.store.table('webhook_events').count({}), before, 'an unverified caller writes nothing');
  assert.strictEqual((await app.store.table('invoices').findById(invoice.id)).status, 'unpaid');

  // No secret at all → 401 for the same reason.
  assert.strictEqual((await delivery(base, params, null)).status, 401);

  // Verified but an address the platform never issued → 404, recorded as rejected, no money moved.
  const unknownAddress = 'bc1qunknownaddress1111111111111111111111';
  const unknown = await delivery(base, { ...params, addr: unknownAddress });
  assert.strictEqual(unknown.status, 404);
  const rejected = await app.store.table('webhook_events').findOne({
    provider: 'blockonomics', event_id: `${unknownAddress}:${TXID}:2`,
  });
  assert.strictEqual(rejected.status, 'rejected');
  assert.match(rejected.error, /No payment record matches/);
  assert.strictEqual((await app.store.table('invoices').findById(invoice.id)).status, 'unpaid');
  assert.strictEqual((await app.store.table('payments').findById(payment.id)).status, 'pending');

  // A malformed callback is a 400 from the shape gate: nothing recorded, nothing moved.
  const malformed = await delivery(base, { addr: ADDRESS, txid: TXID, value: 'lots', status: '2' });
  assert.strictEqual(malformed.status, 400);
  assert.match((await bodyOf(malformed)).message, /Malformed webhook payload/);
  assert.strictEqual((await app.store.table('invoices').findById(invoice.id)).status, 'unpaid');
  assert.strictEqual(
    (await app.store.table('webhook_events').find({ provider: 'blockonomics', event_id: `:${TXID}:2` })).rows.length, 0,
    'a body that failed the shape gate is never given an event row',
  );
});

test('the callback endpoint is not a general webhook door', async (t) => {
  const { base, app, close } = await startServer({
    JWT_SECRET,
    BLOCKONOMICS_CALLBACK_SECRET: CALLBACK_SECRET,
    STRIPE_WEBHOOK_SECRET: 'stripe-secret-for-this-suite-0000',
  });
  t.after(() => close());

  // A GET for a signature-based gateway is refused for the missing signed body, and writes nothing.
  const before = await app.store.table('webhook_events').count({});
  const stripeGet = await fetch(`${base}/api/v1/webhooks/stripe?secret=${CALLBACK_SECRET}&status=2`);
  assert.strictEqual(stripeGet.status, 400);
  assert.strictEqual(await app.store.table('webhook_events').count({}), before);

  // An unconfigured Blockonomics deployment refuses with the variable name, not a 500.
  const other = await startServer({ JWT_SECRET });
  t.after(() => other.close());
  const unconfigured = await fetch(`${other.base}/api/v1/webhooks/blockonomics?secret=${CALLBACK_SECRET}&status=2&addr=${ADDRESS}&txid=${TXID}&value=42000`);
  assert.strictEqual(unconfigured.status, 401);
  assert.match((await bodyOf(unconfigured)).message, /BLOCKONOMICS_CALLBACK_SECRET/);

  // And an unknown provider is still a 404 rather than a fallback to any secret scheme.
  const unknown = await fetch(`${base}/api/v1/webhooks/acme?secret=${CALLBACK_SECRET}`);
  assert.strictEqual(unknown.status, 404);
});

test('the admin reconciliation reports each currency separately and never folds crypto into USD', async (t) => {
  const { base, app, close } = await startServer({ JWT_SECRET });
  t.after(() => close());

  const user = await customer(base, app, 'btc-ledger@example.com');
  const paid = await app.store.table('invoices').insert({
    id: uuidv7(), user_id: user.id, number: 'INV-LEDGER-1', currency: 'USD',
    subtotal: 25, tax_total: 0, discount_total: 0, total: 25, amount_paid: 0,
    status: 'unpaid', issued_at: new Date().toISOString(),
  });
  // A staff-confirmed manual Bitcoin payment is how a BTC ledger row can exist at all in this build
  // — and it is stored at the ledger's two-decimal precision, which is exactly the constraint the
  // gateway refusal names.
  await app.store.table('billing_ledger').insert({
    id: uuidv7(), user_id: user.id, invoice_id: paid.id, entry_type: 'charge',
    amount: 0.00042, currency: 'BTC', description: 'Bitcoin charge',
  });
  assert.strictEqual(
    Number((await app.store.table('billing_ledger').find({ currency: 'BTC' })).rows[0].amount), 0,
    'a BTC amount cannot be represented in a NUMERIC(16,2) money column',
  );
  await app.store.table('billing_ledger').insert({
    id: uuidv7(), user_id: user.id, invoice_id: paid.id, entry_type: 'charge',
    amount: 25, currency: 'USD', description: 'Monthly plan',
  });

  await register(base, 'btc-admin@example.com', 'SuperSecret123!');
  const adminUser = await app.store.table('users').findOne({ email: 'btc-admin@example.com' });
  await app.store.table('users').updateById(adminUser.id, { role: 'admin' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email: 'btc-admin@example.com', password: 'SuperSecret123!' } });
  const res = await jsonFetch(base, { path: '/api/v1/admin/billing/reconciliation' }, login.data.accessToken);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.currency, 'USD');
  assert.strictEqual(res.data.charges, 25, 'the BTC row is not added into the dollar figures');
  assert.strictEqual(res.data.entries, 1);
  assert.strictEqual(res.data.otherCurrencies.BTC.charges, 0, 'and it is still kept out of the dollar figures');
  assert.strictEqual(res.data.otherCurrencies.BTC.entries, 1);
  assert.match(res.data.note, /never added into these figures/);
});
