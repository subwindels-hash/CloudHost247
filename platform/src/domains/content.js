/**
 * Content: admin-managed knowledgebase and blog articles for the public site.
 *
 * Honesty rules:
 *  - Nothing is public until a staff member creates it AND marks it published.
 *    There is no generated filler: an empty deployment renders an honest
 *    "articles appear as they are written" state.
 *  - Article bodies are markdown-lite (## headings, - lists, paragraphs). HTML in
 *    bodies is escaped before rendering — the public renderer never trusts content.
 *  - Writes are admin-gated and audited.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin } = require('../lib/auth');

const name = 'content';

const KINDS = ['kb', 'blog'];

const slugSchema = v
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase letters, numbers and single hyphens');

const articleInputSchema = v.object({
  kind: v.enum(KINDS),
  slug: slugSchema,
  title: v.string().min(1).max(200),
  category: v.string().min(1).max(60).default('general'),
  author: v.string().min(1).max(120).default('CloudHost247 Team'),
  summary: v.string().max(400).optional(),
  body: v.string().min(1).max(60_000),
  status: v.enum(['draft', 'published']).default('draft'),
  searchKeywords: v.string().max(400).optional(),
});

function publicArticle(row, { withBody }) {
  return {
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    category: row.category,
    author: row.author,
    summary: row.summary ?? '',
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    ...(withBody ? { body: row.body } : {}),
  };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Markdown-lite: escape everything first, then render the three supported constructs. */
function renderBody(body) {
  const lines = String(body).split(/\r?\n/);
  const out = [];
  let listOpen = false;
  let para = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(escapeHtml).join('<br>')}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (listOpen) { out.push('</ul>'); listOpen = false; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); closeList(); continue; }
    const h2 = /^##\s+(.*)$/.exec(line);
    const h3 = /^###\s+(.*)$/.exec(line);
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (h2 || h3) {
      flushPara(); closeList();
      const level = h2 ? 'h2' : 'h3';
      out.push(`<${level}>${escapeHtml((h2 || h3)[1])}</${level}>`);
    } else if (li) {
      flushPara();
      if (!listOpen) { out.push('<ul>'); listOpen = true; }
      out.push(`<li>${escapeHtml(li[1])}</li>`);
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara(); closeList();
  return out.join('\n');
}

function register(router, deps) {
  const { store } = deps;
  const articles = () => store.table('site_articles');

  /* ---------------------------------------------------------------- */
  /* Public API                                                        */
  /* ---------------------------------------------------------------- */
  router.get('/api/v1/public/articles', async (ctx) => {
    const query = await ctx.validateQuery(v.object({
      kind: v.enum(KINDS).optional(),
      category: v.string().max(60).optional(),
      q: v.string().max(120).optional(),
    }));

    let rows = (await articles().all()).filter((r) => r.status === 'published');
    if (query.kind) rows = rows.filter((r) => r.kind === query.kind);
    if (query.category) rows = rows.filter((r) => r.category.toLowerCase() === query.category.toLowerCase());
    if (query.q) {
      const needle = query.q.toLowerCase();
      rows = rows.filter((r) => [r.title, r.summary, r.body, r.search_keywords, r.category]
        .some((field) => String(field ?? '').toLowerCase().includes(needle)));
    }
    rows.sort((a, b) => String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')));

    ctx.json({ articles: rows.slice(0, 100).map((r) => publicArticle(r, { withBody: false })) });
  });

  router.get('/api/v1/public/articles/:slug', async (ctx) => {
    const rows = (await articles().all()).filter((r) => r.slug === ctx.params.slug && r.status === 'published');
    if (!rows.length) throw new NotFoundError('Article not found');
    ctx.json({ article: publicArticle(rows[0], { withBody: true }) });
  });

  /* ---------------------------------------------------------------- */
  /* Server-rendered article pages (SEO: real HTML at clean URLs)      */
  /* ---------------------------------------------------------------- */
  const renderArticlePage = (kindLabel, baseCrumb) => async (ctx) => {
    const rows = (await articles().all()).filter((r) => r.slug === ctx.params.slug && r.status === 'published');
    if (!rows.length) throw new NotFoundError('Article not found');
    const a = rows[0];
    const description = escapeHtml((a.summary || a.body || '').slice(0, 160));
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(a.title)} | CloudHost247</title>
<meta name="description" content="${description}" />
<link rel="canonical" href="/${kindLabel === 'Blog' ? 'blog' : 'knowledgebase'}/${escapeHtml(a.slug)}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="stylesheet" href="/assets/css/site.css" />
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: a.title,
  author: { '@type': 'Organization', name: a.author },
  datePublished: a.published_at ?? undefined,
  dateModified: a.updated_at ?? undefined,
})}</script>
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
<header class="site-header"><div class="container nav-bar" style="min-height:56px">
  <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">C</span><span>CloudHost247</span></a>
  <div class="nav-actions"><a class="btn btn--ghost" href="/${kindLabel === 'Blog' ? 'blog' : 'knowledgebase'}">Back to ${kindLabel}</a></div>
</div></header>
<main id="main">
  <div class="page-head"><div class="container">
    <nav aria-label="Breadcrumb"><ol class="crumbs"><li><a href="/">Home</a></li><li><a href="/${baseCrumb}">${kindLabel}</a></li><li><span aria-current="page">${escapeHtml(a.title)}</span></li></ol></nav>
    <h1>${escapeHtml(a.title)}</h1>
    <p>${a.summary ? escapeHtml(a.summary) : ''}</p>
  </div></div>
  <section class="section"><div class="container">
    <p class="small muted">${escapeHtml(a.category)} · Updated ${new Date(a.updated_at ?? a.published_at ?? Date.now()).toISOString().slice(0, 10)} · ${escapeHtml(a.author)}</p>
    <div class="prose">${renderBody(a.body)}</div>
  </div></section>
</main>
<script type="module" src="/assets/js/site.js"></script>
</body>
</html>`;
    ctx.header('Content-Type', 'text/html; charset=utf-8').send(html);
  };

  router.get('/kb/:slug', renderArticlePage('Knowledgebase', 'knowledgebase'));
  router.get('/knowledgebase/:slug', renderArticlePage('Knowledgebase', 'knowledgebase'));
  router.get('/blog/:slug', renderArticlePage('Blog', 'blog'));

  /* ---------------------------------------------------------------- */
  /* Admin CRUD                                                        */
  /* ---------------------------------------------------------------- */
  router.get('/api/v1/admin/articles', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await articles().all();
    rows.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
    ctx.json({ articles: rows.map((r) => ({ id: r.id, ...publicArticle(r, { withBody: true }), status: r.status, searchKeywords: r.search_keywords ?? '' })) });
  });

  router.post('/api/v1/admin/articles', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const input = await ctx.validate(articleInputSchema);

    const clash = (await articles().all()).find((r) => r.slug === input.slug);
    if (clash) throw new ValidationError('slug is already in use');

    const now = new Date().toISOString();
    const row = {
      id: uuidv7(),
      kind: input.kind,
      slug: input.slug,
      title: input.title,
      category: input.category,
      author: input.author,
      summary: input.summary ?? null,
      body: input.body,
      status: input.status,
      search_keywords: input.searchKeywords ?? null,
      published_at: input.status === 'published' ? now : null,
    };
    await articles().insert(row);
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'article_create', entity_type: 'site_articles', entity_id: row.id,
      ip_address: ctx.ip, user_agent: ctx.userAgent,
    });
    ctx.code(201).json({ article: { id: row.id, ...publicArticle(row, { withBody: false }), status: row.status } });
  });

  router.patch('/api/v1/admin/articles/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const existing = await articles().findById(ctx.params.id);
    if (!existing) throw new NotFoundError('Article not found');

    const input = await ctx.validate(articleInputSchema.partial());
    if (input.slug && input.slug !== existing.slug) {
      const clash = (await articles().all()).find((r) => r.slug === input.slug);
      if (clash) throw new ValidationError('slug is already in use');
    }

    const patch = {};
    for (const key of ['kind', 'slug', 'title', 'category', 'author', 'summary', 'body', 'status']) {
      if (input[key] !== undefined) patch[key] = input[key];
    }
    if (input.searchKeywords !== undefined) patch.search_keywords = input.searchKeywords;
    if (patch.status === 'published' && existing.status !== 'published' && !existing.published_at) {
      patch.published_at = new Date().toISOString();
    }

    await articles().updateById(ctx.params.id, patch);
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'article_update', entity_type: 'site_articles', entity_id: ctx.params.id,
      ip_address: ctx.ip, user_agent: ctx.userAgent,
    });
    const updated = await articles().findById(ctx.params.id);
    ctx.json({ article: { id: updated.id, ...publicArticle(updated, { withBody: false }), status: updated.status } });
  });

  router.delete('/api/v1/admin/articles/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const existing = await articles().findById(ctx.params.id);
    if (!existing) throw new NotFoundError('Article not found');
    await articles().deleteById(ctx.params.id);
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'article_delete', entity_type: 'site_articles', entity_id: ctx.params.id,
      ip_address: ctx.ip, user_agent: ctx.userAgent,
    });
    ctx.json({ ok: true });
  });
}

module.exports = { name, register, renderBody };
