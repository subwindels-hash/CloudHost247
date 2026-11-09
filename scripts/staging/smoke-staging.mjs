#!/usr/bin/env node
/**
 * CloudHost247 — controlled staging certification smoke runner.
 *
 * Drives the REAL application over HTTP: registration, login, MFA ceremony, account dashboard,
 * cart → order → invoice → sandbox-gateway payment → signed webhook settlement (plus replay,
 * tamper, wrong-amount, stale-timestamp and failed-outcome adversaries), tenant isolation,
 * admin-boundary enforcement and rate limiting.
 *
 * Nothing is mocked: the target app decides every response. The only simulated party is the
 * sandbox payment *provider*, exactly as designed (src/payments/sandbox-gateway.ts) — signing
 * uses SANDBOX_GATEWAY_WEBHOOK_SECRET from the environment, never embedded here.
 *
 * Usage:
 *   SANDBOX_GATEWAY_WEBHOOK_SECRET=... BASE_URL=http://localhost:3000 \
 *   EVIDENCE_OUT=docs/staging/staging-evidence-YYYY-MM-DD.json \
 *   node scripts/staging/smoke-staging.mjs
 */
import { createHmac, randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.SANDBOX_GATEWAY_WEBHOOK_SECRET ?? '';
const EVIDENCE_OUT = process.env.EVIDENCE_OUT ?? null;
const results = [];
const ctx = {};

/** RFC 6238 TOTP (SHA-1/6/30s) — mirrors src/services/totp-mfa-service.ts. */
function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.toUpperCase().replace(/=+$/, '');
  let buffer = 0, bits = 0; const out = [];
  for (const c of normalized) {
    const i = alphabet.indexOf(c);
    if (i < 0) throw new Error('bad base32');
    buffer = (buffer << 5) | i; bits += 5;
    if (bits >= 8) { out.push((buffer >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

async function step(name, fn, meta = {}) {
  const startedAt = new Date().toISOString();
  try {
    const r = await fn();
    const pass = r.expect.includes(r.status) && (r.check ? r.check(r.body) : true);
    results.push({ name, status: r.status, expect: r.expect, pass, note: r.note ?? null, startedAt, ...meta });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  [${r.status}]${r.note ? ` — ${r.note}` : ''}`);
    return r;
  } catch (err) {
    results.push({ name, status: 'SCRIPT-ERROR', expect: meta.expect ?? [], pass: false, note: String(err?.message ?? err), startedAt });
    console.log(`FAIL  ${name}  [script error: ${err?.message}]`);
    return null;
  }
}

async function http(method, url, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  let parsed = null;
  const text = await res.text();
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: parsed };
}

function sign(rawBody, timestamp = Date.now()) {
  return {
    'x-sandbox-signature': createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex'),
    'x-cloudhost-timestamp': String(timestamp),
    'content-type': 'application/json',
  };
}

const email = `staging-${Date.now()}@example.com`;
const password = 'Staging-Cert-987654321';

// ---------- 1. Auth & account lifecycle ----------
await step('register customer account', async () => {
  const r = await http('POST', '/api/auth/register', { body: { email, password, fullName: 'Staging Certification', username: `staging-${Date.now()}` } });
  ctx.userId = r.body?.user?.id ?? r.body?.userId ?? null;
  return { status: r.status, expect: [200, 201], body: r.body, note: r.body?.emailVerification ?? 'registered' };
});
await step('duplicate registration refused', async () => {
  const r = await http('POST', '/api/auth/register', { body: { email, password, fullName: 'Dup' } });
  return { status: r.status, expect: [400, 409], body: r.body };
});
await step('login with wrong password → 401', async () => {
  const r = await http('POST', '/api/auth/login', { body: { email, password: 'wrong-wrong-wrong' } });
  return { status: r.status, expect: [401], body: r.body };
});
await step('login with correct password → session token', async () => {
  const r = await http('POST', '/api/auth/login', { body: { email, password } });
  ctx.token = r.body?.token;
  return { status: r.status, expect: [200], body: r.body, check: (b) => typeof b?.token === 'string' };
});
await step('password-reset request: uniform 202 (anti-enumeration)', async () => {
  const a = await http('POST', '/api/auth/password-reset/request', { body: { email } });
  const b = await http('POST', '/api/auth/password-reset/request', { body: { email: `nobody-${randomUUID()}@example.com` } });
  return {
    status: a.status, expect: [202], body: a.body,
    check: () => a.status === 202 && b.status === 202 && JSON.stringify(a.body) === JSON.stringify(b.body),
    note: 'known and unknown email receive byte-identical answers',
  };
});

// ---------- 2. MFA / TOTP (real ceremony) ----------
await step('TOTP enroll issues a secret (password-confirmed)', async () => {
  const r = await http('POST', '/api/auth/mfa/totp/enroll', { token: ctx.token, body: { password } });
  ctx.totpSecret = r.body?.secret ?? null;
  return { status: r.status, expect: [200, 201], body: r.body, check: () => !!ctx.totpSecret, note: r.body?.otpauthUrl ? 'otpauth URL issued' : JSON.stringify(r.body).slice(0, 120) };
});
await step('TOTP confirm with a real code enables MFA', async () => {
  const r = await http('POST', '/api/auth/mfa/totp/confirm', { token: ctx.token, body: { code: totp(ctx.totpSecret) } });
  ctx.recoveryCodes = r.body?.recoveryCodes ?? null;
  return { status: r.status, expect: [200], body: r.body };
});
await step('MFA status reports enabled', async () => {
  const r = await http('GET', '/api/auth/mfa/status', { token: ctx.token });
  return { status: r.status, expect: [200], body: r.body, check: (b) => b?.mfa?.enabled === true, note: JSON.stringify(r.body?.mfa ?? {}).slice(0, 120) };
});
await step('login after MFA: second factor required (202 challenge, no session)', async () => {
  const r = await http('POST', '/api/auth/login', { body: { email, password } });
  ctx.mfaToken = r.body?.mfaToken ?? null;
  return { status: r.status, expect: [202], body: r.body, check: (b) => b?.mfaRequired === true && typeof b?.mfaToken === 'string' && !b?.token };
});
await step('MFA login verify with a fresh-window TOTP code completes', async () => {
  // The server records last_used_timestep to make TOTP codes single-use: the enrollment-confirm
  // consumed the current 30s window, so verification legitimately uses the next one (accepted
  // by the ±1-window skew handling), never a replay of the same code.
  const code = totp(ctx.totpSecret, Date.now() + 30_000);
  const r = await http('POST', '/api/auth/mfa/login/verify', { body: { mfaToken: ctx.mfaToken, code } });
  if (r.body?.token) ctx.token = r.body.token;
  return { status: r.status, expect: [200], body: r.body, check: () => !!r.body?.token, note: r.body?.token ? 'full session issued' : JSON.stringify(r.body)?.slice(0, 120) };
});
await step('passkeys: registration options ceremony starts (password-confirmed; attestation needs a browser authenticator)', async () => {
  const r = await http('POST', '/api/auth/passkeys/register/options', { token: ctx.token, body: { password } });
  return { status: r.status, expect: [200], body: r.body, check: (b) => !!(b?.challenge ?? b?.publicKey?.challenge ?? b?.challengeId), note: JSON.stringify(r.body).slice(0, 100) };
});

// ---------- 3. Account dashboard ----------
await step('customer dashboard: PATCH /api/v1/account/profile updates the customer record', async () => {
  const r = await http('PATCH', '/api/v1/account/profile', { token: ctx.token, body: { fullName: 'Staging Certification Run' } });
  return { status: r.status, expect: [200], body: r.body };
});
for (const sub of ['services', 'domains', 'tickets']) {
  await step(`customer dashboard: GET /api/v1/account/${sub}`, async () => {
    const r = await http('GET', `/api/v1/account/${sub}`, { token: ctx.token });
    return { status: r.status, expect: [200], body: r.body };
  });
}

// ---------- 4. Support workflow ----------
await step('open a support ticket, then post a message', async () => {
  const r = await http('POST', '/api/v1/account/tickets', { token: ctx.token, body: { subject: 'Staging certification ticket', message: 'Opened by the automated staging run; safe to close.', priority: 'low', department: 'support' } });
  ctx.ticketId = r.body?.ticket?.id ?? r.body?.id;
  if (!ctx.ticketId) return { status: r.status, expect: [], body: r.body, note: 'no ticket id in response (checked payload shape)' };
  const m = await http('POST', `/api/v1/account/tickets/${ctx.ticketId}/messages`, { token: ctx.token, body: { message: 'First reply from the customer.' } });
  return { status: m.status, expect: [200, 201], body: m.body, note: `ticket created ${r.status}, message ${m.status}` };
});

// ---------- 5. Catalog → cart → order → invoice ----------
await step('public catalog browsing (anonymous allowed)', async () => {
  const r = await http('GET', '/api/v1/catalog/products');
  const products = r.body?.products ?? r.body ?? [];
  ctx.productCount = Array.isArray(products) ? products.length : -1;
  return { status: r.status, expect: [200], body: r.body, note: `products visible: ${ctx.productCount}` };
});
await step('plans for the seeded dev product resolve with server-side prices', async () => {
  const r = await http('GET', '/api/v1/catalog/products/dev-example-hosting/plans');
  ctx.plan = (r.body?.plans ?? [])[0] ?? null;
  return { status: r.status, expect: [200], body: r.body, check: () => !!ctx.plan, note: ctx.plan ? `plan=${ctx.plan.slug ?? ctx.plan.id} price=${ctx.plan.price ?? ctx.plan.amount ?? '(see pricing)'}` : 'no plans' };
});
await step('add catalog item to cart (authenticated, server-priced)', async () => {
  const r = await http('POST', '/api/v1/cart/catalog-items', { token: ctx.token, body: { productSlug: 'dev-example-hosting', planSlug: 'dev-example-plan', billingPeriod: 'monthly', quantity: 1 } });
  return { status: r.status, expect: [200, 201], body: r.body, check: (b) => !!b?.cart };
});
await step('checkout: cart becomes an order with an unpaid invoice', async () => {
  const r = await http('POST', '/api/v1/orders', { token: ctx.token, body: {} });
  ctx.orderId = r.body?.order?.id ?? r.body?.orderId ?? null;
  ctx.invoiceId = r.body?.invoice?.id ?? r.body?.invoiceId ?? r.body?.order?.invoiceId ?? null;
  ctx.invoiceTotal = r.body?.invoice?.total ?? null;
  return { status: r.status, expect: [200, 201], body: r.body, check: () => !!ctx.orderId && !!ctx.invoiceId, note: `order=${ctx.orderId?.slice(0, 8)}… invoice=${ctx.invoiceId?.slice(0, 8)}…` };
});
await step('invoice list shows the unpaid invoice', async () => {
  const r = await http('GET', '/api/v1/invoices', { token: ctx.token });
  const list = r.body?.invoices ?? [];
  const mine = list.find((i) => i.id === ctx.invoiceId);
  return { status: r.status, expect: [200], body: r.body, check: () => !!mine && (mine.status === 'unpaid' || mine.status === 'issued'), note: mine ? `invoice status=${mine.status} total=${mine.total ?? mine.total_cents}` : 'invoice missing' };
});

// ---------- 6. Sandbox payment + settlement + adversaries ----------
await step('initiate sandbox-gateway payment (pending, honest instructions)', async () => {
  const r = await http('POST', `/api/v1/invoices/${ctx.invoiceId}/payments`, { token: ctx.token, body: { gateway: 'sandbox' } });
  ctx.payment = r.body?.payment ?? null;
  return { status: r.status, expect: [200, 201], body: r.body, check: () => !!ctx.payment?.providerReference?.startsWith('sandbox_'), note: ctx.payment ? `ref=${ctx.payment.providerReference} status=${ctx.payment.status}` : 'no payment row' };
});

function sandboxWebhook(payment, outcome, amountOverride = null) {
  const payload = {
    provider: 'sandbox',
    providerReference: payment.provider_reference ?? payment.providerReference,
    paymentId: payment.id,
    outcome,
    amount: amountOverride ?? payment.amount,
    currency: payment.currency,
    occurredAt: new Date().toISOString(),
  };
  return JSON.stringify(payload);
}

await step('webhook: SIGNED successful outcome settles the payment and pays the invoice', async () => {
  if (!WEBHOOK_SECRET) return { status: 'SKIPPED', expect: [], body: null, note: 'SANDBOX_GATEWAY_WEBHOOK_SECRET not set' };
  const raw = sandboxWebhook(ctx.payment, 'successful');
  const r = await http('POST', '/api/v1/webhooks/payment/sandbox', { body: raw, headers: sign(raw) });
  const inv = await http('GET', `/api/v1/invoices/${ctx.invoiceId}`, { token: ctx.token });
  ctx.invoicePaid = inv.body?.invoice?.status === 'paid';
  return { status: r.status, expect: [200, 202], body: r.body, check: () => ctx.invoicePaid, note: `webhook=${r.status} invoice=${inv.body?.invoice?.status}` };
});
await step('webhook REPLAY: exact same payload is de-duplicated — no double settlement', async () => {
  const raw = sandboxWebhook(ctx.payment, 'successful');
  const before = await http('GET', '/api/v1/billing/ledger', { token: ctx.token });
  const first = await http('POST', '/api/v1/webhooks/payment/sandbox', { body: raw, headers: sign(raw) });
  const second = await http('POST', '/api/v1/webhooks/payment/sandbox', { body: raw, headers: sign(raw) });
  const after = await http('GET', '/api/v1/billing/ledger', { token: ctx.token });
  const n1 = (before.body?.ledger ?? []).length, n2 = (after.body?.ledger ?? []).length;
  return { status: second.status, expect: [200, 202, 400, 409], body: second.body, check: () => n1 === n2, note: `replay statuses=${first.status}/${second.status}; ledger entries before=${n1} after=${n2}` };
});
await step('webhook with a TAMPERED signature is refused', async () => {
  const raw = sandboxWebhook(ctx.payment, 'successful');
  const r = await http('POST', '/api/v1/webhooks/payment/sandbox', { body: raw, headers: { ...sign(raw), 'x-sandbox-signature': 'deadbeef'.repeat(8) } });
  return { status: r.status, expect: [400, 401, 403], body: r.body };
});
await step('webhook with a STALE timestamp (>5 min) is refused', async () => {
  const raw = sandboxWebhook(ctx.payment, 'successful');
  const r = await http('POST', '/api/v1/webhooks/payment/sandbox', { body: raw, headers: sign(raw, Date.now() - 10 * 60 * 1000) });
  return { status: r.status, expect: [400, 401, 403], body: r.body };
});
await step('webhook with a WRONG AMOUNT is refused (ambiguous outcome must not settle)', async () => {
  const cartR = await http('POST', '/api/v1/cart/catalog-items', { token: ctx.token, body: { productSlug: 'dev-example-hosting', planSlug: 'dev-example-plan', billingPeriod: 'monthly', quantity: 1 } });
  const order = await http('POST', '/api/v1/orders', { token: ctx.token, body: {} });
  const inv2 = order.body?.invoice?.id ?? order.body?.order?.invoiceId ?? order.body?.order?.invoice?.id ?? null;
  if (!inv2) return { status: order.status, expect: [201], body: order.body, note: `second checkout response: ${JSON.stringify(order.body).slice(0, 160)}` };
  const pay2 = await http('POST', `/api/v1/invoices/${inv2}/payments`, { token: ctx.token, body: { gateway: 'sandbox' } });
  ctx.payment2 = pay2.body?.payment;
  ctx.invoice2Id = inv2;
  if (!ctx.payment2) return { status: pay2.status, expect: [200, 201], body: pay2.body, note: `pay2 response: ${JSON.stringify(pay2.body).slice(0, 160)}` };
  const raw = sandboxWebhook(ctx.payment2, 'successful', (ctx.payment2?.amount ?? 0) + 5000);
  const r = await http('POST', '/api/v1/webhooks/payment/sandbox', { body: raw, headers: sign(raw) });
  const inv = await http('GET', `/api/v1/invoices/${inv2}`, { token: ctx.token });
  return { status: r.status, expect: [200, 202, 400, 409, 422], body: r.body, check: () => inv.body?.invoice?.status !== 'paid', note: `invoice after wrong-amount webhook: ${inv.body?.invoice?.status}` };
});
await step('webhook: FAILED outcome leaves the payment failed and the invoice unpaid', async () => {
  const raw = sandboxWebhook(ctx.payment2, 'failed');
  const r = await http('POST', '/api/v1/webhooks/payment/sandbox', { body: raw, headers: sign(raw) });
  const inv = await http('GET', `/api/v1/invoices/${ctx.invoice2Id}`, { token: ctx.token });
  return { status: r.status, expect: [200, 202], body: r.body, check: () => inv.body?.invoice?.status !== 'paid', note: `invoice=${inv.body?.invoice?.status}` };
});
await step('billing ledger: append-only rows = 2 charges + exactly 1 payment, 0 for the failed invoice', async () => {
  // Customer view rows are { id, entryType: charge|payment|refund|credit, amount, currency,
  // description: 'Invoice INV-###### …' } — invoice linkage stays server-side.
  const r = await http('GET', '/api/v1/billing/ledger', { token: ctx.token });
  const entries = r.body?.ledger ?? [];
  const charges = entries.filter((e) => e.entryType === 'charge');
  const payments = entries.filter((e) => e.entryType === 'payment');
  return {
    status: r.status, expect: [200], body: r.body,
    check: () => charges.length === 2 && payments.length === 1,
    note: `rows=${entries.length} charges=${charges.length} payments=${payments.length} (one settlement after replays; none for the failed invoice)`,
  };
});

// ---------- 7. Tenant isolation & role boundaries ----------
await step('tenant isolation: second customer cannot read the first customer\'s invoice', async () => {
  const other = `staging-b-${Date.now()}@example.com`;
  await http('POST', '/api/auth/register', { body: { email: other, password, fullName: 'Tenant B' } });
  const login = await http('POST', '/api/auth/login', { body: { email: other, password } });
  const r = await http('GET', `/api/v1/invoices/${ctx.invoiceId}`, { token: login.body?.token });
  return { status: r.status, expect: [403, 404], body: r.body, note: 'cross-tenant read refused' };
});
await step('admin boundary: customer token → admin route is 403; anonymous → 401', async () => {
  const asCustomer = await http('GET', '/api/v1/admin/users', { token: ctx.token });
  const anonymous = await http('GET', '/api/v1/admin/users');
  return { status: asCustomer.status, expect: [403], body: null, check: () => anonymous.status === 401, note: `customer=${asCustomer.status} anonymous=${anonymous.status}` };
});

// ---------- 8. Rate limiting & public surfaces ----------
await step('rate limiting on login (10/min): 11th attempt is 429', async () => {
  let last = 0;
  for (let i = 0; i < 11; i += 1) {
    const r = await http('POST', '/api/auth/login', { body: { email: `rl-${i}@example.com`, password: 'x'.repeat(12) } });
    last = r.status;
  }
  return { status: last, expect: [429], body: null, note: `final attempt status=${last}` };
});
await step('public surfaces: /health, /ready, tools catalog, domain extensions', async () => {
  const h = await http('GET', '/health');
  const ready = await http('GET', '/ready');
  const tools = await http('GET', '/api/tools/catalog');
  const domains = await http('GET', '/api/v1/domain-services/extensions');
  return {
    status: h.status, expect: [200], body: null,
    check: () => ready.status === 200 && tools.status === 200 && (tools.body?.tools?.length ?? 0) > 0 && domains.status === 200,
    note: `tools=${tools.body?.count ?? tools.body?.tools?.length}, extensions=${domains.body?.extensions?.length ?? domains.body?.count ?? 'n/a'}`,
  };
});

// ---------- summary ----------
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`\n== staging smoke: ${passed} passed, ${failed} failed of ${results.length} ==`);
if (EVIDENCE_OUT) {
  mkdirSync(path.dirname(EVIDENCE_OUT), { recursive: true });
  writeFileSync(EVIDENCE_OUT, JSON.stringify({
    runAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    environment: 'embedded Postgres (PGlite) @ 92 migrations; sandbox payment gateway; deployment simulation mode; no external providers contacted',
    results,
  }, null, 2));
  console.log(`evidence written to ${EVIDENCE_OUT}`);
}
process.exit(failed > 0 ? 1 : 0);
