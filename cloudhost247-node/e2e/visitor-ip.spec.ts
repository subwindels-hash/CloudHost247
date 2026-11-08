import { expect, test } from '@playwright/test';

/**
 * The menu bar's IP detector, end to end: real browser → real proxy → real endpoint → rendered DOM.
 *
 * The unit test (`frontend/tests/unit/visitor-privacy.test.tsx`) mocks `fetch`, so it proves the
 * widget's logic but not that anything is actually wired to `/api/v1/visitor/ip`. This spec lets the
 * request happen for real and then asserts the DOM says exactly what the endpoint said — which holds
 * whatever `VISITOR_IP_MODE` the API was started with, so it is runnable against any environment.
 *
 * To see it detect a real address, start the API with detection on (see docs/visitor-ip-privacy.md):
 *   VISITOR_IP_MODE=direct npm run dev:api          # no proxy in front of Node
 *   VISITOR_IP_MODE=trusted-proxy \
 *     VISITOR_IP_TRUSTED_PROXIES=127.0.0.1/32 npm run dev:api   # behind the vite preview proxy
 */

const REASON_LABELS: Record<string, string> = {
  disabled: 'IP: not enabled',
  unverified: 'IP: unverified',
  not_public: 'IP: not public',
};

test('the header shows exactly what the real endpoint reported, and never invents an address', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const seen: Array<{ status: number; body: unknown }> = [];
  page.on('response', async (response) => {
    if (!response.url().includes('/api/v1/visitor/ip')) return;
    let body: unknown = null;
    try { body = await response.json(); } catch { body = null; }
    seen.push({ status: response.status(), body });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const indicator = page.locator('.ch247-visitor-privacy__ip');
  await expect(indicator).toBeVisible();
  // The widget requests on load; wait for the real round trip rather than a fixed sleep.
  await expect.poll(() => seen.length, { timeout: 15_000 }).toBeGreaterThan(0);

  // Only the visible label: the element also carries a visually-hidden sentence for assistive tech,
  // which textContent would include.
  const rendered = await indicator.evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.sr-only').forEach((node) => node.remove());
    return (clone.textContent ?? '').trim();
  });
  const response = seen[seen.length - 1]!;
  const payload = (response.body ?? {}) as { ip?: unknown; reason?: unknown };

  expect(response.status, 'the endpoint must answer, not 404 or fall through to the SPA shell').toBe(200);

  if (typeof payload.ip === 'string' && payload.ip.length > 0) {
    // A detected address is shown verbatim — the one place the widget is allowed to name an IP.
    expect(rendered).toBe(`IP: ${payload.ip}`);
  } else {
    // Otherwise it must show the server's own reason, or "unavailable" if the request failed.
    const expected = typeof payload.reason === 'string' && REASON_LABELS[payload.reason]
      ? REASON_LABELS[payload.reason]
      : 'IP: unavailable';
    expect(rendered).toBe(expected);
    // No IPv4 address may appear in the strip when the endpoint reported none.
    expect(rendered).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/);
  }
});

/**
 * The "it really detects" half of the contract, runnable only when the environment supplies both a
 * configured boundary and an edge that appends the visitor's address:
 *
 *   CH247_E2E_EDGE_XFF=102.89.234.5 \
 *   VISITOR_IP_MODE=trusted-proxy VISITOR_IP_TRUSTED_PROXIES=127.0.0.1/32 npm run e2e -- visitor-ip
 *
 * Use a genuinely public address. Documentation ranges (203.0.113.0/24, 198.51.100.0/24) are
 * `reserved` to ipaddr.js, so the resolver rightly reports them as `not_public` instead of naming
 * them a visitor's address — that is the contract, not a bug.
 *
 * Browsers refuse to set X-Forwarded-For themselves, so Playwright injects it the way a correctly
 * configured Cloudflare/Apache/nginx edge would. Without the variable the test is skipped rather
 * than faked: an unconfigured deployment is expected to report "unverified", which the first test
 * already asserts.
 */
test('shows the edge-supplied address when the boundary is configured', async ({ page }) => {
  const edge = process.env.CH247_E2E_EDGE_XFF;
  test.skip(!edge, 'set CH247_E2E_EDGE_XFF and VISITOR_IP_MODE/VISITOR_IP_TRUSTED_PROXIES to exercise real detection');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': edge! });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const indicator = page.locator('.ch247-visitor-privacy__ip');
  await expect(indicator).toContainText(`IP: ${edge}`, { timeout: 15_000 });

  // The geolocation endpoint resolves the same address, so the country beside it is the IP's,
  // labelled as an estimate.
  const country = page.locator('.ch247-country');
  await expect
    .poll(async () => (await country.getAttribute('aria-label')) ?? '', { timeout: 15_000 })
    .toMatch(/Country is estimated from your IP address/i);
});

test('the detector never claims privacy protection it cannot verify', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const ticker = page.getByRole('region', { name: 'Privacy status' });
  await expect(ticker).toBeVisible();
  await expect(ticker).toContainText('Privacy status cannot be verified');

  // An address on its own cannot prove a VPN or proxy is or is not in use, so the strip must not
  // advertise a protection level, a score or a guarantee.
  const text = (await ticker.textContent()) ?? '';
  expect(text).not.toMatch(/100%|protected|protection is active|safe|anonymous/i);

  // The scrolling copy is duplicated for the marquee; only the duplicate may be hidden from
  // assistive technology, or a screen reader reads the same sentence twice.
  const hidden = ticker.locator('.ch247-privacy-ticker__message[aria-hidden="true"]');
  await expect(hidden).toHaveCount(1);
});

test('the country indicator beside the IP agrees with the geolocation endpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  let country: unknown;
  let responded = false;
  page.on('response', async (response) => {
    if (!response.url().includes('/api/v1/currency/geo-country')) return;
    responded = true;
    try { country = (await response.json() as { country?: unknown }).country; } catch { country = null; }
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const indicator = page.locator('.ch247-country');
  await expect(indicator).toBeVisible();
  await expect.poll(() => responded, { timeout: 15_000 }).toBe(true);

  const label = (await indicator.getAttribute('aria-label')) ?? '';
  if (typeof country === 'string' && /^[A-Z]{2}$/.test(country)) {
    // IP-detected country wins, and is labelled as an estimate rather than a fact.
    await expect.poll(() => label).toContain('Country or region:');
    expect(label).toMatch(/estimated from your IP address/i);
  } else {
    // No IP country: either the browser's own region or an honest "could not be detected".
    expect(label).toMatch(/estimated from your browser settings|could not be detected/i);
  }
});
