/**
 * CloudHost247 public site behavior.
 *
 * Data honesty rules:
 *  - Prices, TLD pricing, locations and status come ONLY from the platform APIs.
 *  - When an API has nothing configured, the UI renders an explicit empty state
 *    ("not configured yet") — never invented content.
 *  - Domain search results are labeled as estimates whenever the API says so
 *    (until a registrar connector is configured).
 */

const TOKEN_KEY = 'ch247_session';

function getToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.accessToken || null;
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

const money = (value, currency = 'USD') =>
  new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value);

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */
function initNav() {
  const header = document.querySelector('[data-header]');
  const toggle = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-nav]');
  if (!toggle || !nav || !header) return;

  toggle.addEventListener('click', () => {
    const open = header.getAttribute('data-nav-open') === 'true';
    header.setAttribute('data-nav-open', String(!open));
    toggle.setAttribute('aria-expanded', String(!open));
    toggle.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
    document.body.toggleAttribute('data-nav-locked', !open);
  });

  // Mobile: tap a top-level item with a dropdown to expand it (first tap),
  // or navigate (when already expanded).
  for (const li of nav.querySelectorAll(':scope > li')) {
    const link = li.querySelector('.nav-link');
    const dropdown = li.querySelector('.dropdown');
    if (!link || !dropdown) continue;
    link.addEventListener('click', (event) => {
      if (window.matchMedia('(min-width: 1024px)').matches) return;
      if (!li.hasAttribute('data-open')) {
        event.preventDefault();
        for (const other of nav.querySelectorAll(':scope > li')) other.removeAttribute('data-open');
        li.setAttribute('data-open', 'true');
      }
    });
  }

  // Close the drawer when any link inside it is followed.
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      header.setAttribute('data-nav-open', 'false');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.removeAttribute('data-nav-locked');
    }
  });
}

/* ------------------------------------------------------------------ */
/* Auth slot: swap guest actions for a Client Area link when signed in */
/* ------------------------------------------------------------------ */
function initAuthSlot() {
  const slot = document.querySelector('[data-auth-slot]');
  if (!slot) return;
  if (getToken()) {
    const login = slot.querySelector('[data-auth-login]');
    if (login) login.hidden = true;
    const client = slot.querySelector('[data-auth-client]');
    if (client) { client.classList.remove('btn--secondary'); client.classList.add('btn--primary'); }
    const cta = slot.querySelector('a[href="/app/catalog"]');
    if (cta) cta.hidden = true;
  }
}

/* ------------------------------------------------------------------ */
/* Pricing — rendered ONLY from the live catalog                       */
/* ------------------------------------------------------------------ */
async function loadCatalog() {
  const data = await api('/api/v1/catalog');
  return data.products || [];
}

function planPrice(plan, cycle) {
  const pricing = Array.isArray(plan.pricing) ? plan.pricing : [];
  const pick = pricing.find((p) => p.billingCycle === cycle) || pricing[0];
  return pick || null;
}

function planCard(product, plan, featured = false) {
  const limits = plan.limits || {};
  const price = planPrice(plan, 'monthly') || planPrice(plan, 'annual');
  const annual = planPrice(plan, 'annual');
  const rows = [];
  if (limits.websites != null) rows.push(['Websites', limits.websites]);
  if (limits.storageGb != null) rows.push(['Storage', `${limits.storageGb} GB`]);
  if (limits.bandwidthGb != null) rows.push(['Bandwidth', limits.bandwidthGb >= 1000 ? 'Unmetered-class' : `${limits.bandwidthGb} GB`]);
  if (limits.email != null) rows.push(['Email accounts', limits.email]);
  if (limits.vcpu != null) rows.push(['vCPU', limits.vcpu]);
  if (limits.ramGb != null) rows.push(['RAM', `${limits.ramGb} GB`]);
  if (limits.ssdGb != null) rows.push(['NVMe/SSD', `${limits.ssdGb} GB`]);
  if (limits.transferGb != null) rows.push(['Traffic', `${limits.transferGb} GB`]);

  return `<article class="card plan-card${featured ? ' featured' : ''}">
    <div class="plan-body">
      <div class="flex-between"><h3 class="mb-0">${plan.name}</h3>${featured ? '<span class="badge">Popular</span>' : ''}</div>
      <p class="small muted">${product.name}</p>
      ${price
        ? `<div class="price">${money(price.price)}<small> /${price.billingCycle === 'annual' ? 'year' : 'month'}</small></div>
           ${annual ? `<p class="small muted mb-0">or ${money(annual.price)}/year billed annually</p>` : ''}`
        : '<div class="price"><small>Pricing requires configuration</small></div>'}
      <dl class="plan-meta">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <ul class="tick">${(plan.features || []).slice(0, 6).map((f) => `<li>${f}</li>`).join('')}</ul>
    </div>
    <a class="btn btn--primary" href="/app/catalog" data-plan-link data-plan="${plan.id || ''}">Choose Plan</a>
  </article>`;
}

function emptyPlans(productSlug) {
  return `<div class="notice notice--empty">
    <strong>Plans for this service are not configured yet.</strong>
    CloudHost247 publishes prices only when they are configured in the catalog — no placeholder numbers.
    ${productSlug ? '' : ''} <a href="/contact">Contact us</a> for availability and custom configurations.
  </div>`;
}

async function initPricing() {
  const mounts = document.querySelectorAll('[data-pricing]');
  if (!mounts.length) return;

  let products = [];
  try {
    products = await loadCatalog();
  } catch {
    for (const el of mounts) {
      el.innerHTML = '<div class="notice notice--empty">The catalog could not be loaded right now. Please try again shortly.</div>';
    }
    return;
  }

  for (const el of mounts) {
    const slug = el.getAttribute('data-product');
    const relevant = slug ? products.filter((p) => p.slug === slug && p.status === 'active') : products.filter((p) => p.status === 'active');

    if (!relevant.length) { el.innerHTML = emptyPlans(slug); continue; }

    const cards = [];
    for (const product of relevant) {
      const plans = (product.plans || []).filter((p) => p.status === 'active');
      if (!plans.length) continue;
      plans.forEach((plan, i) => cards.push(planCard(product, plan, i === 1 && plans.length > 1)));
    }

    el.innerHTML = cards.length
      ? `<div class="plan-grid">${cards.join('')}</div>`
      : emptyPlans(slug);
  }

  // "From" price badges on homepage service cards.
  for (const badge of document.querySelectorAll('[data-price-from]')) {
    const slug = badge.getAttribute('data-product');
    const product = products.find((p) => p.slug === slug);
    const plans = product ? (product.plans || []).filter((p) => p.status === 'active') : [];
    let min = null;
    for (const plan of plans) {
      const price = planPrice(plan, 'monthly') || planPrice(plan, 'annual');
      if (price && (min === null || price.price < min)) min = price.price;
    }
    if (min !== null) badge.innerHTML = `<p class="small muted mb-0">From <strong>${money(min)}/mo</strong></p>`;
  }
}

/* ------------------------------------------------------------------ */
/* Domain search + TLD pricing                                         */
/* ------------------------------------------------------------------ */
async function initDomainSearch() {
  const form = document.querySelector('[data-domain-form]');
  if (!form) return;

  const input = form.querySelector('input[name="domain"]');
  const result = document.querySelector('[data-domain-result]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = (input.value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!query) return;

    result.innerHTML = '<div class="row"><span>Searching…</span></div>';
    try {
      const data = await api('/api/v1/domain-services/search', {
        method: 'POST',
        body: JSON.stringify({ query }),
      });
      const rows = (data.results || []).map((r) => `
        <div class="row">
          <span><strong>${r.domain || r.name || ''}</strong> — ${r.available === false ? 'likely taken' : 'likely available'}</span>
          <a class="btn btn--sm btn--primary" href="/app/catalog">Register</a>
        </div>`).join('');
      const caveat = data.estimate
        ? '<p class="small muted mt-2" style="color:#9fb3d8">Availability shown is an estimate — live WHOIS/RDAP checks activate when a registrar connector is configured.</p>'
        : '';
      result.innerHTML = (rows || '<div class="row"><span>No suggestions returned for that name.</span></div>') + caveat;
    } catch {
      result.innerHTML = '<div class="row"><span>Search is unavailable right now — please try again.</span></div>';
    }
  });
}

async function initTlds() {
  const row = document.querySelector('[data-tld-row]');
  const table = document.querySelector('[data-tld-table] tbody');
  if (!row && !table) return;

  let extensions = [];
  try {
    ({ extensions } = await api('/api/v1/domain-services/extensions'));
  } catch {
    if (row) row.innerHTML = '<li>Extension pricing could not be loaded</li>';
    return;
  }

  if (!extensions.length) {
    if (row) row.innerHTML = '<li>Extension pricing is being configured — check back soon</li>';
    if (table) table.innerHTML = '<tr><td colspan="4">Extension pricing is not configured yet.</td></tr>';
    return;
  }

  const cents = (c) => money((c ?? 0) / 100);
  if (row) {
    row.innerHTML = extensions.slice(0, 7).map((e) => `<li><b>.${e.tld}</b> ${cents(e.registerPriceCents)}</li>`).join('');
  }
  if (table) {
    table.innerHTML = extensions.map((e) => `
      <tr>
        <td><strong>.${e.tld}</strong></td>
        <td class="num">${cents(e.registerPriceCents)}</td>
        <td class="num">${cents(e.renewPriceCents)}</td>
        <td><a class="btn btn--sm btn--secondary" href="/app/catalog">Register</a></td>
      </tr>`).join('');
  }
}

/* ------------------------------------------------------------------ */
/* Locations — only what the platform actually has configured          */
/* ------------------------------------------------------------------ */
async function initLocations() {
  const mounts = document.querySelectorAll('[data-locations]');
  if (!mounts.length) return;

  let data;
  try {
    data = await api('/api/v1/public/locations');
  } catch {
    for (const el of mounts) el.innerHTML = '<div class="notice notice--empty">Location data could not be loaded right now.</div>';
    return;
  }

  const locations = data.locations || [];
  for (const el of mounts) {
    if (!locations.length) {
      el.innerHTML = `<div class="card"><h3 class="mt-0">Locations are being configured</h3>
        <p class="muted mb-0">CloudHost247 publishes only locations that are actually configured on the platform — nothing invented. As regions are added to the infrastructure configuration they will appear here automatically.</p></div>`;
      continue;
    }
    if (el.getAttribute('data-variant') === 'table') {
      el.innerHTML = `<div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Region</th><th scope="col">Code</th><th scope="col">Country</th><th scope="col">Provider</th><th scope="col">Status</th></tr></thead>
        <tbody>${locations.map((l) => `<tr><td><strong>${l.name}</strong></td><td>${l.code}</td><td>${l.country || '—'}</td><td>${l.provider}</td><td><span class="badge badge--ok">Active</span></td></tr>`).join('')}</tbody>
      </table></div>`;
    } else {
      el.innerHTML = locations.length
        ? `<div class="grid grid--3">${locations.map((l) => `<div class="card" style="background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.16)"><h3 style="color:#fff">${l.name}</h3><p class="mb-0" style="color:#b9c8e6">${l.country || ''} · ${l.provider}</p></div>`).join('')}</div>`
        : '';
    }
  }
}

/* ------------------------------------------------------------------ */
/* Status page — live checks only                                      */
/* ------------------------------------------------------------------ */
async function initStatus() {
  const summary = document.querySelector('[data-status-summary]');
  const list = document.querySelector('[data-status-list]');
  if (!summary || !list) return;

  try {
    const data = await api('/api/v1/public/status');
    const dot = (s) => (s === 'operational' ? '<span class="dot dot--ok"></span>'
      : s === 'error' ? '<span class="dot dot--err"></span>' : '<span class="dot dot--none"></span>');
    const label = (s) => (s === 'operational' ? 'Operational' : s === 'error' ? 'Issue detected' : 'Not monitored yet');

    summary.innerHTML = data.allCheckedOk
      ? `<h2 class="mb-0" style="display:flex;align-items:center;gap:10px">${'<span class="dot dot--ok"></span>'} Verified checks passing</h2>
         <p class="muted mb-0">Checked live at ${new Date(data.checkedAt).toLocaleTimeString()}. ${data.monitored ? '' : 'External monitoring is not wired in yet, so this reflects verified checks only.'}</p>`
      : '<h2 class="mb-0"><span class="dot dot--err"></span> A verified check is failing</h2>';

    list.innerHTML = data.components.map((c) => `
      <div class="status-row"><span>${dot(c.status)}<strong>${c.name}</strong></span><span class="badge ${c.status === 'operational' ? 'badge--ok' : c.status === 'error' ? 'badge--warn' : 'badge--neutral'}">${label(c.status)}</span></div>`).join('');

    const note = document.querySelector('[data-status-note]');
    if (note) note.textContent = data.note || '';
  } catch {
    summary.innerHTML = '<div class="notice notice--empty">Status could not be loaded right now.</div>';
  }
}

/* ------------------------------------------------------------------ */
/* Contact — real configured details only                              */
/* ------------------------------------------------------------------ */
async function initContact() {
  const info = document.querySelector('[data-contact-info]');
  if (info) {
    try {
      const data = await api('/api/v1/public/site-info');
      const lines = [];
      if (data.supportEmail) lines.push(`Support: <a href="mailto:${data.supportEmail}">${data.supportEmail}</a>`);
      if (data.salesEmail) lines.push(`Sales: <a href="mailto:${data.salesEmail}">${data.salesEmail}</a>`);
      if (data.billingEmail) lines.push(`Billing: <a href="mailto:${data.billingEmail}">${data.billingEmail}</a>`);
      if (data.phone) lines.push(`Phone: ${data.phone}`);
      const address = [data.addressLine1, data.addressLine2, data.addressCity, data.addressRegion, data.addressCountry].filter(Boolean).join(', ');
      if (address) lines.push(`Address: ${address}`);
      info.innerHTML = lines.length
        ? `<strong>Published contact details</strong><br>${lines.join('<br>')}`
        : '<strong>Contact details are being published.</strong> Official contact channels appear here as soon as they are configured — until then, use the form and we will route it manually.';
    } catch {
      info.textContent = 'Contact details could not be loaded right now.';
    }
  }

  const form = document.querySelector('[data-contact-form]');
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const alertEl = form.querySelector('[data-form-alert]');
      const name = form.querySelector('[name="name"]').value.trim();
      const email = form.querySelector('[name="email"]').value.trim();
      const message = form.querySelector('[name="message"]').value.trim();
      if (!name || !email || !message) {
        alertEl.className = 'form-alert is-error';
        alertEl.textContent = 'Please fill in your name, email and message.';
        return;
      }
      api('/api/v1/public/site-info').then((data) => {
        const target = data.supportEmail || data.salesEmail;
        if (target) {
          const topic = form.querySelector('[name="topic"]').value;
          window.location.href = `mailto:${target}?subject=${encodeURIComponent(`[${topic}] Message from ${name}`)}&body=${encodeURIComponent(`${message}\n\n— ${name} (${email})`)}`;
          alertEl.className = 'form-alert is-success';
          alertEl.textContent = 'Opening your email client to deliver the message to our team.';
        } else {
          alertEl.className = 'form-alert is-error';
          alertEl.textContent = 'No support mailbox is configured yet, so this form cannot deliver. Please check back shortly or use the support ticket system in the client area.';
        }
      }).catch(() => {
        alertEl.className = 'form-alert is-error';
        alertEl.textContent = 'The contact service could not be reached — please try again.';
      });
    });
  }
}

/* ------------------------------------------------------------------ */
/* Knowledgebase & blog — rendered from the content API                */
/* ------------------------------------------------------------------ */
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function articleCard(a, base) {
  const date = a.publishedAt ? new Date(a.publishedAt).toISOString().slice(0, 10) : '';
  return `<article class="card kb-card">
    <span class="badge">${escHtml(a.category)}</span>
    <h3 style="margin-top:12px"><a href="${base}/${escHtml(a.slug)}" style="color:inherit">${escHtml(a.title)}</a></h3>
    <p>${escHtml(a.summary || '')}</p>
    <span class="count">${date ? `Updated ${date} · ` : ''}${escHtml(a.author)}</span>
  </article>`;
}

async function renderArticleList({ root, kind, state, searchBox }) {
  const params = new URLSearchParams({ kind });
  if (state.category) params.set('category', state.category);
  if (state.q) params.set('q', state.q);

  let articles = [];
  try {
    ({ articles } = await api(`/api/v1/public/articles?${params}`));
  } catch {
    root.innerHTML = '<div class="notice notice--empty">Content could not be loaded right now — please try again.</div>';
    return;
  }

  const categories = [...new Set(state.allCategories)].sort();
  const chips = ['<button type="button" class="btn btn--sm" data-cat="" aria-pressed="' + String(!state.category) + '">All</button>']
    .concat(categories.map((c) => `<button type="button" class="btn btn--sm ${state.category === c ? 'btn--primary' : 'btn--secondary'}" data-cat="${escHtml(c)}" aria-pressed="${String(state.category === c)}">${escHtml(c)}</button>`))
    .join(' ');

  const list = articles.length
    ? `<div class="kb-grid">${articles.map((a) => articleCard(a, kind === 'blog' ? '/blog' : '/kb')).join('')}</div>`
    : `<div class="notice">${state.q || state.category
        ? 'No articles match that search yet — try different words, or clear the filters.'
        : `Articles appear here as they are written and published by the CloudHost247 team. ${kind === 'kb' ? '' : 'No filler, ever.'}`}</div>`;

  root.innerHTML = `<div class="flex-between" style="margin-bottom:18px" role="toolbar" aria-label="Filter by category">${chips}</div>${list}`;

  root.querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.category = btn.getAttribute('data-cat') || '';
      renderArticleList({ root, kind, state, searchBox });
    });
  });
}

async function initArticles(kind) {
  const root = document.querySelector(kind === 'kb' ? '[data-kb-root]' : '[data-blog-root]');
  if (!root) return;

  // Load once without filters to know every category, then render with the active filter.
  let all = [];
  try {
    ({ articles: all } = await api(`/api/v1/public/articles?kind=${kind}`));
  } catch { /* list renderer will show the load-failure state */ }

  const form = document.querySelector(kind === 'kb' ? '[data-kb-search-form]' : '[data-blog-search-form]');

  // Support center search links here with ?q=... — honor it as the initial query.
  const initialQ = new URLSearchParams(window.location.search).get('q') || '';
  const state = { category: '', q: initialQ.trim(), allCategories: all.map((a) => a.category) };
  if (initialQ && form) form.querySelector('input[name="q"]').value = initialQ;

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      state.q = (form.querySelector('input[name="q"]').value || '').trim();
      renderArticleList({ root, kind, state });
    });
  }

  await renderArticleList({ root, kind, state });
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */
async function initMarketplace() {
  const GLYPHS = {
    doc: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
    database: '<ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13"/>',
    shield: '<path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6l7-3z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-8M21 20H3"/>',
    zap: '<path d="M13 2L5 13h6l-1 9 8-11h-6l1-9z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.7 2.6 4 5.6 4 9s-1.3 6.4-4 9c-2.7-2.6-4-5.6-4-9s1.3-6.4 4-9z"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    code: '<path d="m8 6-5 6 5 6M16 6l5 6-5 6"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8z"/>',
    gauge: '<path d="M4 14a8 8 0 1 1 16 0"/><path d="m12 14 4-4"/>',
  };
  const CAT_ICON = { cms: 'doc', 'e-commerce': 'card', database: 'database', security: 'shield', analytics: 'chart', ai: 'zap', media: 'play', networking: 'globe', monitoring: 'gauge', storage: 'database', finance: 'card', crm: 'users', communication: 'mail', 'developer-tools': 'code', 'project-management': 'check', productivity: 'doc', automation: 'zap', infrastructure: 'server', business: 'users', education: 'doc', documents: 'doc', 'home-automation': 'zap', 'system-administration': 'terminal' };
  const icon = (cat) => '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (GLYPHS[CAT_ICON[cat] || 'server']) + '</svg>';

  /* ---- Application marketplace (real catalog: GET /api/v1/marketplace/apps) ---- */
  const appsRoot = document.querySelector('[data-apps-root]');
  if (appsRoot) {
    const state = { q: '', category: '' };
    const form = document.querySelector('[data-apps-search]');
    const q = document.getElementById('app-q');
    if (form && q) {
      const params = new URLSearchParams(location.search);
      state.category = params.get('category') || '';
      q.value = params.get('q') || '';
      state.q = q.value;
      form.addEventListener('submit', (ev) => { ev.preventDefault(); state.q = q.value.trim(); render(); });
    }
    let cache = null; let categories = [];
    async function load() {
      if (!cache) {
        const [appsRes, catRes] = await Promise.all([api('/api/v1/marketplace/apps'), api('/api/v1/app-categories')]);
        categories = catRes.categories || [];
        cache = appsRes.apps || [];
      }
      return { apps: cache, categories };
    }
    async function render() {
      try {
        const { apps, categories: cats } = await load();
        const byId = new Map(cats.map((c) => [c.id || c.slug, c]));
        const withCat = apps.map((a) => ({ ...a, cat: byId.get(a.categoryId) || { slug: '', name: '' } }));
        const filtered = withCat.filter((a) => {
          const okCat = !state.category || (a.cat && a.cat.slug === state.category);
          const needle = state.q.toLowerCase();
          const okQ = !needle || a.name.toLowerCase().includes(needle) || (a.description || '').toLowerCase().includes(needle) || a.slug.includes(needle);
          return okCat && okQ;
        });
        const chipHtml = ['<button type="button" class="btn ' + (!state.category ? 'btn--primary' : 'btn--ghost') + '" style="padding:6px 12px;font-size:.85rem" data-cat="">All</button>']
          .concat(cats.map((c) => '<button type="button" class="btn ' + (state.category === c.slug ? 'btn--primary' : 'btn--ghost') + '" style="padding:6px 12px;font-size:.85rem" data-cat="' + escHtml(c.slug) + '">' + escHtml(c.name) + '</button>')).join(' ');
        if (!filtered.length) {
          appsRoot.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px">' + chipHtml + '</div><div class="notice notice--empty">No applications match that search. The catalog only contains apps our deployment pipeline can actually install.</div>';
        } else {
          const rows = filtered.map((a) => '<div class="card" style="display:flex;gap:12px;align-items:flex-start">'
            + '<div class="card-icon">' + icon(a.cat ? a.cat.slug : '') + '</div>'
            + '<div><h3 style="margin-top:0">' + escHtml(a.name) + (a.version ? ' <span class="hint">v' + escHtml(a.version) + '</span>' : '') + '</h3>'
            + '<p class="muted" style="margin:4px 0 8px">' + escHtml(a.description || '') + '</p>'
            + '<div class="flex-between"><span class="badge">' + escHtml(a.cat ? a.cat.name : 'App') + '</span>'
            + '<span class="hint">' + (a.free ? 'Free' : money(a.priceCents / 100)) + '</span></div></div></div>').join('');
          appsRoot.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px">' + chipHtml + '</div>'
            + '<p class="muted small">' + filtered.length + ' application' + (filtered.length === 1 ? '' : 's') + ' — all installable through the CloudHost247 deployment pipeline.</p>'
            + '<div class="grid grid--3">' + rows + '</div>'
            + '<p class="hint mt-3">Order any application with a VPS or dedicated server from the <a href="/app/catalog">catalog</a>; installation runs automatically after payment.</p>';
        }
        appsRoot.querySelectorAll('[data-cat]').forEach((btn) => btn.addEventListener('click', () => { state.category = btn.dataset.cat; render(); }));
      } catch {
        appsRoot.innerHTML = '<div class="notice notice--empty">The application catalog could not be loaded right now. Please try again shortly.</div>';
      }
    }
    render();
  }

  /* ---- Operating systems (real provisioning catalog, ACTIVE + orderable only) ---- */
  const osRoot = document.querySelector('[data-os-root]');
  if (osRoot) {
    try {
      const res = await api('/api/v1/operating-systems');
      const items = res.operatingSystems || [];
      const FAMILY = { linux: 'Linux', windows: 'Windows', specialized: 'Specialized' };
      osRoot.innerHTML = items.length
        ? '<div class="grid grid--3">' + items.map((os) => '<div class="card"><h3>' + escHtml(os.name) + '</h3><p class="muted">' + escHtml(FAMILY[os.family] || os.family || '') + '</p><p class="hint">' + os.orderableVersions + ' orderable version' + (os.orderableVersions === 1 ? '' : 's') + '</p></div>').join('') + '</div>'
        : '<div class="notice notice--empty"><strong>No operating systems are orderable yet.</strong><br/>OS versions publish here only after an availability rule and a live-verified provider image are in place — nothing is listed until it is genuinely provisionable. Ask about a specific distribution via <a href="/support">support</a>.</div>';
    } catch {
      osRoot.innerHTML = '<div class="notice notice--empty">The operating system catalog could not be loaded right now.</div>';
    }
  }

  /* ---- Control panels (ACTIVE panels only — never claimed otherwise) ---- */
  const panelsRoot = document.querySelector('[data-panels-root]');
  if (panelsRoot) {
    try {
      const res = await api('/api/v1/control-panels');
      const items = res.controlPanels || [];
      panelsRoot.innerHTML = items.length
        ? '<div class="grid grid--3">' + items.map((p) => '<div class="card"><h3>' + escHtml(p.name) + '</h3><p class="muted">' + escHtml(p.description || '') + '</p><p class="hint">'
          + (p.requiresLicense ? 'Commercial license' : 'No license required')
          + ((p.supportedOs || []).length ? ' · ' + p.supportedOs.map(escHtml).join(', ') : '') + '</p></div>').join('') + '</div>'
        : '<div class="notice notice--empty"><strong>No control panels are currently published.</strong><br/>We only list panels that are genuinely provisioned with our services. Every VPS still ships with full root access, so you can run your preferred panel yourself — or ask <a href="/support">support</a> what we can enable for you.</div>';
    } catch {
      panelsRoot.innerHTML = '<div class="notice notice--empty">The control panel list could not be loaded right now.</div>';
    }
  }

  /* ---- Homepage compact previews (counts + top picks, no full grids) ---- */
  const homeApps = document.querySelector('[data-home-apps]');
  if (homeApps) {
    try {
      const [appsRes, catRes] = await Promise.all([api('/api/v1/marketplace/apps'), api('/api/v1/app-categories')]);
      const cats = new Map((catRes.categories || []).map((c) => [c.id || c.slug, c]));
      const apps = (appsRes.apps || []).slice(0, 6);
      homeApps.innerHTML = apps.length
        ? '<div class="grid grid--3">' + apps.map((a) => {
          const cat = cats.get(a.categoryId) || { name: 'App' };
          return '<div class="card" style="display:flex;gap:12px;align-items:flex-start"><div class="card-icon">' + icon(cat.slug || '') + '</div>'
            + '<div><h3 style="margin-top:0">' + escHtml(a.name) + '</h3><p class="muted" style="margin:4px 0 6px">' + escHtml(a.description || '') + '</p>'
            + '<span class="badge">' + escHtml(cat.name) + '</span></div></div>';
        }).join('') + '</div><p class="hint mt-2">' + (appsRes.total || apps.length) + ' applications available in the marketplace.</p>'
        : '<div class="notice notice--empty">The application catalog is being prepared.</div>';
    } catch {
      homeApps.innerHTML = '<div class="notice notice--empty">The application preview could not be loaded right now.</div>';
    }
  }
  const homeOs = document.querySelector('[data-home-os-count]');
  if (homeOs) {
    try {
      const res = await api('/api/v1/operating-systems');
      const n = (res.operatingSystems || []).length;
      homeOs.innerHTML = n
        ? '<span class="badge badge--ok">' + n + ' operating system' + (n === 1 ? '' : 's') + ' orderable now</span>'
        : '<span class="hint">No OS images published yet — added only after provider-image verification.</span>';
    } catch {
      homeOs.innerHTML = '<span class="hint">Availability could not be loaded right now.</span>';
    }
  }
  const homePanels = document.querySelector('[data-home-panels-count]');
  if (homePanels) {
    try {
      const res = await api('/api/v1/control-panels');
      const n = (res.controlPanels || []).length;
      homePanels.innerHTML = n
        ? '<span class="badge badge--ok">' + n + ' control panel' + (n === 1 ? '' : 's') + ' configured for sale</span>'
        : '<span class="hint">No panels published yet — we only list what we actually provision.</span>';
    } catch {
      homePanels.innerHTML = '<span class="hint">Availability could not be loaded right now.</span>';
    }
  }

  /* ---- Developer docs (published KB articles tagged for developers) ---- */
  const docsRoot = document.querySelector('[data-dev-docs-root]');
  if (docsRoot) {
    try {
      const res = await api('/api/v1/public/articles?kind=kb');
      const arts = (res.articles || []).filter((a) => (a.category || '').toLowerCase().includes('dev')).slice(0, 6);
      docsRoot.innerHTML = arts.length
        ? '<div class="grid grid--3">' + arts.map((a) => '<div class="card"><h3><a href="/knowledgebase?article=' + encodeURIComponent(a.slug) + '">' + escHtml(a.title) + '</a></h3><p class="muted">' + escHtml(a.excerpt || a.summary || '') + '</p></div>').join('') + '</div>'
        : '<div class="notice notice--empty">Developer documentation is being written — check the <a href="/knowledgebase">Knowledgebase</a> for what is published.</div>';
    } catch {
      docsRoot.innerHTML = '<div class="notice notice--empty">Documentation could not be loaded right now.</div>';
    }
  }
}

function initYear() {
  for (const el of document.querySelectorAll('[data-year]')) {
    el.textContent = String(new Date().getFullYear());
  }
}

function init() {
  initNav();
  initAuthSlot();
  initYear();
  initDomainSearch();
  initTlds();
  initPricing();
  initLocations();
  initStatus();
  initContact();
  initArticles('kb');
  initArticles('blog');
  initMarketplace();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
