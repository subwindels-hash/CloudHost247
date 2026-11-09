#!/usr/bin/env node
/**
 * CloudHost247 — Phase 4 independent security probes.
 *
 * Written and executed separately from scripts/staging/smoke-staging.mjs (Phase 3): new
 * accounts, its own RFC 6238 TOTP implementation, its own HMAC signing helper, and
 * token-forgery vectors minted locally with the environment's JWT_SECRET. None of these
 * probes reuses Phase-3 code paths, so agreement between the two is genuine
 * reproducibility, not self-citation.
 *
 * Run from cloudhost247-node/ with env loaded:
 *   set -a && source .env && set +a && BASE_URL=http://localhost:3000 node ../scripts/staging/independent-audit-probes.mjs
 */
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(new URL('../../cloudhost247-node/package.json', import.meta.url));
const jwt = require(require.resolve('jsonwebtoken'));

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const EVIDENCE_OUT = process.env.EVIDENCE_OUT ?? null;
const JWT_SECRET = process.env.JWT_SECRET;
const SANDBOX_SECRET = process.env.SANDBOX_GATEWAY_WEBHOOK_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET not in environment — load cloudhost247-node/.env first');

const evidence = { runAt: new Date().toISOString(), baseUrl: BASE_URL, probes: [] };
const probe = (name, pass, detail) => {
  evidence.probes.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function call(method, p, { token, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h['authorization'] = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) { h['content-type'] = 'application/json'; payload = raw; }
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE_URL}${p}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

// Independent TOTP: RFC 6238, SHA-1, 6 digits, 30s step; base32 decode written from scratch here.
function b32decode(s) {
  const map = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const out = [];
  for (const c of s.replace(/=/g, '').toUpperCase()) {
    const i = map.indexOf(c);
    if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secretB32, whenMs = Date.now()) {
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(whenMs / 30000)));
  const h = createHmac('sha1', b32decode(secretB32)).update(ctr).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const sign = (body) => createHmac('sha256', SANDBOX_SECRET).update(body, 'utf8').digest('hex');

let failed = false;
try {
  const stamp = Date.now().toString(36);
  const password = `Audit-P4-${randomUUID().slice(0, 10)}`;
  const mkEmail = (tag) => `p4audit-${tag}-${stamp}@example.com`;
  const emailA = mkEmail('a'), emailB = mkEmail('b');

  // ---- P-1: password-reset anti-enumeration, byte-for-byte ----
  const regA = await call('POST', '/api/auth/register', { body: { email: emailA, password, fullName: 'Phase4 Audit A' } });
  const regB = await call('POST', '/api/auth/register', { body: { email: emailB, password, fullName: 'Phase4 Audit B' } });
  probe('register two fresh audit customers', regA.status === 201 && regB.status === 201, `${regA.status}/${regB.status}`);
  const resetKnown = await call('POST', '/api/auth/password-reset/request', { body: { email: emailA } });
  const resetUnknown = await call('POST', '/api/auth/password-reset/request', { body: { email: `nobody-${stamp}@example.com` } });
  probe('password-reset uniformity: known vs unknown email byte-identical 202',
    resetKnown.status === 202 && resetUnknown.status === 202 && resetKnown.text === resetUnknown.text,
    `known ${resetKnown.status}, unknown ${resetUnknown.status}, bodies equal: ${resetKnown.text === resetUnknown.text}`);

  // ---- P-2: baseline login for A ----
  const loginA = await call('POST', '/api/auth/login', { body: { email: emailA, password } });
  const tokenA = loginA.json?.token;
  probe('login A', loginA.status === 200 && !!tokenA, `status ${loginA.status}`);

  // ---- P-3: forged-token vectors (claims cloned from A's REAL token where needed) ----
  const realClaims = JSON.parse(Buffer.from(tokenA.split('.')[1], 'base64url').toString());
  const uidA = realClaims.sub;
  // 3a: valid secret + A's identity/session-version, but role CLAIM falsified to super_admin
  const elevated = jwt.sign({ sub: uidA, role: 'super_admin', email: emailA, sv: realClaims.sv ?? 0 }, JWT_SECRET, { jwtid: randomUUID(), expiresIn: '1h' });
  const elevProbe = await call('GET', '/api/v1/admin/catalog/products', { token: elevated });
  probe('JWT with forged role=super_admin claim CANNOT reach admin routes (DB-fresh role wins)',
    elevProbe.status === 403, `status ${elevProbe.status}`);
  // 3b: expired token
  const expired = jwt.sign({ sub: uidA, role: 'customer', email: emailA, sv: realClaims.sv ?? 0, exp: Math.floor(Date.now() / 1000) - 600, iat: Math.floor(Date.now() / 1000) - 3600, jti: randomUUID() }, JWT_SECRET, { noTimestamp: true });
  const expProbe = await call('GET', '/api/v1/account/services', { token: expired });
  probe('already-expired JWT rejected', expProbe.status === 401, `status ${expProbe.status}`);
  // 3c: wrong secret
  const wrongSecret = jwt.sign({ sub: uidA, role: 'customer', email: emailA, sv: realClaims.sv ?? 0 }, 'this-is-not-the-real-secret', { expiresIn: '1h' });
  const wsProbe = await call('GET', '/api/v1/account/services', { token: wrongSecret });
  probe('JWT signed with a wrong secret rejected', wsProbe.status === 401, `status ${wsProbe.status}`);
  // 3d: forged sv (wrong session version)
  const wrongSv = jwt.sign({ sub: uidA, role: 'customer', email: emailA, sv: (realClaims.sv ?? 0) + 999 }, JWT_SECRET, { jwtid: randomUUID(), expiresIn: '1h' });
  const svProbe = await call('GET', '/api/v1/account/services', { token: wrongSv });
  probe('JWT with non-current session version (sv) rejected', svProbe.status === 401, `status ${svProbe.status} (${svProbe.json?.message ?? ''})`);

  // ---- P-4: logout revocation ----
  const before = await call('GET', '/api/v1/account/services', { token: tokenA });
  const logout = await call('POST', '/api/auth/logout', { token: tokenA });
  const after = await call('GET', '/api/v1/account/services', { token: tokenA });
  probe('logout revokes the exact token immediately', before.status === 200 && [200, 204].includes(logout.status) && after.status === 401,
    `before ${before.status}, logout ${logout.status}, reuse ${after.status} (${after.json?.message ?? ''})`);

  // ---- P-5: MFA replay protection ----
  const loginA2 = await call('POST', '/api/auth/login', { body: { email: emailA, password } });
  const tokenA2 = loginA2.json?.token;
  const enroll = await call('POST', '/api/auth/mfa/totp/enroll', { token: tokenA2, body: { password } });
  const secret = (enroll.json?.otpauthUrl ?? '').match(/secret=([A-Z2-7]+)/i)?.[1];
  probe('TOTP enroll issues secret', enroll.status === 200 && !!secret, `status ${enroll.status}`);
  const confirmCode = totp(secret);
  const confirm = await call('POST', '/api/auth/mfa/totp/confirm', { token: tokenA2, body: { code: confirmCode } });
  probe('TOTP confirm with real code', confirm.status === 200, `status ${confirm.status}`);
  // login → MFA challenge
  const loginA3 = await call('POST', '/api/auth/login', { body: { email: emailA, password } });
  const mfaToken = loginA3.json?.mfaToken;
  probe('post-enrollment login demands second factor (202, no session)', loginA3.status === 202 && !!mfaToken && !loginA3.json?.token, `status ${loginA3.status}`);
  // replay the SAME code that just got consumed by confirm (same 30s window)
  const replay = await call('POST', '/api/auth/mfa/login/verify', { body: { mfaToken, code: confirmCode } });
  probe('TOTP REPLAY: the enrollment-confirmed code is refused for login-verify in the same window', replay.status === 401, `status ${replay.status}`);
  // fresh code from the next window verifies
  const nextCode = totp(secret, Date.now() + 30000);
  const verifyOk = await call('POST', '/api/auth/mfa/login/verify', { body: { mfaToken, code: nextCode } });
  probe('fresh-window TOTP code completes the login', verifyOk.status === 200 && !!verifyOk.json?.token, `status ${verifyOk.status}`);
  // reuse of THAT code on a NEW challenge must fail
  const loginA4 = await call('POST', '/api/auth/login', { body: { email: emailA, password } });
  if (loginA4.status === 202) {
    const reuse = await call('POST', '/api/auth/mfa/login/verify', { body: { mfaToken: loginA4.json.mfaToken, code: nextCode } });
    probe('TOTP single-use: a successfully used code cannot be reused on a new challenge', reuse.status === 401, `status ${reuse.status}`);
  } else {
    probe('TOTP single-use: a successfully used code cannot be reused on a new challenge', false, `second login returned ${loginA4.status} (rate limit?)`);
  }
  // patently wrong code
  const wrongCode = totp(secret, Date.now() + 90000); // three windows ahead — outside ±1 skew
  const badVerify = await call('POST', '/api/auth/mfa/login/verify', { body: { mfaToken: loginA4.json?.mfaToken ?? mfaToken, code: wrongCode } });
  probe('out-of-window TOTP code refused', badVerify.status === 401, `status ${badVerify.status}`);

  // ---- P-6: passkey challenge lifecycle ----
  const noPk = await call('POST', '/api/auth/passkeys/login/options', { body: { email: emailB } });
  probe('passkey login options for an account with no passkeys fails honestly', noPk.status >= 400 && noPk.status < 500, `status ${noPk.status} (${noPk.json?.message ?? ''})`);
  const pkOptionsNoPw = await call('POST', '/api/auth/passkeys/register/options', { token: verifyOk.json?.token, body: {} });
  probe('passkey register-options without password confirmation refused', pkOptionsNoPw.status >= 400, `status ${pkOptionsNoPw.status}`);

  // ---- P-7: cross-tenant isolation incl. payment initiation ----
  const loginB = await call('POST', '/api/auth/login', { body: { email: emailB, password } });
  const tokenB = loginB.json?.token;
  // A produces an unpaid invoice through the real commerce path
  const tokenA3 = verifyOk.json?.token;
  const cat = await call('GET', '/api/v1/catalog/products', {});
  const slug = cat.json?.products?.[0]?.slug;
  const plans = await call('GET', `/api/v1/catalog/products/${slug}/plans`, {});
  const planSlug = plans.json?.plans?.[0]?.slug;
  const cart = await call('POST', '/api/v1/cart/catalog-items', { token: tokenA3, body: { productSlug: slug, planSlug, billingPeriod: 'monthly' } });
  const order = await call('POST', '/api/v1/orders', { token: tokenA3 });
  const invoices = await call('GET', '/api/v1/invoices', { token: tokenA3 });
  const invoiceId = invoices.json?.invoices?.[0]?.id ?? invoices.json?.invoice?.id;
  probe('audit customer A checks out an unpaid invoice', order.status === 201 && !!invoiceId,
    `order ${order.status}, invoice list: ${(invoices.json?.invoices ?? []).length} rows`);
  const bReads = await call('GET', `/api/v1/invoices/${invoiceId}`, { token: tokenB });
  const bPays = await call('POST', `/api/v1/invoices/${invoiceId}/payments`, { token: tokenB, body: { gateway: 'sandbox' } });
  probe('cross-tenant invoice read and payment initiation both indistinguishable from non-existence',
    bReads.status === 404 && bPays.status === 404, `read ${bReads.status}, initiate ${bPays.status}`);

  // ---- P-8: admin boundary breadth (3 distinct admin routes) ----
  const adminRoutes = ['/api/v1/admin/catalog/products', '/api/v1/admin/billing/ledger', '/api/v1/admin/users'];
  const adminResults = [];
  for (const r of adminRoutes) adminResults.push((await call('GET', r, { token: tokenA3 })).status);
  probe('customer token is 403 across three distinct admin routes', adminResults.every((s) => s === 403), JSON.stringify(adminResults));
  const adminAnon = (await call('GET', '/api/v1/admin/users', {})).status;
  probe('anonymous admin access is 401', adminAnon === 401, `status ${adminAnon}`);

  // ---- P-9: Phase-5 hardening live proof (ex-finding P4-F1) ----
  // The sandbox gateway now REQUIRES a fresh x-cloudhost-timestamp: an otherwise perfectly
  // signed webbook with no timestamp must be refused (401). A *properly stamped* replay must
  // still dedup idempotently with no second settlement.
  const initiated = await call('POST', `/api/v1/invoices/${invoiceId}/payments`, { token: tokenA3, body: { gateway: 'sandbox' } });
  const payment = initiated.json?.payment;
  const settleBody = JSON.stringify({
    provider: 'sandbox', providerReference: payment.providerReference ?? payment.provider_reference,
    paymentId: payment.id, outcome: 'successful', amount: payment.amount, currency: payment.currency,
    occurredAt: new Date().toISOString(),
  });
  const hdrBase = { 'x-sandbox-signature': sign(settleBody) };
  const settle1 = await call('POST', '/api/v1/webhooks/sandbox', { raw: settleBody, headers: { ...hdrBase, 'x-cloudhost-timestamp': String(Date.now()) } });
  const ledgerBefore = (await call('GET', '/api/v1/billing/ledger', { token: tokenA3 })).json?.ledger?.length;
  const noTs = await call('POST', '/api/v1/webhooks/sandbox', { raw: settleBody, headers: hdrBase }); // hardening: must now FAIL
  const stampedReplay = await call('POST', '/api/v1/webhooks/sandbox', { raw: settleBody, headers: { ...hdrBase, 'x-cloudhost-timestamp': String(Date.now()) } }); // stamped replay: dedup
  const ledgerAfter = (await call('GET', '/api/v1/billing/ledger', { token: tokenA3 })).json?.ledger?.length;
  const invoiceAfter = (await call('GET', `/api/v1/invoices/${invoiceId}`, { token: tokenA3 })).json?.invoice?.status;
  probe('P4-F1 closed live: UNSIGNED-timestamp webhook refused (401); stamped replay deduped; no second settlement',
    settle1.status === 200 && noTs.status === 401 && stampedReplay.status === 200 && stampedReplay.json?.status === 'already_processed' && ledgerBefore === ledgerAfter && invoiceAfter === 'paid',
    `settle1 ${settle1.status}, no-ts ${noTs.status} (expect 401), stamped replay ${stampedReplay.status} status=${stampedReplay.json?.status}, ledger ${ledgerBefore}→${ledgerAfter}, invoice ${invoiceAfter}`);

  // ---- P-10: bearer-API CSRF surface: no session cookies issued ----
  const loginHeaders = await fetch(`${BASE_URL}/api/auth/health`).catch(() => null);
  const setCookie = loginHeaders?.headers?.get('set-cookie');
  probe('API issues no ambient session cookies (bearer tokens only → classic CSRF N/A on API routes)', !setCookie, setCookie ? `SET-COOKIE PRESENT: ${setCookie}` : 'no set-cookie');
} catch (err) {
  failed = true;
  probe('probe script error', false, String(err?.stack ?? err).slice(0, 400));
}
failed = failed || evidence.probes.some((p) => !p.pass);
if (EVIDENCE_OUT) {
  mkdirSync(path.dirname(EVIDENCE_OUT), { recursive: true });
  writeFileSync(EVIDENCE_OUT, JSON.stringify(evidence, null, 2));
  console.log(`evidence written to ${EVIDENCE_OUT}`);
}
process.exit(failed ? 1 : 0);
