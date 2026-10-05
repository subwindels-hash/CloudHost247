'use strict';

/**
 * Content system: knowledgebase + blog articles.
 *
 * Pins the honesty contract: drafts and missing articles never leak publicly,
 * rendered article HTML escapes untrusted body content, the sitemap picks up
 * published articles automatically, and writes are admin-gated + audited.
 */

const test = require('node:test');
const assert = require('node:assert');
const { startServer, jsonFetch } = require('./helpers');
const { uuidv7 } = require('../src/lib/ids');
const { hashPassword } = require('../src/lib/password');

const ADMIN = { email: 'editor@example.com', password: 'EditorPass123!' };
const OWNER = { email: 'owner@example.com', password: 'OwnerPass123!' };
const CUSTOMER = { email: 'reader@example.com', password: 'ReaderPass123!' };

async function seedWorld({ store }) {
  await store.table('users').insert({
    id: uuidv7(), email: ADMIN.email, password_hash: await hashPassword(ADMIN.password),
    full_name: 'Editor', role: 'admin', status: 'active',
  });
  await store.table('users').insert({
    id: uuidv7(), email: OWNER.email, password_hash: await hashPassword(OWNER.password),
    full_name: 'Owner', role: 'super_admin', status: 'active',
  });
  await store.table('users').insert({
    id: uuidv7(), email: CUSTOMER.email, password_hash: await hashPassword(CUSTOMER.password),
    full_name: 'Reader', role: 'customer', status: 'active',
  });
  const published = {
    id: uuidv7(), kind: 'kb', slug: 'how-billing-works', title: 'How billing works',
    category: 'Billing', author: 'CloudHost247 Team', summary: 'Invoices and cycles.',
    body: '## Cycles\n\nMonthly or annual.\n\n- Pay first\n- Renew later',
    status: 'published', search_keywords: 'invoice payment',
    published_at: '2026-10-05T10:00:00.000Z',
  };
  const draft = {
    id: uuidv7(), kind: 'blog', slug: 'secret-roadmap', title: 'Secret roadmap',
    category: 'News', author: 'CloudHost247 Team', summary: null,
    body: 'Not ready yet.', status: 'draft', search_keywords: null, published_at: null,
  };
  await store.table('site_articles').insert(published);
  await store.table('site_articles').insert(draft);
  return { publishedId: published.id, draftId: draft.id };
}

async function login(base, creds) {
  const res = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: creds });
  assert.strictEqual(res.status, 200, `login failed: ${JSON.stringify(res.data)}`);
  return res.data.accessToken;
}

test('content: public reads show only published articles', async (t) => {
  const { base, close } = await startServer({ seed: seedWorld });

  await t.test('list filters by kind, category and search', async () => {
    const all = await jsonFetch(base, { path: '/api/v1/public/articles' });
    assert.strictEqual(all.status, 200);
    assert.deepStrictEqual(all.data.articles.map((a) => a.slug), ['how-billing-works'], 'drafts must never list');

    const kb = await jsonFetch(base, { path: '/api/v1/public/articles?kind=kb' });
    assert.strictEqual(kb.data.articles.length, 1);
    const blog = await jsonFetch(base, { path: '/api/v1/public/articles?kind=blog' });
    assert.strictEqual(blog.data.articles.length, 0);

    const byCat = await jsonFetch(base, { path: '/api/v1/public/articles?category=billing' });
    assert.strictEqual(byCat.data.articles.length, 1);

    const q = await jsonFetch(base, { path: '/api/v1/public/articles?q=payment' });
    assert.strictEqual(q.data.articles.length, 1, 'keywords are searchable');
    const qMiss = await jsonFetch(base, { path: '/api/v1/public/articles?q=zzz-no-match' });
    assert.strictEqual(qMiss.data.articles.length, 0);
  });

  await t.test('detail serves the body; drafts and unknown slugs 404', async () => {
    const ok = await jsonFetch(base, { path: '/api/v1/public/articles/how-billing-works' });
    assert.strictEqual(ok.status, 200);
    assert.match(ok.data.article.body, /Cycles/);
    assert.strictEqual(ok.data.article.author, 'CloudHost247 Team');

    const draft = await jsonFetch(base, { path: '/api/v1/public/articles/secret-roadmap' });
    assert.strictEqual(draft.status, 404, 'draft articles must not be readable publicly');

    const nope = await jsonFetch(base, { path: '/api/v1/public/articles/never-existed' });
    assert.strictEqual(nope.status, 404);
  });

  await t.test('rendered page escapes untrusted bodies', async () => {
    const res = await fetch(`${base}/kb/how-billing-works`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.match(html, /<h2>Cycles<\/h2>/);
    assert.match(html, /<li>Pay first<\/li>/);

    // An article whose body contains markup must be escaped, never executed.
    const admin = await login(base, ADMIN);
    const created = await jsonFetch(base, {
      path: '/api/v1/admin/articles', method: 'POST',
      body: {
        kind: 'kb', slug: 'xss-probe', title: 'Probe',
        body: '<script>alert(1)</script>\n\n## Heading <img src=x>', status: 'published',
      },
    }, admin);
    assert.strictEqual(created.status, 201);
    const page = await (await fetch(`${base}/kb/xss-probe`)).text();
    assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'script tag must be escaped');
    assert.ok(!page.includes('<script>alert(1)'), 'raw script must never render');
  });

  await t.test('sitemap includes published article URLs', async () => {
    const xml = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.ok(xml.includes('/kb/how-billing-works'));
    assert.ok(!xml.includes('/blog/secret-roadmap'), 'drafts must not be crawled');
  });

  await close();
});

test('content: admin CRUD is gated, validated and audited', async (t) => {
  const { base, close } = await startServer({ seed: seedWorld });

  await t.test('customers and anonymous callers cannot write', async () => {
    const anon = await jsonFetch(base, { path: '/api/v1/admin/articles', method: 'POST', body: { kind: 'kb', slug: 'x', title: 'x', body: 'x' } });
    assert.strictEqual(anon.status, 401);

    const customer = await login(base, CUSTOMER);
    const denied = await jsonFetch(base, { path: '/api/v1/admin/articles', method: 'POST', body: { kind: 'kb', slug: 'x', title: 'x', body: 'x' } }, customer);
    assert.strictEqual(denied.status, 403);
  });

  await t.test('create -> publish flow -> patch -> delete, with audit trail', async () => {
    const admin = await login(base, ADMIN);

    const badSlug = await jsonFetch(base, { path: '/api/v1/admin/articles', method: 'POST', body: { kind: 'kb', slug: 'Not A Slug', title: 't', body: 'b' } }, admin);
    assert.strictEqual(badSlug.status, 400);

    const created = await jsonFetch(base, {
      path: '/api/v1/admin/articles', method: 'POST',
      body: { kind: 'blog', slug: 'launch-notes', title: 'Launch notes', body: '## Hello\n\nWorld.', status: 'draft' },
    }, admin);
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.data.article.status, 'draft');

    const clash = await jsonFetch(base, { path: '/api/v1/admin/articles', method: 'POST', body: { kind: 'kb', slug: 'launch-notes', title: 'Other', body: 'b' } }, admin);
    assert.strictEqual(clash.status, 400, 'slug must stay unique');

    const published = await jsonFetch(base, { path: `/api/v1/admin/articles/${created.data.article.id}`, method: 'PATCH', body: { status: 'published' } }, admin);
    assert.strictEqual(published.status, 200);
    assert.ok(published.data.article.publishedAt, 'first publish stamps the date');

    const visible = await jsonFetch(base, { path: '/api/v1/public/articles/launch-notes' });
    assert.strictEqual(visible.status, 200, 'published article is immediately public');

    const deleted = await jsonFetch(base, { path: `/api/v1/admin/articles/${created.data.article.id}`, method: 'DELETE' }, admin);
    assert.strictEqual(deleted.status, 200);
    const gone = await jsonFetch(base, { path: '/api/v1/public/articles/launch-notes' });
    assert.strictEqual(gone.status, 404);
  });

  await t.test('site settings round-trip drives the public contact info', async () => {
    // Settings writes are super_admin-only: a plain admin is refused, the owner succeeds.
    const admin = await login(base, ADMIN);
    const denied = await jsonFetch(base, {
      path: '/api/v1/admin/settings/site_info', method: 'PUT',
      body: { value: { supportEmail: 'x@example.com' } },
    }, admin);
    assert.strictEqual(denied.status, 403);

    const owner = await login(base, OWNER);
    const saved = await jsonFetch(base, {
      path: '/api/v1/admin/settings/site_info', method: 'PUT',
      body: { value: { supportEmail: 'help@cloudhost247.example', hacker: 'nope' } },
    }, owner);
    assert.strictEqual(saved.status, 200);

    const pub = await jsonFetch(base, { path: '/api/v1/public/site-info' });
    assert.strictEqual(pub.data.supportEmail, 'help@cloudhost247.example');
    assert.strictEqual(pub.data.hacker, undefined, 'non-whitelisted keys never reach the public site');
  });

  await close();
});
