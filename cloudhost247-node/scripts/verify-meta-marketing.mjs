/**
 * Local Chromium verification for the consent-aware Meta integration.
 * Requires the built SPA preview (`npm run preview -- 3000`) and never contacts Meta:
 * connect.facebook.net / facebook.com requests are intercepted and recorded locally.
 * This proves browser gating/dispatch wiring, NOT live Meta receipt.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.resolve(ROOT, process.env.EVIDENCE_DIR ?? 'docs/evidence/meta-pixel');
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PIXEL = '123456789012345';
mkdirSync(OUT, { recursive: true });

async function launch() {
  const pkg = await import('@sparticuz/chromium');
  const binDir = path.join(HERE, '..', 'node_modules', '@sparticuz', 'chromium', 'bin');
  const libDir = path.join(tmpdir(), 'al2023', 'lib');
  if (!existsSync(libDir) && existsSync(path.join(binDir, 'al2023.tar.br'))) await pkg.inflate(path.join(binDir, 'al2023.tar.br'));
  return chromium.launch({ executablePath: await pkg.default.executablePath(binDir), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'], env: { ...process.env, LD_LIBRARY_PATH: `${libDir}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}` } });
}
const assert = (ok, message) => { if (!ok) throw new Error(message); };

const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@cloudhost247.test', password: 'admin-tools-247' }) });
assert(login.ok, `admin login failed: ${login.status}`);
const session = await login.json();
const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` };
const current = (await (await fetch(`${BASE}/api/v1/admin/marketing-integrations/meta-pixel`, { headers: adminHeaders })).json()).configuration;
const saved = await fetch(`${BASE}/api/v1/admin/marketing-integrations/meta-pixel`, { method: 'PUT', headers: { ...adminHeaders, 'x-config-revision': String(current.revision) }, body: JSON.stringify({ expectedRevision: current.revision, configuration: { displayName: 'Meta Pixel', pixelId: PIXEL, websiteDomain: 'localhost', enabled: true, testMode: true, testEventCode: 'TEST_BROWSER', consentPolicy: 'global_opt_in', consentBannerEnabled: true, capi: { enabled: false, apiVersion: 'v26.0' } } }) });
assert(saved.ok, `config save failed: ${saved.status} ${await saved.text()}`);

const browser = await launch();
const report = { capturedAt: new Date().toISOString(), baseUrl: BASE, pixelId: PIXEL, metaRequests: [], checks: [] };
const META_HOSTS = /https:\/\/(connect\.facebook\.net|www\.facebook\.com|graph\.facebook\.com)\/.*/;
const interceptMeta = async route => {
  report.metaRequests.push({ url: route.request().url(), method: route.request().method(), at: new Date().toISOString() });
  await route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* intercepted locally; no Meta receipt */' });
};
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.route(META_HOSTS, interceptMeta);
const page = await context.newPage();
const check = (name, ok, detail) => { report.checks.push({ name, ok, detail }); assert(ok, `${name}: ${detail ?? ''}`); };

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.ch247-cookie-banner:not([hidden])', { timeout: 10000 });
check('no Meta request before consent', report.metaRequests.length === 0, { count: report.metaRequests.length });
check('no Pixel SDK element before consent', await page.locator('#ch247-meta-pixel-sdk').count() === 0);
await page.screenshot({ path: path.join(OUT, 'consent-before-choice.png'), fullPage: false });
await page.getByRole('button', { name: 'Reject Optional Cookies' }).click();
await page.waitForTimeout(800);
check('reject optional keeps Meta off', report.metaRequests.length === 0 && await page.locator('#ch247-meta-pixel-sdk').count() === 0, { count: report.metaRequests.length });

await page.getByRole('button', { name: 'Cookie settings' }).click();
await page.getByLabel('Marketing cookies').check();
await page.getByLabel('Analytics cookies').check();
await page.getByRole('button', { name: 'Save Preferences' }).click();
await page.waitForSelector('#ch247-meta-pixel-sdk', { state: 'attached', timeout: 10000 });
await page.waitForTimeout(800);
const queue = await page.evaluate(() => (window.fbq && window.fbq.queue ? window.fbq.queue.map(call => Array.from(call)) : []));
check('accept all initializes the configured Pixel', queue.some(c => c[0] === 'init' && c[1] === PIXEL), queue);
check('accept all dispatches PageView via trackSingle', queue.some(c => c[0] === 'trackSingle' && c[1] === PIXEL && c[2] === 'PageView'), queue);
check('Meta SDK request was attempted only after consent', report.metaRequests.some(r => r.url.includes('connect.facebook.net/en_US/fbevents.js')), report.metaRequests);
await page.screenshot({ path: path.join(OUT, 'consent-accepted.png'), fullPage: false });

await page.goto(`${BASE}/service-plans/catalog/web-hosting`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);
const productQueue = await page.evaluate(() => (window.fbq && window.fbq.queue ? window.fbq.queue.map(call => Array.from(call)) : []));
check('product page dispatches ViewContent after consent', productQueue.some(c => c[0] === 'trackSingle' && c[2] === 'ViewContent'), productQueue.slice(-8));

await page.getByRole('button', { name: 'Cookie settings' }).click();
await page.getByRole('button', { name: 'Withdraw Consent' }).click();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(800);
const afterWithdraw = report.metaRequests.length;
check('withdrawal reloads without a new Meta SDK request', await page.locator('#ch247-meta-pixel-sdk').count() === 0 && report.metaRequests.length === afterWithdraw);
const cookies = await context.cookies();
check('withdrawal clears Meta browser cookies', !cookies.some(c => c.name === '_fbp' || c.name === '_fbc'), cookies.map(c => c.name));

await page.evaluate(({ token, user }) => { localStorage.setItem('ch247_token', token); localStorage.setItem('ch247_user', JSON.stringify(user)); }, { token: session.token, user: session.user });
await page.goto(`${BASE}/admin/marketing-integrations/meta-pixel`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('h1', { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, 'admin-meta-pixel.png'), fullPage: true });
check('admin console renders', (await page.content()).includes('Meta Pixel'));
check('admin console explains API-accepted is not Events Manager receipt', (await page.content()).includes('Events Manager'));

// --- Real-browser checkout -> verified Purchase journey (consented customer) -----------------
// Proves the checkout consent context is captured, a staff-confirmed manual payment produces a
// server Purchase, and the invoice page fires ONE browser Purchase from the backend-verified
// receipt with canonical content IDs. Meta hosts stay intercepted: this is local fbq dispatch,
// NOT a Meta receipt. A separate context keeps this journey's consent independent of the withdrawal above.
const customerLogin = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@cloudhost247.test', password: 'demo-tools-247' }) });
assert(customerLogin.ok, `customer login failed: ${customerLogin.status}`);
const customer = await customerLogin.json();
const shop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await shop.route(META_HOSTS, interceptMeta);
const shopPage = await shop.newPage();
await shopPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await shopPage.waitForSelector('.ch247-cookie-banner:not([hidden])', { timeout: 10000 });
await shopPage.getByRole('button', { name: 'Accept All' }).click();
await shopPage.waitForSelector('#ch247-meta-pixel-sdk', { state: 'attached', timeout: 10000 });
await shopPage.evaluate(({ token, user }) => { localStorage.setItem('ch247_token', token); localStorage.setItem('ch247_user', JSON.stringify(user)); }, { token: customer.token, user: customer.user });
// Drive the real cart/checkout/payment APIs from the consented page so the consent cookie binds the
// conversion context to this browser session (Authorization header carries the customer auth).
const checkout = await shopPage.evaluate(async ({ token }) => {
  const call = async (url, body) => {
    const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${url} -> ${res.status} ${await res.text()}`);
    return res.json();
  };
  await call('/api/v1/cart/catalog-items', { productSlug: 'web-hosting', planSlug: 'starter', billingPeriod: 'monthly' });
  const { order } = await call('/api/v1/orders', {});
  const { payment } = await call(`/api/v1/invoices/${order.invoiceId}/payments`, { gateway: 'manual' });
  return { orderId: order.id, invoiceId: order.invoiceId, paymentId: payment.id, totalAmount: order.totalAmount, currency: order.currency };
}, { token: customer.token });
assert(checkout.invoiceId && checkout.paymentId, `checkout did not return invoice/payment: ${JSON.stringify(checkout)}`);
const confirm = await fetch(`${BASE}/api/v1/admin/payments/${checkout.paymentId}/confirm-manual`, { method: 'POST', headers: { ...adminHeaders } });
assert(confirm.ok, `manual confirmation failed: ${confirm.status} ${await confirm.text()}`);
await shopPage.goto(`${BASE}/invoices/${checkout.invoiceId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await shopPage.waitForTimeout(3500);
const shopQueue = await shopPage.evaluate(() => (window.fbq && window.fbq.queue ? window.fbq.queue.map(call => Array.from(call)) : []));
const purchases = shopQueue.filter(c => c[0] === 'trackSingle' && c[1] === PIXEL && c[2] === 'Purchase');
check('verified purchase fires exactly one browser Purchase', purchases.length === 1, purchases);
const purchaseEvent = purchases[0]?.[3] ?? {};
const purchaseOptions = purchases[0]?.[4] ?? {};
check('browser Purchase uses the verified payment event ID', purchaseOptions.eventID === `purchase:${checkout.paymentId}`, purchaseOptions);
check('browser Purchase carries canonical catalog content IDs', Array.isArray(purchaseEvent.content_ids) && purchaseEvent.content_ids.includes('catalog:web-hosting:starter'), purchaseEvent);
check('browser Purchase value/currency come from the paid order', purchaseEvent.currency === checkout.currency && Number(purchaseEvent.value) === Number(checkout.totalAmount), { receipt: purchaseEvent, order: checkout });
// The server-side Purchase must also exist for the same payment (CAPI authority), via the admin activity API.
const activity = await (await fetch(`${BASE}/api/v1/admin/marketing-integrations/meta-pixel/activity?limit=100`, { headers: adminHeaders })).json();
const serverPurchase = (activity.events ?? []).find(e => e.event_name === 'Purchase' && e.event_id === `purchase:${checkout.paymentId}`);
check('server recorded the same verified Purchase event ID', Boolean(serverPurchase), serverPurchase ?? { events: (activity.events ?? []).map(e => e.event_id) });
await shopPage.screenshot({ path: path.join(OUT, 'verified-purchase.png'), fullPage: false });
await shop.close();

await browser.close();
report.passed = report.checks.every(c => c.ok);
writeFileSync(path.join(OUT, 'browser-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, metaRequests: report.metaRequests.length, out: OUT }, null, 2));
if (!report.passed) process.exit(1);
