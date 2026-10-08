'use strict';

/**
 * Public marketing site: clean URLs, public endpoints and honesty guarantees.
 *
 * The strongest properties pinned here are the honesty rules: site-info never
 * invents contact details, locations never invent data centers, and the status
 * page never claims monitoring that is not wired in.
 */

const test = require('node:test');
const assert = require('node:assert');
const { startServer, jsonFetch } = require('./helpers');
const { uuidv7 } = require('../src/lib/ids');

test('site: clean URLs and generated pages', async (t) => {
  const { base, close } = await startServer();

  await t.test('extensionless path serves the page file', async () => {
    const res = await fetch(`${base}/hosting`);
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.match(body, /<h1>Hosting Built for Serious Work<\/h1>/);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });

  await t.test('nested clean URL serves the nested page', async () => {
    const res = await fetch(`${base}/hosting/vps`);
    assert.strictEqual(res.status, 200);
    assert.match(await res.text(), /Your Infrastructure, Your Control/);
  });

  await t.test('unknown extensionless path still 404s', async () => {
    const res = await fetch(`${base}/definitely-not-a-page`);
    assert.strictEqual(res.status, 404);
  });

  await t.test('every legal page serves with its version stamp', async () => {
    for (const slug of ['terms', 'privacy', 'cookies', 'acceptable-use', 'sla', 'refund-policy']) {
      const res = await fetch(`${base}/legal/${slug}`);
      assert.strictEqual(res.status, 200, slug);
      assert.match(await res.text(), /Version 1\.0/, slug);
    }
  });

  await t.test('legacy hosting URLs redirect to the new pages', async () => {
    for (const [oldPath, target] of [['/vps-hosting.html', '/hosting/vps'], ['/web-hosting.html', '/hosting/web-hosting']]) {
      const res = await fetch(`${base}${oldPath}`);
      assert.strictEqual(res.status, 200);
      const body = await res.text();
      assert.ok(body.includes(`url=${target}`), `${oldPath} should redirect to ${target}`);
    }
  });

  await t.test('auth pages keep their JS contracts', async () => {
    const login = await (await fetch(`${base}/login`)).text();
    for (const marker of ['data-login-form', 'data-passkey-login', 'data-mfa-field', 'data-form-alert']) {
      assert.ok(login.includes(marker), `login.html must keep ${marker}`);
    }
    const register = await (await fetch(`${base}/register`)).text();
    assert.ok(register.includes('data-register-form'));
    const forgot = await (await fetch(`${base}/forgot`)).text();
    assert.ok(forgot.includes('data-forgot-form'));
  });

  await t.test('navigation carries the required structure', async () => {
    const home = await (await fetch(`${base}/`)).text();
    for (const marker of ['data-nav-toggle', 'data-nav', 'data-auth-slot', 'skip-link', '/hosting/web-hosting', '/domains', '/business-email', '/infrastructure', '/knowledgebase', '/status', '/about', '/contact']) {
      assert.ok(home.includes(marker), `homepage must include ${marker}`);
    }
  });

  await t.test('SEO metadata is present and unique per page', async () => {
    const home = await (await fetch(`${base}/`)).text();
    const vps = await (await fetch(`${base}/hosting/vps`)).text();
    assert.match(home, /<link rel="canonical" href="\/" \/>/);
    assert.match(vps, /<link rel="canonical" href="\/hosting\/vps" \/>/);
    const homeTitle = home.match(/<title>(.*?)<\/title>/)[1];
    const vpsTitle = vps.match(/<title>(.*?)<\/title>/)[1];
    assert.notStrictEqual(homeTitle, vpsTitle);
    assert.match(home, /application\/ld\+json/);
  });

  await close();
});

test('site: sitemap and robots are generated from APP_URL', async () => {
  const { base, close } = await startServer({ APP_URL: 'https://shop.example.test' });

  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.ok(sitemap.includes('<loc>https://shop.example.test/</loc>'));
  assert.ok(sitemap.includes('<loc>https://shop.example.test/hosting/vps</loc>'));
  assert.ok(sitemap.includes('<loc>https://shop.example.test/legal/terms</loc>'));

  const robots = await (await fetch(`${base}/robots.txt`)).text();
  assert.ok(robots.includes('Sitemap: https://shop.example.test/sitemap.xml'));
  assert.ok(robots.includes('Disallow: /api/'));

  await close();
});

test('site: public site-info is honest about what is configured', async (t) => {
  const { base, close } = await startServer();

  await t.test('unconfigured deployment publishes no contact details', async () => {
    const res = await jsonFetch(base, { path: '/api/v1/public/site-info' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.brandName, 'CloudHost247');
    assert.strictEqual(res.data.supportEmail, undefined);
    assert.strictEqual(res.data.phone, undefined);
    assert.strictEqual(res.data.addressCity, undefined);
  });

  await t.test('configured values are published, unknown keys are dropped', async () => {
    // Simulate the admin settings write path (platform_settings key `site_info`).
    const second = await startServer({
      seed: async ({ store }) => {
        await store.table('platform_settings').insert({
          key: 'site_info',
          value: {
            supportEmail: 'support@cloudhost247.com',
            phone: '+234 800 000 0000',
            hackerField: '<script>alert(1)</script>',
            socialTwitter: '  https://twitter.com/cloudhost247  ',
          },
        });
      },
    });
    const res = await jsonFetch(second.base, { path: '/api/v1/public/site-info' });
    assert.strictEqual(res.data.supportEmail, 'support@cloudhost247.com');
    assert.strictEqual(res.data.phone, '+234 800 000 0000');
    assert.strictEqual(res.data.socialTwitter, 'https://twitter.com/cloudhost247');
    assert.strictEqual(res.data.hackerField, undefined, 'non-whitelisted keys must never be published');
    await second.close();
  });

  await close();
});

test('site: locations list only real configured regions', async (t) => {
  await t.test('empty platform reports configured:false', async () => {
    const { base, close } = await startServer();
    const res = await jsonFetch(base, { path: '/api/v1/public/locations' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.data.locations, []);
    assert.strictEqual(res.data.configured, false);
    await close();
  });

  await t.test('active regions of active providers are listed; disabled ones are not', async () => {
    const { base, close } = await startServer({
      seed: async ({ store }) => {
        const liveProvider = uuidv7();
        const offProvider = uuidv7();
        await store.table('infra_providers').insert({ id: liveProvider, name: 'Hetzner Falkenstein', active: true, status: 'active' });
        await store.table('infra_providers').insert({ id: offProvider, name: 'Retired DC', active: false, status: 'disabled' });
        await store.table('regions').insert({ id: uuidv7(), provider_id: liveProvider, code: 'fsn1', name: 'Falkenstein', country_code: 'DE', active: true, status: 'ACTIVE' });
        await store.table('regions').insert({ id: uuidv7(), provider_id: liveProvider, code: 'ash1', name: 'Ashburn', country_code: 'US', active: false, status: 'ACTIVE' });
        await store.table('regions').insert({ id: uuidv7(), provider_id: offProvider, code: 'old1', name: 'Old Region', country_code: 'XX', active: true, status: 'ACTIVE' });
      },
    });
    const res = await jsonFetch(base, { path: '/api/v1/public/locations' });
    assert.strictEqual(res.data.configured, true);
    assert.deepStrictEqual(res.data.locations.map((l) => l.code), ['fsn1']);
    assert.strictEqual(res.data.locations[0].name, 'Falkenstein');
    assert.strictEqual(res.data.locations[0].country, 'DE');
    assert.strictEqual(res.data.locations[0].provider, 'Hetzner Falkenstein');
    await close();
  });
});

test('site: status endpoint never overclaims', async () => {
  const { base, close } = await startServer();
  const res = await jsonFetch(base, { path: '/api/v1/public/status' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.monitored, false, 'no monitoring is wired in yet — must not claim it');
  assert.ok(res.data.checkedAt);

  const byKey = Object.fromEntries(res.data.components.map((c) => [c.key, c.status]));
  assert.strictEqual(byKey.website, 'operational');
  assert.strictEqual(byKey.api, 'operational');
  assert.strictEqual(byKey.storage, 'operational');
  assert.strictEqual(byKey.hosting, 'unmonitored');
  assert.strictEqual(byKey.dns, 'unmonitored');
  assert.strictEqual(byKey.billing, 'unmonitored');
  assert.match(res.data.note, /unmonitored/i);
  await close();
});

test('site: domain search is public and never guesses availability', async (t) => {
  const { base, close } = await startServer();
  // Registered before the assertions, not after them: a failed assertion used to skip `close()` and
  // leave the server listening, which hangs the whole suite rather than failing one test.
  t.after(() => close());

  const res = await jsonFetch(base, {
    path: '/api/v1/domain-services/search',
    method: 'POST',
    body: { query: 'acme-works.com' },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.estimate, false, 'nothing here is an estimate: it is either a registry fact or a refusal');
  assert.ok(Array.isArray(res.data.results) && res.data.results.length > 0);
  // With no RDAP provider connected, there is no answer to give — and `null` is the only honest
  // value. The old behaviour returned a regex verdict (`available: true|false`) labelled an estimate.
  assert.ok(res.data.results.every((r) => typeof r.domain === 'string' && r.available === null));
  assert.ok(res.data.results.every((r) => r.status === 'unknown'));
  assert.strictEqual(res.data.status, 'provider_unavailable');
  assert.strictEqual(res.data.failure.code, 'PROVIDER_NOT_CONFIGURED');
});
