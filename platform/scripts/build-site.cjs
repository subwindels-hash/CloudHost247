#!/usr/bin/env node
/**
 * CloudHost247 public site builder.
 *
 * Generates every marketing page in platform/public/ from shared chrome
 * (head/header/footer) plus per-page bodies, so navigation, SEO metadata and
 * footer stay consistent across the whole site. Run after editing:
 *
 *   node scripts/build-site.cjs
 *
 * Honesty rules this build enforces:
 *  - No invented prices, locations, uptime or contact details in markup. Prices,
 *    TLD pricing, locations and status are fetched at runtime from the platform
 *    APIs by assets/js/site.js, with honest empty states.
 *  - Contact details render from /api/v1/public/site-info (operator-configured).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');

/* ------------------------------------------------------------------ */
/* Icons — consistent 24px stroke set                                  */
/* ------------------------------------------------------------------ */
const I = {
  server: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h2M11 16.5h2"/></svg>',
  cloud: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.9-8.9 6 6 0 0 1 11.6 1.6A4 4 0 0 1 17 18H7z"/></svg>',
  globe: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.7 2.6 4 5.6 4 9s-1.3 6.4-4 9c-2.7-2.6-4-5.6-4-9s1.3-6.4 4-9z"/></svg>',
  shield: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6l7-3z"/><path d="M9.5 12l2 2 3.5-4"/></svg>',
  mail: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
  cpu: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/></svg>',
  database: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/></svg>',
  headset: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="6" rx="2"/><rect x="17" y="13" width="4" height="6" rx="2"/><path d="M20 19a3 3 0 0 1-3 3h-3"/></svg>',
  chart: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 20V6M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3M20 16V6"/></svg>',
  key: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="14" r="4"/><path d="M11 11l8-8M17 5l2.5 2.5M14 8l2 2"/></svg>',
  layers: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5M3 17.5l9 5 9-5"/></svg>',
  zap: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
  users: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16.5 14.5c2.6.2 4.4 1.8 5 4.5"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>',
  doc: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6V3z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
  arrow: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  rocket: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15c-1.5-4.5.5-9.5 5-12 .8 4.8-1.5 9.5-5 12z"/><path d="M7 12c-1.8.2-3.4 1.2-4.5 3 1.8.3 3.3.1 4.5-.5M12 17c-.2 1.8-1.2 3.4-3 4.5-.3-1.8-.1-3.3.5-4.5M12 15c-2 .5-4 2-4.5 4.5C10 19 11.5 17 12 15z"/></svg>',
  lock: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 1 1 8 0v2.5M12 14.5v2"/></svg>',
  os: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><path d="M17 13.5v7M13.5 17h7"/></svg>',
};

/* ------------------------------------------------------------------ */
/* Shared chrome                                                       */
/* ------------------------------------------------------------------ */
function head({ title, description, canonical, jsonldExtra }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <link rel="canonical" href="${canonical}" />
  <meta name="theme-color" content="#0a1730" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="CloudHost247" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="/assets/img/og-image.jpg" />
  <meta name="twitter:image" content="/assets/img/og-image.jpg" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/assets/css/site.css" />
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"CloudHost247","url":"/","description":"Professional cloud hosting and digital infrastructure."}</script>
${jsonldExtra ? `  <script type="application/ld+json">${JSON.stringify(jsonldExtra)}</script>\n` : ''}</head>
<body>
  <a class="skip-link" href="#main">Skip to main content</a>
`;
}

function header(active) {
  const link = (href, label, key) =>
    `<a class="nav-link" href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`;
  const dd = (items) => `<ul class="dropdown">${items.map(([href, label, note]) =>
    `<li><a href="${href}">${label}${note ? `<span class="dd-note">${note}</span>` : ''}</a></li>`).join('')}</ul>`;

  return `  <header class="site-header" data-header>
    <div class="container nav-bar">
      <a class="brand" href="/" aria-label="CloudHost247 home">
        <span class="brand-mark" aria-hidden="true">C</span>
        <span>CloudHost247</span>
      </a>

      <button class="nav-toggle" data-nav-toggle aria-expanded="false" aria-controls="primary-nav" aria-label="Open menu">
        <span></span><span></span><span></span>
      </button>

      <li>
          ${link('/hosting/web-hosting', 'Hosting', 'hosting')}<span class="nav-caret" aria-hidden="true"></span>
          <div class="dropdown dropdown--mega"><div class="mega-grid">
            <div class="mega-col"><h4>Web Hosting</h4><ul>
              ${dd([['/hosting/web-hosting','Web Hosting','Fast shared hosting']])}
              ${dd([['/hosting/wordpress','WordPress Hosting','Optimized & managed']])}
              ${dd([['/hosting/web-hosting','Business Hosting','Hosting for companies']])}
              ${dd([['/hosting/web-hosting','Managed Hosting','We run it for you']])}
            </ul></div>
            <div class="mega-col"><h4>Cloud Hosting</h4><ul>
              ${dd([['/hosting/cloud','Cloud Hosting','Scalable infrastructure']])}
              ${dd([['/hosting/vps','Cloud VPS','Dedicated resources']])}
              ${dd([['/hosting/cloud','Public Cloud','Elastic capacity']])}
              ${dd([['/hosting/cloud','Private Cloud','Isolated environments']])}
            </ul></div>
            <div class="mega-col"><h4>Specialized</h4><ul>
              ${dd([['/business-email','Email Hosting','Professional mailboxes']])}
              ${dd([['/security#ssl','SSL Certificates','Encrypt your site']])}
              ${dd([['/migration','Website Migration','Guided transfer']])}
              ${dd([['/security#backups','Backup Services','Automated recovery']])}
            </ul></div>
          </div></div>
        </li>
        <li>
          ${link('/hosting/vps', 'Servers', 'servers')}<span class="nav-caret" aria-hidden="true"></span>
          <div class="dropdown dropdown--mega"><div class="mega-grid">
            <div class="mega-col"><h4>Servers</h4><ul>
              ${dd([['/hosting/vps','VPS Hosting','Virtual servers']])}
              ${dd([['/hosting/dedicated','Dedicated Servers','Single-tenant hardware']])}
              ${dd([['/hosting/enterprise','Enterprise Servers','Large-scale deployments']])}
              ${dd([['/hosting/game-servers','Game Servers','Low-latency play']])}
            </ul></div>
            <div class="mega-col"><h4>Platform</h4><ul>
              ${dd([['/operating-systems','Operating Systems','Verified OS catalog']])}
              ${dd([['/control-panels','Control Panels','Configured panels']])}
              ${dd([['/server-management','Server Management','Monitor & control']])}
              ${dd([['/infrastructure','Infrastructure','Network & locations']])}
            </ul></div>
          </div></div>
        </li>
        <li>
          ${link('/domains', 'Domains', 'domains')}<span class="nav-caret" aria-hidden="true"></span>
          ${dd([
            ['/domains#search', 'Search Domains', 'Find your name'],
            ['/domains#transfer', 'Transfer a Domain', 'Move your domains'],
            ['/domains#pricing', 'Domain Pricing', 'All extensions'],
            ['/domains/brokerage', 'Domain Brokerage', 'Premium acquisition'],
            ['/domains#renewals', 'Renewals', 'Grace periods explained'],
          ])}
        </li>
        <li>
          ${link('/applications', 'Applications', 'applications')}<span class="nav-caret" aria-hidden="true"></span>
          ${dd([
            ['/applications', 'App Marketplace', '52 deployable applications'],
            ['/applications?category=cms', 'CMS', 'WordPress, Ghost & more'],
            ['/applications?category=e-commerce', 'E-commerce', 'PrestaShop & stores'],
            ['/applications?category=database', 'Databases', 'MySQL, PostgreSQL, Redis'],
            ['/app-deployment', 'App Deployment', 'Pipeline & PaaS'],
          ])}
        </li>
        <li>
          ${link('/developers', 'Developers', 'developers')}<span class="nav-caret" aria-hidden="true"></span>
          ${dd([
            ['/developers', 'Developer Platform', 'Infrastructure for builders'],
            ['/app-deployment', 'Deployment & PaaS', 'Ship from Git to live'],
            ['/operating-systems', 'Operating Systems', 'Provisioned OS catalog'],
            ['/control-panels', 'Control Panels', 'What we actually offer'],
            ['/knowledgebase', 'Documentation', 'Guides & how-tos'],
          ])}
        </li>
        <li>
          ${link('/support', 'Resources', 'resources')}<span class="nav-caret" aria-hidden="true"></span>
          ${dd([
            ['/knowledgebase', 'Knowledgebase', 'Guides & how-tos'],
            ['/blog', 'Blog', 'News & insights'],
            ['/support', 'Help Center', 'Support center'],
            ['/status', 'Status', 'Live service status'],
            ['/offers', 'Offers', 'Live catalog pricing'],
          ])}
        </li>
        <li>
          ${link('/about', 'Company', 'company')}<span class="nav-caret" aria-hidden="true"></span>
          ${dd([
            ['/about', 'About CloudHost247', 'Who we are'],
            ['/about#why', 'Why CloudHost247', 'What sets us apart'],
            ['/infrastructure', 'Data Centers', 'Our infrastructure'],
            ['/contact', 'Contact', 'Talk to us'],
          ])}
        </li></ul>

      <div class="nav-actions" data-auth-slot>
        <a class="btn btn--ghost" href="/login" data-auth-login>Log in</a>
        <a class="btn btn--secondary" href="/app" data-auth-client>Client Area</a>
        <a class="btn btn--primary" href="/app/catalog">Get Started</a>
      </div>
    </div>
  </header>
`;
}

const FOOTER_COLS = [
  ['Products', [
    ['/hosting/web-hosting', 'Web Hosting'], ['/hosting/wordpress', 'WordPress Hosting'],
    ['/hosting/cloud', 'Cloud Hosting'], ['/hosting/vps', 'VPS Hosting'],
    ['/hosting/dedicated', 'Dedicated Servers'], ['/hosting/enterprise', 'Enterprise Servers'],
    ['/hosting/game-servers', 'Game Servers'], ['/business-email', 'Email Hosting'],
    ['/security#ssl', 'SSL Certificates'],
  ]],
  ['Cloud & Servers', [
    ['/hosting/cloud', 'Public Cloud'], ['/hosting/cloud#private-cloud', 'Private Cloud'],
    ['/server-management', 'Server Management'], ['/app-deployment', 'Application Deployment'],
    ['/app-deployment#paas', 'PaaS'], ['/operating-systems', 'Operating Systems'],
    ['/control-panels', 'Control Panels'],
  ]],
  ['Domains', [
    ['/domains#search', 'Domain Search'], ['/domains', 'Registration'],
    ['/domains#transfer', 'Transfer'], ['/domains#pricing', 'Pricing'],
    ['/domains/brokerage', 'Domain Brokerage'], ['/domains#renewals', 'Renewal'],
  ]],
  ['Developers', [
    ['/developers', 'Developer Platform'], ['/app-deployment', 'Deployment'],
    ['/applications', 'Applications'], ['/applications?category=database', 'Databases'],
    ['/knowledgebase', 'Documentation'],
  ]],
  ['Resources', [
    ['/support', 'Help Center'], ['/knowledgebase', 'Knowledgebase'],
    ['/faqs', 'FAQs'], ['/blog', 'Blog'], ['/status', 'Server Status'],
    ['/contact', 'Contact Support'],
  ]],
  ['Company', [
    ['/about', 'About CloudHost247'], ['/contact', 'Contact'],
    ['/offers', 'Offers'], ['/infrastructure', 'Infrastructure'],
  ]],
];

function footer() {
  return `  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <a class="brand" href="/" style="color:#fff"><span class="brand-mark" aria-hidden="true">C</span><span>CloudHost247</span></a>
          <p>Professional global hosting and infrastructure for websites, businesses, developers and growing digital companies.</p>
        </div>
        ${FOOTER_COLS.map(([title, links]) => `
        <nav aria-label="${title}">
          <h3>${title}</h3>
          <ul>${links.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('')}</ul>
        </nav>`).join('')}
        <nav aria-label="Legal">
          <h3>Legal</h3>
          <ul>
            <li><a href="/legal/terms">Terms of Service</a></li>
            <li><a href="/legal/privacy">Privacy Policy</a></li>
            <li><a href="/legal/cookies">Cookie Policy</a></li>
            <li><a href="/legal/acceptable-use">Acceptable Use</a></li>
            <li><a href="/legal/refund-policy">Refund Policy</a></li>
            <li><a href="/legal/sla">SLA</a></li>
          </ul>
        </nav>
      </div>
      <div class="footer-bottom">
        <span>&copy; <span data-year>${new Date().getFullYear()}</span> CloudHost247 Isc. — CloudHost247 · CH247. All rights reserved.</span>
        <nav aria-label="Legal summary">
          <a href="/legal/terms">Terms</a>
          <a href="/legal/privacy">Privacy</a>
          <a href="/legal/cookies">Cookies</a>
          <a href="/legal/acceptable-use">Acceptable Use</a>
          <a href="/legal/refund-policy">Refund Policy</a>
        </nav>
      </div>
    </div>
  </footer>
  <script type="module" src="/assets/js/site.js"></script>
</body>
</html>
`;
}

function page({ title, description, canonical, active, body, scripts, jsonldExtra }) {
  return head({ title, description, canonical, jsonldExtra }) + header(active) + `  <main id="main">\n${body}\n  </main>\n` + footer() + (scripts || '');
}

function grid3(items) {
  return `<div class="grid grid--3">${items.map(([title, text]) => `<div class="card"><h3>${title}</h3><p>${text}</p></div>`).join('')}</div>`;
}

const FAQ_ITEMS = [
  ['What happens after I place an order?', 'Your order generates an invoice; provisioning begins once payment is verified. For hosting, setup completes automatically; for servers, provisioning starts through the configured provider.'],
  ['Do you offer refunds?', 'Yes — see the Refund Policy for eligible services and time windows. Domain registrations, once submitted to a registry, are generally non-refundable.'],
  ['How do I get support?', 'Open a ticket from the client area — a human replies. Documentation lives in the Knowledgebase.'],
  ['Can I upgrade later?', 'Most plans can be upgraded in place; the difference is prorated where supported.'],
  ['Which payment methods are supported?', 'We accept the payment gateways enabled for your account and currency at checkout. Crypto payments are available through Blockonomics where enabled.'],
  ['Do you provide domain registration?', 'Yes — search, register and manage domains through the platform, with real registry pricing shown before checkout.'],
  ['Is my data safe?', 'Your account is protected with strong authentication, including passkeys. Server-side, credentials are encrypted at rest.'],
  ['Can you migrate my website?', 'We offer guided migration — open a ticket with the details of your current setup and we will plan the move with you.'],
];

function pageHead({ crumbs = [], title, lede }) {
  return `    <div class="page-head">
      <div class="container">
        ${crumbs.length ? `<nav aria-label="Breadcrumb"><ol class="crumbs">${crumbs.map(([href, label]) => `<li>${href ? `<a href="${href}">${label}</a>` : `<span aria-current="page">${label}</span>`}</li>`).join('')}</ol></nav>` : ''}
        <h1>${title}</h1>
        <p>${lede}</p>
      </div>
    </div>
`;
}

function ctaBand({ title, text, label, href }) {
  return `    <section class="section">
      <div class="container">
        <div class="cta-band">
          <div>
            <h2>${title}</h2>
            <p>${text}</p>
          </div>
          <a class="btn btn--secondary btn--lg" href="${href}">${label}</a>
        </div>
      </div>
    </section>
`;
}

/* Domain search block (homepage + domains page) */
function domainSearch(compact = false) {
  return `    <div class="domain-search"${compact ? '' : ' id="search"'}>
      <h2>Find Your Perfect Domain</h2>
      <p class="muted">Search availability across popular extensions. Results are estimates until a registrar connector is configured — you will always see that clearly.</p>
      <form data-domain-form novalidate>
        <label class="visually-hidden" for="domain-q">Domain name</label>
        <input id="domain-q" type="text" name="domain" inputmode="url" autocomplete="off" placeholder="yourdomain.com" required />
        <button class="btn btn--primary" type="submit">Search Domain</button>
      </form>
      <div class="domain-result" data-domain-result aria-live="polite"></div>
      <ul class="tld-row" data-tld-row aria-label="Popular extensions"></ul>
      <div class="domain-links">
        <a href="/domains">Domain Registration</a>
        <a href="/domains#transfer">Domain Transfer</a>
        <a href="/domains#pricing">Domain Pricing</a>
      </div>
    </div>
`;
}

/* Pricing mount — filled from /api/v1/catalog at runtime */
function pricingMount(product, { heading = 'Plans & Pricing', intro = '' } = {}) {
  return `    <section class="section" id="pricing">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">Pricing</span>
          <h2>${heading}</h2>
          ${intro ? `<p>${intro}</p>` : ''}
        </div>
        <div data-pricing data-product="${product || ''}"></div>
      </div>
    </section>
`;
}

/* ------------------------------------------------------------------ */
/* Page bodies                                                         */
/* ------------------------------------------------------------------ */
const home = `    <section class="hero">
      <div class="container">
        <div class="hero-inner">
          <span class="eyebrow" style="color:#7fb2ff">Professional Cloud Hosting &amp; Digital Infrastructure</span>
          <h1>Power Your Digital World With CloudHost247</h1>
          <p class="lede">Fast, secure and scalable hosting infrastructure built for websites, businesses, developers and growing digital companies worldwide.</p>
          <div class="hero-ctas">
            <a class="btn btn--primary btn--lg" href="/app/catalog">Get Started</a>
            <a class="btn btn--navy-outline btn--lg" href="/hosting">Explore Hosting</a>
          </div>
        </div>
        <div class="hero-visual" role="img" aria-label="Illustration of CloudHost247 infrastructure nodes and network health">
          <div class="hv-node"><b><span class="hv-dot"></span>Compute</b>Virtual &amp; dedicated servers<span class="hv-bar"><i style="width:72%"></i></span></div>
          <div class="hv-node"><b><span class="hv-dot"></span>Network</b>Global-ready connectivity<span class="hv-bar"><i style="width:58%"></i></span></div>
          <div class="hv-node"><b><span class="hv-dot"></span>Storage</b>NVMe-backed persistence<span class="hv-bar"><i style="width:64%"></i></span></div>
          <div class="hv-node"><b><span class="hv-dot"></span>Protection</b>Security-first platform<span class="hv-bar"><i style="width:81%"></i></span></div>
        </div>
      </div>
      <div class="trust-strip">
        <div class="container">
          <div class="trust-item">${I.zap} High-performance infrastructure</div>
          <div class="trust-item">${I.chart} 24/7 monitoring</div>
          <div class="trust-item">${I.shield} Enterprise-grade security</div>
          <div class="trust-item">${I.globe} Global-ready infrastructure</div>
          <div class="trust-item">${I.database} Automated backups</div>
          <div class="trust-item">${I.headset} Expert support</div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        ${domainSearch(true)}
      </div>
    </section>

    <section class="section section--soft" id="services">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">Hosting Services</span>
          <h2>One platform for every workload</h2>
          <p>From a first website to demanding production infrastructure — each service is built on the same professional platform.</p>
        </div>
        <div class="grid grid--3">
          <article class="card">
            <div class="card-icon">${I.globe}</div>
            <h3>Web Hosting</h3>
            <p>Reliable hosting for personal websites, businesses and professional websites.</p>
            <ul class="tick"><li>NVMe storage</li><li>Free SSL included</li><li>Daily backups</li></ul>
            <span data-price-from data-product="web-hosting"></span>
            <a class="btn btn--ghost" href="/hosting/web-hosting">Explore Web Hosting ${I.arrow}</a>
          </article>
          <article class="card">
            <div class="card-icon">${I.doc}</div>
            <h3>WordPress Hosting</h3>
            <p>Optimized hosting for WordPress websites with security, performance and automated management.</p>
            <ul class="tick"><li>WordPress-tuned stack</li><li>Automated updates</li><li>Staging-friendly</li></ul>
            <a class="btn btn--ghost" href="/hosting/wordpress">Learn More ${I.arrow}</a>
          </article>
          <article class="card">
            <div class="card-icon">${I.cloud}</div>
            <h3>Cloud Hosting</h3>
            <p>Scalable infrastructure designed for growing applications and websites.</p>
            <ul class="tick"><li>Elastic resources</li><li>API-driven control</li><li>Usage-based growth</li></ul>
            <a class="btn btn--ghost" href="/hosting/cloud">Learn More ${I.arrow}</a>
          </article>
          <article class="card">
            <div class="card-icon">${I.cpu}</div>
            <h3>VPS Hosting</h3>
            <p>Dedicated virtual resources with greater control, performance and flexibility.</p>
            <ul class="tick"><li>Full root access</li><li>Dedicated vCPU &amp; RAM</li><li>Choice of OS</li></ul>
            <span data-price-from data-product="vps"></span>
            <a class="btn btn--ghost" href="/hosting/vps">Learn More ${I.arrow}</a>
          </article>
          <article class="card">
            <div class="card-icon">${I.server}</div>
            <h3>Dedicated Servers</h3>
            <p>High-performance physical infrastructure for demanding workloads.</p>
            <ul class="tick"><li>Single-tenant hardware</li><li>Configurable specs</li><li>Managed options</li></ul>
            <a class="btn btn--ghost" href="/hosting/dedicated">Learn More ${I.arrow}</a>
          </article>
          <article class="card">
            <div class="card-icon">${I.users}</div>
            <h3>Reseller Hosting</h3>
            <p>Build and manage your own hosting business with professional reseller infrastructure.</p>
            <ul class="tick"><li>Client accounts</li><li>White-label ready</li><li>Pooled resources</li></ul>
            <a class="btn btn--ghost" href="/hosting/reseller">Learn More ${I.arrow}</a>
          </article>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="split">
          <div>
            <span class="eyebrow">Why CloudHost247</span>
            <h2>Infrastructure you can build a business on</h2>
            <p class="muted">CloudHost247 is built for companies that take their online presence seriously: performance, security and honest operations come first — and every claim on this site is backed by the platform's actual configuration, not marketing fiction.</p>
            <div class="mt-3">
              <a class="btn btn--primary" href="/about#why">Why CloudHost247</a>
              <a class="btn btn--ghost" href="/infrastructure">See the infrastructure</a>
            </div>
          </div>
          <div class="grid grid--2">
            <div class="card"><div class="card-icon">${I.zap}</div><h3>Performance</h3><p>High-performance hosting infrastructure designed for fast websites and applications.</p></div>
            <div class="card"><div class="card-icon">${I.shield}</div><h3>Security</h3><p>Security-first infrastructure, monitoring and account protection.</p></div>
            <div class="card"><div class="card-icon">${I.chart}</div><h3>Reliability</h3><p>Infrastructure designed for stable, dependable service.</p></div>
            <div class="card"><div class="card-icon">${I.layers}</div><h3>Scalability</h3><p>Upgrade resources as your website or business grows.</p></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section section--navy">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">Global Infrastructure</span>
          <h2>Global-ready, honestly reported</h2>
          <p style="color:#b9c8e6">The locations below are the regions actually configured on this platform — nothing invented. As CloudHost247 grows, this list grows with it.</p>
        </div>
        <div data-locations></div>
      </div>
    </section>

    <section class="section" id="applications">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">Application Marketplace</span>
          <h2>Deploy real applications in minutes</h2>
          <p>Every app below lives in our actual deployment catalog — manifest-verified and installed by the same pipeline that powers the client area. Nothing is listed we cannot install.</p>
        </div>
        <div data-home-apps></div>
        <p class="hint mt-3"><a href="/applications">Browse the full marketplace ${I.arrow}</a></p>
      </div>
    </section>

    <section class="section section--soft" id="platform">
      <div class="container">
        <div class="split">
          <div>
            <span class="eyebrow">Deployment Platform</span>
            <h2>From order to running application</h2>
            <p class="muted">Choose an application, order a server, and the platform takes it from there: isolated containers, payment-gated provisioning, encrypted credentials, domain verification and a complete event history.</p>
            <div class="mt-3"><a class="btn btn--primary" href="/app-deployment">How deployment works ${I.arrow}</a></div>
          </div>
          <div class="grid grid--2">
            <div class="card"><div class="card-icon">${I.rocket}</div><h3>One-click installs</h3><p>Order, pay, and the pipeline installs and configures your app automatically.</p></div>
            <div class="card"><div class="card-icon">${I.lock}</div><h3>Encrypted by default</h3><p>Credentials are encrypted at rest and shown exactly once.</p></div>
            <div class="card"><div class="card-icon">${I.globe}</div><h3>Domains &amp; SSL</h3><p>Attach verified domains with DNS checks and SSL.</p></div>
            <div class="card"><div class="card-icon">${I.doc}</div><h3>Full history</h3><p>Every install, update, backup and restore is logged.</p></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="servers-platform">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">Server Platform</span>
          <h2>Operating systems, panels and management — honestly reported</h2>
          <p>We only publish what is genuinely provisioned: OS versions with verified provider images, control panels configured for sale, and the management features live today.</p>
        </div>
        <div class="grid grid--2">
          <div class="card">
            <div class="card-icon">${I.os}</div><h3>Operating Systems</h3>
            <p class="muted">Only combinations that pass plan, availability and live-image verification are shown.</p>
            <p class="mt-2" data-home-os-count><span class="hint">Checking availability…</span></p>
            <a class="btn btn--ghost mt-2" href="/operating-systems">View the OS catalog ${I.arrow}</a>
          </div>
          <div class="card">
            <div class="card-icon">${I.layers}</div><h3>Control Panels</h3>
            <p class="muted">Listed only when genuinely provisioned with a service — never claimed otherwise.</p>
            <p class="mt-2" data-home-panels-count><span class="hint">Checking availability…</span></p>
            <a class="btn btn--ghost mt-2" href="/control-panels">View control panels ${I.arrow}</a>
          </div>
        </div>
        <p class="hint mt-3">Manage it all — health, metrics, snapshots and lifecycle — from <a href="/server-management">Server Management</a>.</p>
      </div>
    </section>

    <section class="section section--soft" id="developers-home">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">Developers</span>
          <h2>Infrastructure built for builders</h2>
          <p>Root access, encrypted environment credentials, domain verification and a full deployment event log — a platform that gets out of your way.</p>
        </div>
        <div data-dev-docs-root></div>
        <p class="hint mt-3"><a href="/developers">Explore the developer platform ${I.arrow}</a></p>
      </div>
    </section>

${ctaBand({ title: 'Ready to get started?', text: 'Choose a plan, check out securely and manage everything from one professional client area.', label: 'Get Started', href: '/app/catalog' })}`;

/* Service pages share a builder */
function servicePage({ key, crumbs, title, lede, intro, features, specs, product, extraSections = '' }) {
  const body = pageHead({ crumbs, title, lede }) + `
    <section class="section">
      <div class="container">
        <div class="split">
          <div>
            <span class="eyebrow">Overview</span>
            <h2>${intro.heading}</h2>
            <p class="muted">${intro.text}</p>
          </div>
          <div class="card">
            <h3>Key features</h3>
            <ul class="tick">${features.map((f) => `<li>${f}</li>`).join('')}</ul>
          </div>
        </div>
      </div>
    </section>
${specs ? `    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Specifications</span><h2>What you get</h2></div>
        <div class="grid grid--3">${specs.map(([icon, t, d]) => `<div class="card"><div class="card-icon">${icon}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}</div>
      </div>
    </section>
` : ''}${extraSections}${pricingMount(product)}
${ctaBand({ title: `Start with ${title.toLowerCase()}`, text: 'Configure your plan and check out securely — provisioning begins as soon as payment settles.', label: 'Choose a Plan', href: '/app/catalog' })}`;
  return { body, active: 'hosting' };
}

const pages = [];

/* ---- Home ---- */
pages.push({
  file: 'index.html',
  html: page({
    title: 'CloudHost247 — Professional Cloud Hosting & Digital Infrastructure',
    description: 'Fast, secure and scalable hosting infrastructure: web hosting, cloud, VPS, dedicated servers, domains, business email and security — built for businesses and developers worldwide.',
    canonical: '/', active: 'home', body: home,
  }),
});

/* ---- Hosting overview ---- */
pages.push({
  file: 'hosting.html',
  html: page({
    title: 'Hosting Services — Web, Cloud, VPS, Dedicated & Reseller | CloudHost247',
    description: 'Compare CloudHost247 hosting services: web hosting, WordPress, cloud, VPS, dedicated servers and reseller hosting — with real configured pricing.',
    canonical: '/hosting', active: 'hosting',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Hosting']],
      title: 'Hosting Built for Serious Work',
      lede: 'Six hosting services, one professional platform. Prices shown are pulled live from the CloudHost247 catalog — no placeholders.',
    }) + `
    <section class="section">
      <div class="container">
        <div data-pricing data-product=""></div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Services</span><h2>Every workload covered</h2></div>
        <div class="grid grid--3">
          <article class="card"><div class="card-icon">${I.globe}</div><h3>Web Hosting</h3><p>Reliable hosting for personal websites, businesses and professional websites.</p><a class="btn btn--ghost" href="/hosting/web-hosting">Explore Web Hosting ${I.arrow}</a></article>
          <article class="card"><div class="card-icon">${I.doc}</div><h3>WordPress Hosting</h3><p>Optimized hosting for WordPress with security, performance and automated management.</p><a class="btn btn--ghost" href="/hosting/wordpress">Learn More ${I.arrow}</a></article>
          <article class="card"><div class="card-icon">${I.cloud}</div><h3>Cloud Hosting</h3><p>Scalable infrastructure designed for growing applications and websites.</p><a class="btn btn--ghost" href="/hosting/cloud">Learn More ${I.arrow}</a></article>
          <article class="card"><div class="card-icon">${I.cpu}</div><h3>VPS Hosting</h3><p>Dedicated virtual resources with greater control, performance and flexibility.</p><a class="btn btn--ghost" href="/hosting/vps">Learn More ${I.arrow}</a></article>
          <article class="card"><div class="card-icon">${I.server}</div><h3>Dedicated Servers</h3><p>High-performance physical infrastructure for demanding workloads.</p><a class="btn btn--ghost" href="/hosting/dedicated">Learn More ${I.arrow}</a></article>
          <article class="card"><div class="card-icon">${I.users}</div><h3>Reseller Hosting</h3><p>Build and manage your own hosting business with professional reseller infrastructure.</p><a class="btn btn--ghost" href="/hosting/reseller">Learn More ${I.arrow}</a></article>
        </div>
      </div>
    </section>
${ctaBand({ title: 'Not sure which service fits?', text: 'Talk to us about your workload — we will point you at the right plan, not the most expensive one.', label: 'Contact Sales', href: '/contact' })}`,
  }),
});

/* ---- Individual hosting pages ---- */
pages.push({
  file: path.join('hosting', 'web-hosting.html'),
  html: page({
    title: 'Web Hosting — Fast, Secure Shared Hosting | CloudHost247',
    description: 'Reliable web hosting with NVMe storage, free SSL and daily backups. Real plans and pricing, configured in the CloudHost247 catalog.',
    canonical: '/hosting/web-hosting', active: 'hosting',
    body: servicePage({
      crumbs: [['/', 'Home'], ['/hosting', 'Hosting'], [null, 'Web Hosting']],
      title: 'Web Hosting',
      lede: 'Reliable hosting for personal websites, businesses and professional websites.',
      intro: { heading: 'Hosting that stays out of your way', text: 'Web Hosting on CloudHost247 is built for speed and simplicity: NVMe storage, free SSL on every plan and automated backups, with a control panel your team already knows how to use.' },
      features: ['NVMe storage', 'Free SSL certificates', 'Daily backups', 'Email accounts included', 'One-click installers', 'Control panel included'],
      specs: [
        [I.zap, 'Performance', 'NVMe-backed storage and modern PHP runtimes keep pages fast.'],
        [I.shield, 'Security', 'Free SSL, account isolation and security-first defaults.'],
        [I.database, 'Backups', 'Automated backups with restore available from your client area.'],
      ],
      product: 'web-hosting',
    }).body,
  }),
});

pages.push({
  file: path.join('hosting', 'wordpress.html'),
  html: page({
    title: 'WordPress Hosting — Optimized & Managed | CloudHost247',
    description: 'Optimized WordPress hosting with security, performance and automated management on the CloudHost247 platform.',
    canonical: '/hosting/wordpress', active: 'hosting',
    body: servicePage({
      crumbs: [['/', 'Home'], ['/hosting', 'Hosting'], [null, 'WordPress Hosting']],
      title: 'WordPress Hosting',
      lede: 'Optimized hosting for WordPress websites with security, performance and automated management.',
      intro: { heading: 'WordPress, without the maintenance burden', text: 'A WordPress-tuned stack with automated core management, hardened defaults and performance caching — so you publish content while the platform handles the plumbing.' },
      features: ['WordPress-tuned stack', 'Automated core management', 'Performance caching', 'Hardened security defaults', 'Free SSL', 'Daily backups'],
      product: 'wordpress',
    }).body,
  }),
});

pages.push({
  file: path.join('hosting', 'cloud.html'),
  html: page({
    title: 'Cloud Hosting — Scalable Infrastructure | CloudHost247',
    description: 'Scalable cloud hosting designed for growing applications and websites, with API-driven control on the CloudHost247 platform.',
    canonical: '/hosting/cloud', active: 'hosting',
    body: servicePage({
      crumbs: [['/', 'Home'], ['/hosting', 'Hosting'], [null, 'Cloud Hosting']],
      title: 'Cloud Hosting',
      lede: 'Scalable infrastructure designed for growing applications and websites.',
      intro: { heading: 'Grow without re-platforming', text: 'Cloud Hosting gives your applications elastic headroom: scale resources as traffic grows, control everything through the platform API, and keep one bill for the whole stack.' },
      features: ['Elastic resource scaling', 'API-driven control', 'Snapshot-based recovery', 'Usage transparency', 'Free SSL', 'Monitoring included'],
      specs: [
        [I.layers, 'Elasticity', 'Scale compute and storage as demand changes — no migration project required.'],
        [I.chart, 'Visibility', 'Resource usage is tracked in your client area, so growth never surprises you.'],
        [I.key, 'Control', 'Manage instances through the dashboard or the platform API.'],
      ],
      product: 'cloud',
      extraSections: `
    <section class="section section--soft" id="private-cloud">
      <div class="container">
        <div class="split">
          <div>
            <span class="eyebrow">Private Cloud</span>
            <h2>Dedicated, isolated cloud capacity</h2>
            <p class="muted">For workloads that must not share hardware, we provision cloud capacity isolated to your account — dedicated compute and storage, dedicated networking, and the same API-driven control as our public cloud. Scope and pricing are confirmed per deployment rather than published as a generic package.</p>
            <a class="btn btn--primary" href="/contact">Discuss a private deployment</a>
          </div>
          <div class="grid grid--2">
            <div class="card"><div class="card-icon">${I.shield}</div><h3>Isolation</h3><p>Single-tenant capacity so noisy neighbours are never a factor.</p></div>
            <div class="card"><div class="card-icon">${I.layers}</div><h3>Same control plane</h3><p>Dashboard and API management identical to public cloud.</p></div>
          </div>
        </div>
      </div>
    </section>`,
    }).body,
  }),
});

/* ---- VPS page (premium, spec §7) ---- */
pages.push({
  file: path.join('hosting', 'vps.html'),
  html: page({
    title: 'VPS Hosting — Your Infrastructure, Your Control | CloudHost247',
    description: 'Powerful VPS hosting with dedicated vCPU, RAM and NVMe storage, full root access, choice of OS and live-configured plans.',
    canonical: '/hosting/vps', active: 'hosting',
    body: pageHead({
      crumbs: [['/', 'Home'], ['/hosting', 'Hosting'], [null, 'VPS']],
      title: 'Powerful VPS Hosting. Your Infrastructure, Your Control.',
      lede: 'Dedicated virtual resources with full root access — configured in the CloudHost247 catalog and provisioned through the platform.',
    }) + `
    <section class="section">
      <div class="container">
        <div class="grid grid--4">
          <div class="card"><div class="card-icon">${I.cpu}</div><h3>Dedicated resources</h3><p>Guaranteed vCPU and RAM — not oversubscribed shared capacity.</p></div>
          <div class="card"><div class="card-icon">${I.zap}</div><h3>NVMe / SSD storage</h3><p>Fast block storage for databases and application state.</p></div>
          <div class="card"><div class="card-icon">${I.globe}</div><h3>IPv4 &amp; IPv6</h3><p>Public addressing for services, mail and APIs.</p></div>
          <div class="card"><div class="card-icon">${I.key}</div><h3>Full root access</h3><p>Install, configure and automate anything — it is your server.</p></div>
          <div class="card"><div class="card-icon">${I.layers}</div><h3>Choice of OS</h3><p>Provision from the operating systems configured on the platform.</p></div>
          <div class="card"><div class="card-icon">${I.chart}</div><h3>Monitoring</h3><p>Server health visible from your client area.</p></div>
          <div class="card"><div class="card-icon">${I.database}</div><h3>Backup options</h3><p>Snapshots and off-server backup options where configured.</p></div>
          <div class="card"><div class="card-icon">${I.shield}</div><h3>Security</h3><p>Firewall controls and security-first defaults on the platform.</p></div>
        </div>
        <div class="notice mt-3">Server locations, deployment options and operating systems shown at order time come from the platform's actual infrastructure configuration — nothing is invented.</div>
      </div>
    </section>
${pricingMount('vps', { heading: 'VPS Plans', intro: 'Plans and prices are loaded from the CloudHost247 catalog. If a plan you need is not listed, contact us — custom configurations are available.' })}
${ctaBand({ title: 'Need a custom VPS configuration?', text: 'Tell us the CPU, RAM and storage you need and we will configure it.', label: 'Configure Server', href: '/contact' })}`,
  }),
});

/* ---- Dedicated page (§8) ---- */
pages.push({
  file: path.join('hosting', 'dedicated.html'),
  html: page({
    title: 'Dedicated Servers — For Serious Workloads | CloudHost247',
    description: 'Dedicated servers with single-tenant hardware, configurable CPU/RAM/storage, DDoS-conscious network design and managed options.',
    canonical: '/hosting/dedicated', active: 'hosting',
    body: pageHead({
      crumbs: [['/', 'Home'], ['/hosting', 'Hosting'], [null, 'Dedicated Servers']],
      title: 'Dedicated Servers for Serious Workloads',
      lede: 'Single-tenant physical infrastructure with configurable specifications and professional management options.',
    }) + `
    <section class="section">
      <div class="container">
        <div class="grid grid--3">
          <div class="card"><div class="card-icon">${I.cpu}</div><h3>CPU</h3><p>Modern server-class processors sized to your workload.</p></div>
          <div class="card"><div class="card-icon">${I.layers}</div><h3>RAM</h3><p>ECC memory configurations for stability under load.</p></div>
          <div class="card"><div class="card-icon">${I.database}</div><h3>Storage</h3><p>NVMe, SSD or hybrid configurations with RAID options.</p></div>
          <div class="card"><div class="card-icon">${I.globe}</div><h3>Network</h3><p>High-throughput uplinks with IPv4/IPv6 addressing.</p></div>
          <div class="card"><div class="card-icon">${I.shield}</div><h3>DDoS protection</h3><p>Network-level protection according to the data center's capabilities.</p></div>
          <div class="card"><div class="card-icon">${I.headset}</div><h3>Server management</h3><p>Self-managed or assisted management — your choice.</p></div>
        </div>
        <div class="notice mt-3">Data center locations and hardware configurations are presented from the platform's actual infrastructure configuration at order time.</div>
      </div>
    </section>
${pricingMount('dedicated', { heading: 'Dedicated Server Plans' })}
${ctaBand({ title: 'Configure your server', text: 'Specify CPU, RAM, storage and network — we will prepare a quote.', label: 'Order Now', href: '/contact' })}`,
  }),
});

pages.push({
  file: path.join('hosting', 'reseller.html'),
  html: page({
    title: 'Reseller Hosting — Build Your Hosting Business | CloudHost247',
    description: 'Reseller hosting with professional infrastructure: create client accounts, allocate resources and grow your hosting business.',
    canonical: '/hosting/reseller', active: 'hosting',
    body: servicePage({
      crumbs: [['/', 'Home'], ['/hosting', 'Hosting'], [null, 'Reseller Hosting']],
      title: 'Reseller Hosting',
      lede: 'Build and manage your own hosting business with professional reseller infrastructure.',
      intro: { heading: 'Your hosting brand, on serious infrastructure', text: 'Reseller Hosting gives you pooled resources to divide into client accounts, with the control panels and tooling to run a hosting business professionally.' },
      features: ['Create client accounts', 'Allocated resource pools', 'White-label ready', 'Control panel tooling', 'Free SSL for clients', 'Billing-friendly structure'],
      product: 'reseller',
    }).body,
  }),
});

/* ---- Pricing overview (§6) ---- */
pages.push({
  file: 'pricing.html',
  html: page({
    title: 'Pricing — Real Plans, Real Prices | CloudHost247',
    description: 'Complete CloudHost247 pricing loaded live from the platform catalog: plan names, billing cycles, limits and features. No placeholder prices.',
    canonical: '/pricing', active: 'hosting',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Pricing']],
      title: 'Simple, Honest Pricing',
      lede: 'Every plan below is loaded live from the CloudHost247 catalog. Where a service has no published plans yet, we say so instead of inventing numbers.',
    }) + `
    <section class="section">
      <div class="container">
        <div data-pricing data-product=""></div>
        <p class="muted small mt-3">Prices shown are for new orders in USD. Renewal pricing, where different, is shown per plan when configured. Taxes are calculated at checkout where applicable.</p>
      </div>
    </section>
${ctaBand({ title: 'Questions about pricing?', text: 'Our team will help you pick the right plan — and tell you when a cheaper one fits.', label: 'Contact Sales', href: '/contact' })}`,
  }),
});

/* ---- Domains (§9) ---- */
pages.push({
  file: 'domains.html',
  html: page({
    title: 'Domains — Search, Register, Transfer | CloudHost247',
    description: 'Register and manage domains with CloudHost247: availability search, extension pricing, transfers, renewals and DNS management.',
    canonical: '/domains', active: 'domains',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Domains']],
      title: 'Your Domain, Properly Managed',
      lede: 'Search for your domain, see real extension pricing, and manage everything — DNS, renewals and transfers — from one client area.',
    }) + `
    <section class="section">
      <div class="container">
        ${domainSearch()}
      </div>
    </section>
    <section class="section section--soft" id="pricing">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Extension Pricing</span><h2>Popular extensions</h2><p>Prices below are loaded from the platform's configured extension pricing. Renewal prices are shown where they differ.</p></div>
        <div class="table-wrap"><table class="table" data-tld-table>
          <thead><tr><th scope="col">Extension</th><th scope="col">Register</th><th scope="col">Renewal</th><th scope="col"><span class="visually-hidden">Action</span></th></tr></thead>
          <tbody></tbody>
        </table></div>
      </div>
    </section>
    <section class="section" id="transfer">
      <div class="container">
        <div class="split">
          <div>
            <span class="eyebrow">Transfers &amp; Management</span>
            <h2>Everything a domain needs</h2>
            <p class="muted">Registration is only the beginning. Manage DNS records, renewals and transfers from the CloudHost247 client area — and keep WHOIS privacy where the registry allows it.</p>
            <a class="btn btn--primary" href="/app">Manage domains in the client area</a>
          </div>
          <div class="grid grid--2">
            <div class="card"><div class="card-icon">${I.globe}</div><h3>Registration</h3><p>Register new domains across configured extensions with transparent pricing.</p></div>
            <div class="card"><div class="card-icon">${I.layers}</div><h3>DNS management</h3><p>Full record control with zone management in the platform.</p></div>
            <div class="card"><div class="card-icon">${I.database}</div><h3>Renewals</h3><p>Auto-renew options and clear renewal pricing — no surprise expiries.</p></div>
            <div class="card"><div class="card-icon">${I.key}</div><h3>Transfers</h3><p>Bring existing domains to CloudHost247 with a guided transfer flow.</p></div>
          </div>
        </div>
      </div>
    </section>
    <section class="section section--soft" id="renewals">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Renewals</span><h2>Never lose a domain to an oversight</h2></div>
        <div class="grid grid--3">
          <div class="card"><h3>Auto-renew</h3><p>Enable auto-renew per domain in the client area; renewals use your configured payment method before expiry.</p></div>
          <div class="card"><h3>Grace periods</h3><p>If a renewal fails, registries apply grace and redemption windows before deletion. Full lifecycle documented in the knowledgebase.</p></div>
          <div class="card"><h3>Reminder emails</h3><p>Renewal reminders are sent ahead of expiry so you always have time to act manually.</p></div>
        </div>
        <p class="hint" style="margin-top:16px">Premium names that are already registered can be acquired through our <a href="/domains/brokerage">Domain Brokerage service</a>.</p>
      </div>
    </section>
${ctaBand({ title: 'Found the perfect name?', text: 'Register it before someone else does — checkout takes minutes.', label: 'Search Domains', href: '#search' })}`,
  }),
});

/* ---- Business email (§10) ---- */
pages.push({
  file: 'business-email.html',
  html: page({
    title: 'Business Email — Professional Email for Your Business | CloudHost247',
    description: 'Professional business email on your own domain: mailboxes, spam protection, webmail, mobile access and IMAP/SMTP.',
    canonical: '/business-email', active: 'business',
    body: servicePage({
      crumbs: [['/', 'Home'], [null, 'Business Email']],
      title: 'Professional Email for Your Business',
      lede: 'Your domain, your brand — email that looks as professional as the business behind it.',
      intro: { heading: 'Email your customers can trust', text: 'Business Email on CloudHost247 gives every teammate a mailbox on your domain, with strong spam protection and access from webmail, desktop and mobile.' },
      features: ['Custom domain mailboxes', 'Spam & malware protection', 'Webmail access', 'Mobile access', 'IMAP / SMTP support', 'Calendar & contacts where available'],
      specs: [
        [I.mail, 'Mailboxes', 'One mailbox per teammate, on your domain.'],
        [I.shield, 'Protection', 'Spam filtering and malware scanning on incoming mail.'],
        [I.globe, 'Anywhere', 'Webmail plus standard IMAP/SMTP for every client.'],
      ],
      product: 'business-email',
      extraSections: ctaBand({ title: 'Choose an Email Plan', text: 'Email plans are published in the catalog as soon as they are configured — check the client area or ask us directly.', label: 'Choose an Email Plan', href: '/app/catalog' }),
    }).body,
  }),
});

/* ---- Security (§11) ---- */
pages.push({
  file: 'security.html',
  html: page({
    title: 'Security — SSL, Protection & Backups | CloudHost247',
    description: 'Security is a core CloudHost247 capability: SSL certificates, malware and DDoS-conscious protection, account security, backups and monitoring.',
    canonical: '/security', active: 'business',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Security']],
      title: 'Security Is a Core Capability',
      lede: 'From SSL certificates to backups and monitoring — protection is built into the platform, not bolted on.',
    }) + `
    <section class="section" id="ssl">
      <div class="container">
        <div class="grid grid--3">
          <div class="card"><div class="card-icon">${I.key}</div><h3>SSL Certificates</h3><p>Free SSL on hosting plans and certificate management for your services — encrypted by default.</p></div>
          <div class="card"><div class="card-icon">${I.shield}</div><h3>Website Security</h3><p>Hardened defaults, isolation between accounts and security-conscious platform configuration.</p></div>
          <div class="card"><div class="card-icon">${I.zap}</div><h3>Malware Protection</h3><p>Scanning and protective measures for hosted content and mail where configured.</p></div>
          <div class="card"><div class="card-icon">${I.globe}</div><h3>DDoS Protection</h3><p>Network-level mitigation according to the capabilities of each configured data center.</p></div>
          <div class="card"><div class="card-icon">${I.users}</div><h3>Account Security</h3><p>Strong password hashing, TOTP two-factor authentication and passkey sign-in on the platform.</p></div>
          <div class="card" id="backups"><div class="card-icon">${I.database}</div><h3>Backups</h3><p>Automated backups on hosting plans with restore from your client area; off-server backup options for servers.</p></div>
          <div class="card"><div class="card-icon">${I.chart}</div><h3>Monitoring</h3><p>Service health visible on the status page; component monitoring grows as integrations are enabled.</p></div>
          <div class="card"><div class="card-icon">${I.doc}</div><h3>Best Practices</h3><p>Guides in the knowledgebase: passwords, 2FA, DNS hygiene and safe deployments.</p></div>
          <div class="card"><div class="card-icon">${I.headset}</div><h3>Security Support</h3><p>Report concerns through the support center — security reports are treated with priority.</p></div>
        </div>
      </div>
    </section>
${ctaBand({ title: 'Secure by design', text: 'Every CloudHost247 service ships with security defaults enabled — you should never have to fight for basics.', label: 'Explore Hosting', href: '/hosting' })}`,
  }),
});

/* ---- Migration (§12) ---- */
pages.push({
  file: 'migration.html',
  html: page({
    title: 'Website Migration — Move to CloudHost247',
    description: 'Move your website to CloudHost247 with a guided migration: choose a plan, provide details, and we handle the transfer and DNS cutover.',
    canonical: '/migration', active: 'hosting',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Migration']],
      title: 'Move Your Website to CloudHost247',
      lede: 'Changing hosts should not be scary. Our migration process is guided, transparent and designed to avoid downtime.',
    }) + `
    <section class="section">
      <div class="container">
        <ol class="steps">
          <li><h3>Choose your hosting plan</h3><p>Pick the service that fits your website — web hosting, WordPress, cloud or VPS.</p></li>
          <li><h3>Provide your migration details</h3><p>Current host, control panel access or backup location — whatever applies to your setup.</p></li>
          <li><h3>CloudHost247 prepares the migration</h3><p>We review the source environment and prepare the destination account.</p></li>
          <li><h3>Website is transferred</h3><p>Files, databases and mail are copied and verified on the new infrastructure.</p></li>
          <li><h3>DNS is updated</h3><p>Nameservers or records are switched over once everything checks out.</p></li>
          <li><h3>Website goes live</h3><p>Traffic flows to CloudHost247 and we monitor the first hours closely.</p></li>
        </ol>
        <div class="notice mt-4">Migration is performed with your existing host still live, so there is no window where your site is nowhere.</div>
      </div>
    </section>
${ctaBand({ title: 'Start your migration', text: 'Tell us where your site lives today and we will take it from there.', label: 'Start Your Migration', href: '/contact' })}`,
  }),
});

/* ---- Infrastructure (§14) ---- */
pages.push({
  file: 'infrastructure.html',
  html: page({
    title: 'Infrastructure & Data Center Locations | CloudHost247',
    description: 'CloudHost247 global infrastructure: the locations actually configured on the platform, with services and status — no invented data centers.',
    canonical: '/infrastructure', active: 'servers',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Infrastructure']],
      title: 'Global Infrastructure, Honestly Reported',
      lede: 'This page lists the locations that are actually configured on the CloudHost247 platform. When a new region is added, it appears here.',
    }) + `
    <section class="section" id="locations">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Locations</span><h2>Configured regions</h2></div>
        <div data-locations data-variant="table"></div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Platform</span><h2>Built for operations</h2></div>
        <div class="value-grid">
          <div><h3>${I.chart} Monitoring</h3><p>Service health is reported on the status page; monitoring coverage expands as integrations are enabled.</p></div>
          <div><h3>${I.shield} Security</h3><p>Provider credentials are encrypted at rest and never exposed to browsers; access is role-controlled.</p></div>
          <div><h3>${I.layers} Automation</h3><p>Provisioning, backups and lifecycle actions run through the platform's deployment engine.</p></div>
        </div>
      </div>
    </section>
${ctaBand({ title: 'Need a specific region?', text: 'Tell us where your customers are and we will tell you what we can provision.', label: 'Contact Us', href: '/contact' })}`,
  }),
});

/* ---- About (§18) ---- */
pages.push({
  file: 'about.html',
  html: page({
    title: 'About CloudHost247 — Infrastructure for the Modern Internet',
    description: 'CloudHost247 provides professional cloud hosting and digital infrastructure. Our mission, values and commitment to honest operations.',
    canonical: '/about', active: 'company',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'About']],
      title: 'Infrastructure for the Modern Internet',
      lede: 'CloudHost247 exists to give businesses and developers hosting infrastructure they can rely on — professionally run, honestly described.',
    }) + `
    <section class="section">
      <div class="container prose">
        <h2>Our mission</h2>
        <p>To make professional hosting infrastructure accessible to every business — from a founder's first website to an agency's fleet of client projects — without the opacity that plagues the hosting industry.</p>
        <h2>Our vision</h2>
        <p>A global platform where websites, applications, domains, email and security are managed in one place, with real data behind every claim.</p>
        <h2>Our values</h2>
        <ul>
          <li><strong>Honesty over hype.</strong> We publish what is configured and verified — never invented statistics, fake locations or manufactured reviews.</li>
          <li><strong>Reliability as a discipline.</strong> Stable service comes from careful operations, monitoring and conservative defaults.</li>
          <li><strong>Security by default.</strong> Encryption, access control and hardened defaults ship enabled.</li>
          <li><strong>Support with substance.</strong> Real engineers, accountable answers.</li>
        </ul>
        <h2 id="why">Why businesses choose CloudHost247</h2>
        <p><strong>Performance.</strong> High-performance hosting infrastructure designed for fast websites and applications.</p>
        <p><strong>Security.</strong> Security-first infrastructure, monitoring and account protection.</p>
        <p><strong>Reliability.</strong> Infrastructure designed for stable, dependable service.</p>
        <p><strong>Scalability.</strong> Upgrade resources as your website or business grows.</p>
        <p><strong>Global infrastructure.</strong> A global-ready platform whose configured locations are published on the infrastructure page.</p>
        <p><strong>Expert support.</strong> Professional assistance for customers when they need it.</p>
        <h2>Global ambitions</h2>
        <p>CloudHost247 is built to serve customers internationally — the platform architecture is prepared for multiple currencies, languages and payment methods, which we will announce as each becomes available.</p>
      </div>
    </section>
${ctaBand({ title: 'Build with CloudHost247', text: 'Join us with a plan that fits — upgrade any time as you grow.', label: 'Get Started', href: '/app/catalog' })}`,
  }),
});

/* ---- Contact (§19) ---- */
pages.push({
  file: 'contact.html',
  html: page({
    title: 'Contact CloudHost247 — Sales, Support & Billing',
    description: 'Contact the CloudHost247 team: sales, technical support, billing and partnerships. Contact details are published from our official configuration.',
    canonical: '/contact', active: 'company',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Contact']],
      title: 'Talk to CloudHost247',
      lede: 'Questions about plans, migrations or infrastructure? Reach the right team below.',
    }) + `
    <section class="section">
      <div class="container">
        <div class="split">
          <div>
            <div class="grid grid--2">
              <div class="card"><div class="card-icon">${I.chart}</div><h3>Sales</h3><p>Plan selection, custom configurations and volume questions.</p></div>
              <div class="card"><div class="card-icon">${I.headset}</div><h3>Technical Support</h3><p>Existing customers can open a ticket from the client area for tracked, accountable help.</p></div>
              <div class="card"><div class="card-icon">${I.doc}</div><h3>Billing</h3><p>Invoices, payments and renewals.</p></div>
              <div class="card"><div class="card-icon">${I.users}</div><h3>Partnerships</h3><p>Agencies, resellers and integration partners.</p></div>
            </div>
            <div class="notice mt-3" data-contact-info>Loading published contact details…</div>
          </div>
          <form class="form-card" data-contact-form novalidate>
            <h2 class="mt-0" style="font-size:1.35rem">Send us a message</h2>
            <div class="form-alert" data-form-alert role="alert"></div>
            <div class="field"><label for="cf-name">Name</label><input id="cf-name" name="name" autocomplete="name" required /></div>
            <div class="field"><label for="cf-email">Email</label><input id="cf-email" name="email" type="email" autocomplete="email" required /></div>
            <div class="field"><label for="cf-topic">Topic</label>
              <select id="cf-topic" name="topic"><option>Sales</option><option>Technical Support</option><option>Billing</option><option>Partnerships</option></select>
            </div>
            <div class="field"><label for="cf-message">Message</label><textarea id="cf-message" name="message" rows="5" required></textarea></div>
            <button class="btn btn--primary" type="submit">Send Message</button>
            <p class="hint small mt-2">This form prepares your message for the configured support channel. Where no support channel is configured yet, we show you that honestly instead of pretending it was delivered.</p>
          </form>
        </div>
      </div>
    </section>`,
  }),
});

/* ---- Support center (§16) ---- */
pages.push({
  file: 'support.html',
  html: page({
    title: 'Support Center — Help, Tickets & Status | CloudHost247',
    description: 'CloudHost247 support portal: search the knowledgebase, open a support ticket, review ticket history and check service status.',
    canonical: '/support', active: 'resources',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Support']],
      title: 'Support Center',
      lede: 'Search the knowledgebase, open a ticket or check live service status — help is organized so you find answers fast.',
    }) + `
    <section class="section">
      <div class="container">
        <form class="domain-search" action="/knowledgebase" method="get">
          <h2>How can we help?</h2>
          <p class="muted">Search guides across hosting, domains, VPS, email and billing.</p>
          <div class="domain-form">
            <label class="visually-hidden" for="kb-q">Search the knowledgebase</label>
            <input id="kb-q" type="search" name="q" placeholder="e.g. passkey, invoice, domain search" />
            <button class="btn btn--primary" type="submit">Search</button>
          </div>
        </form>
        <div class="grid grid--3 mt-4">
          <a class="card kb-card" href="/knowledgebase"><div class="card-icon">${I.doc}</div><h3>Knowledgebase</h3><p>Guides for hosting, domains, VPS, email and billing.</p><span class="count">Browse articles</span></a>
          <a class="card kb-card" href="/app/support"><div class="card-icon">${I.headset}</div><h3>Open a ticket</h3><p>Tracked support requests with full history, from the client area.</p><span class="count">Client area required</span></a>
          <a class="card kb-card" href="/status"><div class="card-icon">${I.chart}</div><h3>Service status</h3><p>Live status for website, API and platform storage.</p><span class="count">Check now</span></a>
        </div>
        <div class="section-head mt-4"><span class="eyebrow">Categories</span><h2>Browse by topic</h2></div>
        <div class="kb-grid">
          <a class="card kb-card" href="/knowledgebase#hosting"><h3>Hosting</h3><span class="count">Control panels, files, databases</span></a>
          <a class="card kb-card" href="/knowledgebase#domains"><h3>Domains</h3><span class="count">Registration, DNS, transfers</span></a>
          <a class="card kb-card" href="/knowledgebase#vps"><h3>VPS</h3><span class="count">Provisioning, access, snapshots</span></a>
          <a class="card kb-card" href="/knowledgebase#billing"><h3>Billing</h3><span class="count">Invoices, payments, renewals</span></a>
          <a class="card kb-card" href="/knowledgebase#account"><h3>Account</h3><span class="count">Security, 2FA, passkeys</span></a>
          <a class="card kb-card" href="/knowledgebase#technical"><h3>Technical Support</h3><span class="count">Troubleshooting & diagnostics</span></a>
        </div>
      </div>
    </section>`,
  }),
});

/* ---- Knowledgebase (§20) ---- */
pages.push({
  file: 'knowledgebase.html',
  html: page({
    title: 'Knowledgebase — Hosting, Domain & VPS Guides | CloudHost247',
    description: 'CloudHost247 knowledgebase: practical guides for hosting, domains, VPS, email, billing and account security — with search and categories.',
    canonical: '/knowledgebase', active: 'resources',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Knowledgebase']],
      title: 'Knowledgebase',
      lede: 'Practical guides written by our team. Every article documents how the platform actually works.',
    }) + `
    <section class="section">
      <div class="container">
        <form class="domain-search" data-kb-search-form novalidate>
          <h2>Search the knowledgebase</h2>
          <p class="muted">Find guides across hosting, domains, billing and account security.</p>
          <div class="domain-form">
            <label class="visually-hidden" for="kb-q">Search articles</label>
            <input id="kb-q" type="search" name="q" placeholder="e.g. passkey, invoice, domain search" />
            <button class="btn btn--primary" type="submit">Search</button>
          </div>
        </form>
        <div class="mt-4" data-kb-root>
          <div class="card"><div class="skeleton" style="height:20px;width:40%"></div><div class="skeleton mt-2" style="height:14px;width:90%"></div><div class="skeleton mt-2" style="height:14px;width:75%"></div></div>
        </div>
      </div>
    </section>`,
  }),
});

/* ---- Blog (§21) ---- */
pages.push({
  file: 'blog.html',
  html: page({
    title: 'Blog — Cloud, Hosting & Security Insights | CloudHost247',
    description: 'The CloudHost247 blog: cloud, hosting, security, domains, WordPress, VPS, business and developer topics — plus company news.',
    canonical: '/blog', active: 'resources',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Blog']],
      title: 'The CloudHost247 Blog',
      lede: 'Insights on cloud, hosting, security and running websites professionally — published when we have something worth saying.',
    }) + `
    <section class="section">
      <div class="container">
        <form class="domain-search" data-blog-search-form novalidate>
          <h2>Search posts</h2>
          <p class="muted">Company news and technical articles from the CloudHost247 team.</p>
          <div class="domain-form">
            <label class="visually-hidden" for="blog-q">Search the blog</label>
            <input id="blog-q" type="search" name="q" placeholder="e.g. platform, security" />
            <button class="btn btn--primary" type="submit">Search</button>
          </div>
        </form>
        <div class="mt-4" data-blog-root>
          <div class="card"><div class="skeleton" style="height:20px;width:40%"></div><div class="skeleton mt-2" style="height:14px;width:90%"></div></div>
        </div>
      </div>
    </section>`,
  }),
});

/* ---- Status (§17) ---- */
pages.push({
  file: 'status.html',
  html: page({
    title: 'Service Status | CloudHost247',
    description: 'Live service status for CloudHost247: website, API and platform storage verified in real time. Unmonitored components are labeled as such.',
    canonical: '/status', active: 'resources',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Status']],
      title: 'Service Status',
      lede: 'Components below are checked live when you load this page. Anything not yet connected to monitoring is labeled unmonitored — we do not display fake uptime.',
    }) + `
    <section class="section">
      <div class="container" style="max-width:820px">
        <div class="card" data-status-summary aria-live="polite"><div class="skeleton" style="height:26px;width:60%"></div></div>
        <div class="card mt-3"><h3 class="mt-0">Components</h3><div data-status-list></div></div>
        <p class="muted small mt-3" data-status-note></p>
      </div>
    </section>`,
  }),
});

/* ---- Legal pages (§22) ---- */
function legalPage({ slug, title, description, version, bodyHtml }) {
  return {
    file: path.join('legal', `${slug}.html`),
    html: page({
      title: `${title} | CloudHost247`,
      description,
      canonical: `/legal/${slug}`, active: 'company',
      body: pageHead({ crumbs: [['/', 'Home'], [null, title]], title, lede: 'Official CloudHost247 policy. Versioned and dated; the latest published version governs.' }) + `
    <section class="section">
      <div class="container">
        <div class="prose">
          <span class="version-stamp">Version ${version} · Effective 2026-10-05</span>
          ${bodyHtml}
        </div>
      </div>
    </section>`,
    }),
  };
}

pages.push(legalPage({
  slug: 'terms', title: 'Terms of Service', version: '1.0',
  description: 'CloudHost247 Terms of Service — the agreement governing hosting, domain and digital services.',
  bodyHtml: `
<h2>1. Agreement</h2>
<p>These Terms of Service govern your use of CloudHost247 services, including hosting, domains, email and related digital services. By creating an account or purchasing a service you agree to these terms.</p>
<h2>2. Services</h2>
<p>CloudHost247 provides the services described in the catalog at the time of purchase. Service specifications, limits and pricing are those published in the client area at order time.</p>
<h2>3. Customer responsibilities</h2>
<ul>
  <li>Keep account credentials secure; activity under your account is your responsibility.</li>
  <li>Use services lawfully and in accordance with the Acceptable Use Policy.</li>
  <li>Provide accurate registration and billing information.</li>
</ul>
<h2>4. Payment &amp; renewal</h2>
<p>Services are billed in advance for the selected billing cycle. Renewal pricing is shown before renewal. Failed payments may lead to service suspension following notice.</p>
<h2>5. Suspension &amp; termination</h2>
<p>We may suspend services for non-payment, abuse, or violations of the Acceptable Use Policy, with notice except where immediate action is required to protect the platform or other customers.</p>
<h2>6. Liability</h2>
<p>Services are provided with care but without warranty of uninterrupted operation. To the maximum extent permitted by law, CloudHost247's liability is limited to the fees paid for the affected service in the preceding period. Nothing limits liability that cannot lawfully be limited.</p>
<h2>7. Changes</h2>
<p>We may update these terms with notice. Continued use after changes take effect constitutes acceptance.</p>`,
}));

pages.push(legalPage({
  slug: 'privacy', title: 'Privacy Policy', version: '1.0',
  description: 'How CloudHost247 collects, uses and protects personal data.',
  bodyHtml: `
<h2>1. Data we process</h2>
<p>Account data (name, email, authentication records), billing data (invoices, payment status), service data (domains, server configurations you create) and technical logs needed to operate and secure the platform.</p>
<h2>2. Why we process it</h2>
<ul>
  <li>To provide and operate the services you order.</li>
  <li>To bill for services and prevent fraud.</li>
  <li>To secure the platform and investigate abuse.</li>
  <li>To meet legal obligations.</li>
</ul>
<h2>3. Protection</h2>
<p>Credentials are stored using strong password hashing; secrets such as provider tokens and TOTP seeds are encrypted at rest. Access to personal data is role-controlled and audited.</p>
<h2>4. Sharing</h2>
<p>We do not sell personal data. Data is shared only with processors required to deliver the service (for example, registries for domain registration) and where law requires.</p>
<h2>5. Your rights</h2>
<p>Depending on your jurisdiction you may have rights of access, correction, deletion and portability. Contact us via the contact page to exercise them.</p>
<h2>6. Retention</h2>
<p>We retain data while your account is active and for the period required by law or legitimate operational needs afterwards.</p>`,
}));

pages.push(legalPage({
  slug: 'cookies', title: 'Cookie Policy', version: '1.0',
  description: 'How CloudHost247 uses cookies and similar technologies.',
  bodyHtml: `
<h2>1. What we use</h2>
<p>The platform uses strictly necessary storage (session and authentication state) to keep you signed in and to keep the client area working. These do not require consent because the service cannot function without them.</p>
<h2>2. What we do not use</h2>
<p>We do not deploy third-party advertising trackers on the client area. If analytics are introduced, they will be disclosed here first.</p>
<h2>3. Managing cookies</h2>
<p>Your browser settings can block or delete cookies; blocking strictly necessary cookies will prevent sign-in.</p>`,
}));

pages.push(legalPage({
  slug: 'acceptable-use', title: 'Acceptable Use Policy', version: '1.0',
  description: 'What is and is not permitted on CloudHost247 services.',
  bodyHtml: `
<h2>1. Prohibited use</h2>
<ul>
  <li>Illegal content or activity, including content that infringes intellectual property rights.</li>
  <li>Malware distribution, phishing, botnet command-and-control or scanning of networks you do not own.</li>
  <li>Spam, unsolicited bulk messaging or abusive automated traffic.</li>
  <li>Attempts to compromise the platform, other customers, or circumvent service limits.</li>
</ul>
<h2>2. Resource use</h2>
<p>Services must be used within their published limits. Sustained abuse of shared resources may lead to throttling, suspension or migration to an appropriate service.</p>
<h2>3. Enforcement</h2>
<p>Violations are handled proportionally: notice and remediation first, suspension where conduct continues or is severe. Illegal content is escalated to the relevant authorities where required.</p>`,
}));

pages.push(legalPage({
  slug: 'sla', title: 'Service Level Agreement', version: '1.0',
  description: 'CloudHost247 service commitments, support and remediation — stated honestly.',
  bodyHtml: `
<h2>1. Commitment</h2>
<p>CloudHost247 operates its platform with monitoring, backups and careful change management. Where a formal uptime credit scheme applies to your plan, its terms are published with that plan in the client area.</p>
<h2>2. Support</h2>
<p>Support requests are handled through the ticket system with recorded history. Severity and response expectations are set when the ticket is created.</p>
<h2>3. Remediation</h2>
<p>Where a service fails to meet its published commitment, affected customers are informed and remediation (credit or correction) is applied as described in the plan terms.</p>
<h2>4. Honesty note</h2>
<p>We do not publish uptime percentages we cannot measure. Monitoring coverage for each component is shown on the status page.</p>`,
}));

pages.push(legalPage({
  slug: 'refund-policy', title: 'Refund Policy', version: '1.0',
  description: 'CloudHost247 refund and cancellation terms, stated clearly.',
  bodyHtml: `
<h2>1. Cancellation</h2>
<p>You may cancel recurring services from the client area; cancellation stops the next renewal. Services remain available until the end of the paid period.</p>
<h2>2. Refunds</h2>
<p>Refunds are evaluated case by case and granted where the platform failed to deliver the purchased service, or where a plan explicitly includes a money-back window. Domain registrations and one-time setup work are generally non-refundable once processed, because they incur third-party costs.</p>
<h2>3. How to request</h2>
<p>Open a billing ticket from the client area with the invoice reference. We respond with a decision and, where approved, process the refund through the original payment method where possible.</p>
<h2>4. Abuse</h2>
<p>Refunds may be declined where the service was used in violation of the Acceptable Use Policy or chargeback rights are exercised in bad faith.</p>`,
}));

/* ---- 404 ---- */
pages.push({
  file: '404.html',
  html: page({
    title: 'Page Not Found | CloudHost247',
    description: 'The page you requested could not be found on CloudHost247.',
    canonical: '/404', active: 'home',
    body: `    <section class="section" style="min-height:44vh">
      <div class="container text-center" style="padding:60px 0">
        <span class="eyebrow">404</span>
        <h1>That page could not be found</h1>
        <p class="muted">The link may be outdated, or the page may have moved. Everything else is one click away.</p>
        <div class="hero-ctas" style="justify-content:center">
          <a class="btn btn--primary" href="/">Back to homepage</a>
          <a class="btn btn--secondary" href="/hosting">Explore hosting</a>
        </div>
      </div>
    </section>`,
  }),
});

/* ---- Auth pages (contracts for assets/js/auth-forms.js preserved) ---- */
function authShell(title, description, canonical, inner) {
  return head({ title, description, canonical }) + header('') + `  <main id="main">
    <div class="auth-shell">
      <div class="auth-card">
        <div class="form-card">
          ${inner}
        </div>
      </div>
    </div>
  </main>
` + footer();
}

pages.push({
  file: 'login.html',
  html: authShell(
    'Sign In | CloudHost247',
    'Sign in to your CloudHost247 client area.',
    '/login',
    `<h1>Welcome back</h1>
          <p class="muted">Sign in to manage your services, domains and billing.</p>
          <div class="form-alert" data-form-alert role="alert"></div>
          <div data-passkey-block>
            <button type="button" class="btn btn--secondary" style="width:100%" data-passkey-login>Sign in with a passkey</button>
            <p class="hint small" data-passkey-hint></p>
          </div>
          <form class="form-card" style="border:0;box-shadow:none;padding:0" data-login-form novalidate>
            <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required /></div>
            <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required /></div>
            <div class="field" data-mfa-field hidden><label for="mfa">Authentication code</label><input id="mfa" name="mfa" inputmode="numeric" autocomplete="one-time-code" /><span class="hint">Enter the 6-digit code from your authenticator app.</span></div>
            <button class="btn btn--primary" type="submit" style="width:100%">Sign In</button>
          </form>
          <p class="small mt-2 mb-0"><a href="/forgot">Forgot your password?</a> · <a href="/register">Create an account</a></p>`,
  ),
});

pages.push({
  file: 'register.html',
  html: authShell(
    'Create Account | CloudHost247',
    'Create your CloudHost247 account.',
    '/register',
    `<h1>Create your account</h1>
          <p class="muted">One account for hosting, domains, billing and support.</p>
          <div class="form-alert" data-form-alert role="alert"></div>
          <form class="form-card" style="border:0;box-shadow:none;padding:0" data-register-form novalidate>
            <div class="field"><label for="name">Full name</label><input id="name" name="name" autocomplete="name" required /></div>
            <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required /></div>
            <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password" required /><span class="hint">At least 10 characters.</span></div>
            <button class="btn btn--primary" type="submit" style="width:100%">Create Account</button>
          </form>
          <p class="small mt-2 mb-0">Already have an account? <a href="/login">Sign in</a></p>`,
  ),
});

pages.push({
  file: 'forgot.html',
  html: authShell(
    'Reset Password | CloudHost247',
    'Request a password reset for your CloudHost247 account.',
    '/forgot',
    `<h1>Reset your password</h1>
          <p class="muted">Enter your account email and we will send reset instructions if the account exists.</p>
          <div class="form-alert" data-form-alert role="alert"></div>
          <form class="form-card" style="border:0;box-shadow:none;padding:0" data-forgot-form novalidate>
            <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required /></div>
            <button class="btn btn--primary" type="submit" style="width:100%">Send Reset Instructions</button>
          </form>
          <p class="small mt-2 mb-0"><a href="/login">Back to sign in</a></p>`,
  ),
});

pages.push({
  file: 'reset.html',
  html: authShell(
    'Choose a New Password | CloudHost247',
    'Set a new password for your CloudHost247 account.',
    '/reset',
    `<h1>Choose a new password</h1>
          <div class="form-alert" data-form-alert role="alert"></div>
          <form class="form-card" style="border:0;box-shadow:none;padding:0" data-reset-form novalidate>
            <div class="field"><label for="password">New password</label><input id="password" name="password" type="password" autocomplete="new-password" required /></div>
            <div class="field"><label for="confirmPassword">Confirm password</label><input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required /></div>
            <button class="btn btn--primary" type="submit" style="width:100%">Set New Password</button>
          </form>`,
  ),
});

/* ------------------------------------------------------------------ */
/* Global rebuild (spec phase 4): marketplace, deployment, OS, panels, */
/* server management, enterprise, game servers, brokerage, offers, FAQ */
/* ------------------------------------------------------------------ */

pages.push({
  file: 'applications.html',
  html: page({
    title: 'Application Marketplace — One-Click Deployable Apps | CloudHost247',
    description: 'Browse the CloudHost247 application marketplace: every app below exists in our real deployment catalog with verified manifests — CMS, e-commerce, databases, analytics, AI and more.',
    canonical: '/applications', active: 'applications',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Applications']],
      title: 'Application Marketplace',
      lede: 'Every application below is a real entry in our deployment catalog — manifest-verified, deployed through the same pipeline that powers the client area. Nothing is listed that the platform cannot install.',
    }) + `
    <section class="section">
      <div class="container">
        <form class="domain-search" data-apps-search novalidate>
          <h2>Find an application</h2>
          <p class="muted">Search the live catalog by name or purpose.</p>
          <div class="domain-form">
            <label class="visually-hidden" for="app-q">Search applications</label>
            <input id="app-q" type="search" name="q" placeholder="e.g. WordPress, Nextcloud, Redis" />
            <button class="btn btn--primary" type="submit">Search</button>
          </div>
        </form>
        <div class="mt-4" data-apps-root>
          <div class="card"><div class="skeleton" style="height:20px;width:40%"></div><div class="skeleton mt-2" style="height:14px;width:90%"></div></div>
        </div>
      </div>
    </section>
${ctaBand({ title: 'Ready to deploy?', text: 'Pick an application, choose a server plan, and the deployment pipeline takes it from there.', label: 'View App Deployment', href: '/app-deployment' })}`,
  }),
});

pages.push({
  file: 'app-deployment.html',
  html: page({
    title: 'App Deployment & PaaS — Ship From Git to Live | CloudHost247',
    description: 'The CloudHost247 deployment platform: manifest-driven apps, async deployment pipeline, isolated containers, encrypted credentials, domains with DNS verification and full event logs.',
    canonical: '/app-deployment', active: 'developers',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'App Deployment']],
      title: 'Application Deployment Platform',
      lede: 'A modern deployment pipeline built into CloudHost247: choose an application, order a server, and the platform installs, configures and monitors it — with every step visible.',
    }) + `
    <section class="section">
      <div class="container">
        <div class="split">
          <div>
            <span class="eyebrow">How it works</span>
            <h2>From catalog to running application</h2>
            <p class="muted">Applications come from a manifest-driven catalog stored in the database — no hard-coded installs. Your order creates an invoice, and installation begins only after verified payment. Every action runs through an async queue with retries, rollback and a complete event history.</p>
            <a class="btn btn--primary" href="/applications">Browse the Marketplace</a>
          </div>
          <img src="/assets/img/hero-deployment.webp" width="800" height="450" alt="Illustration of the CloudHost247 deployment pipeline moving containers from code to cloud" loading="lazy" style="width:100%;height:auto;border-radius:14px" />
        </div>
      </div>
    </section>
    <section class="section section--soft" id="paas">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Platform capabilities</span><h2>What the pipeline gives you</h2></div>
        ${grid3([
          ['Manifest-driven catalog', 'Adding an application means importing its manifest — the engine reads it at deploy time.'],
          ['Isolated containers', 'Each installation runs in its own container project, managed by our server agent over a signed channel.'],
          ['Payment-gated provisioning', 'Installs are enqueued only after a verified payment webhook — never before.'],
          ['Encrypted credentials', 'Agent secrets and environment values are encrypted at rest and shown exactly once.'],
          ['Domains with verification', 'Attach your own domains after DNS TXT verification — served with SSL.'],
          ['Full deployment history', 'Every step and event is logged: installs, updates, backups, restores and uninstalls.'],
        ])}
      </div>
    </section>
${ctaBand({ title: 'Deploy your first application', text: 'Pick from the marketplace or bring your workload to a VPS and shape it yourself.', label: 'Browse Applications', href: '/applications' })}`,
  }),
});

pages.push({
  file: 'operating-systems.html',
  html: page({
    title: 'Operating Systems — Verified OS Catalog | CloudHost247',
    description: 'The CloudHost247 operating system catalog: only OS versions with verified provider images and active plans are ever shown.',
    canonical: '/operating-systems', active: 'developers',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Operating Systems']],
      title: 'Operating Systems',
      lede: 'Our OS catalog follows the provisioning chain: plan, availability rule, OS version, architecture and a live-verified provider image. Only combinations that pass every stage are shown here.',
    }) + `
    <section class="section">
      <div class="container" data-os-root>
        <div class="card"><div class="skeleton" style="height:20px;width:40%"></div><div class="skeleton mt-2" style="height:14px;width:85%"></div></div>
      </div>
    </section>
${ctaBand({ title: 'Need a specific distribution?', text: 'Tell us the OS and architecture your workload requires — if it is supported by the provider, we can add the verified image.', label: 'Contact Support', href: '/support' })}`,
  }),
});

pages.push({
  file: 'control-panels.html',
  html: page({
    title: 'Control Panels — What We Actually Offer | CloudHost247',
    description: 'Control panels offered with CloudHost247 services — published only when genuinely provisioned, never claimed otherwise.',
    canonical: '/control-panels', active: 'developers',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Control Panels']],
      title: 'Control Panels',
      lede: 'We publish a control panel only when it is genuinely provisioned with a service. Until a panel is configured for sale, it does not appear here — we would rather show an honest empty list than an unsupported claim.',
    }) + `
    <section class="section">
      <div class="container" data-panels-root>
        <div class="card"><div class="skeleton" style="height:20px;width:40%"></div><div class="skeleton mt-2" style="height:14px;width:85%"></div></div>
      </div>
    </section>
${ctaBand({ title: 'Prefer to manage things yourself?', text: 'Every VPS ships with full root access — run whatever panel or stack you like.', label: 'View VPS Plans', href: '/hosting/vps' })}`,
  }),
});

pages.push({
  file: 'developers.html',
  html: page({
    title: 'Developer Platform — Infrastructure Built for Developers | CloudHost247',
    description: 'CloudHost247 for developers: root access, a manifest-driven application marketplace, encrypted environment credentials, domain verification and a full deployment event log.',
    canonical: '/developers', active: 'developers',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Developers']],
      title: 'Infrastructure Built for Developers',
      lede: 'Real resources, real access, real control — a platform that gets out of your way while you build.',
    }) + `
    <section class="section">
      <div class="container">
        ${grid3([
          ['Full root on VPS', 'Install the runtime, database and services your stack needs — nothing locked down.'],
          ['Application marketplace', 'Deploy from a manifest-verified catalog of applications with one order.'],
          ['Deployment pipeline', 'Async installs with retries, rollback and an append-only event log.'],
          ['Encrypted credentials', 'Environment values and agent secrets are encrypted at rest and shown once.'],
          ['Domains & SSL', 'Attach verified domains to any installation — DNS TXT check, then SSL.'],
          ['Snapshots & backups', 'Point-in-time safety before risky changes, restore from the client area.'],
        ])}
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Documentation</span><h2>How the platform actually works</h2></div>
        <div data-dev-docs-root>
          <div class="card"><div class="skeleton" style="height:20px;width:40%"></div><div class="skeleton mt-2" style="height:14px;width:85%"></div></div>
        </div>
      </div>
    </section>
${ctaBand({ title: 'Build on CloudHost247', text: 'Start with a VPS or deploy straight from the application marketplace.', label: 'Get Started', href: '/app/catalog' })}`,
  }),
});

pages.push({
  file: 'server-management.html',
  html: page({
    title: 'Server Management — Monitor, Control, Recover | CloudHost247',
    description: 'Manage CloudHost247 servers from the client area: agent-verified health, start/stop/reboot, snapshots, reinstall and metrics — with a clear split between live and upcoming capabilities.',
    canonical: '/server-management', active: 'servers',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Server Management']],
      title: 'Server Management',
      lede: 'Operate your servers from one place. Capabilities below are split honestly: what is available today, and what is being built.',
    }) + `
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Available</span><h2>In the client area now</h2></div>
        ${grid3([
          ['Agent-verified health', 'A signed agent reports OS, hostname and service state; attestation is checked, not assumed.'],
          ['Resource metrics', 'CPU, memory, disk and load collected from your server and shown in the dashboard.'],
          ['Start / stop / reboot', 'Lifecycle controls for virtual servers directly from the client area.'],
          ['Snapshots', 'Point-in-time images before changes; restore when you need to roll back.'],
          ['Reinstall', 'Re-provision a server from a verified OS image without losing your billing record.'],
          ['Managed support', 'Engineers on tickets for the operational questions — not scripts.'],
        ])}
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Coming soon</span><h2>On the roadmap, not yet for sale</h2></div>
        <div class="notice notice--empty">Firewall management, reverse-DNS self-service, rescue mode and automated patching are in active development. They will be announced here and in the client area when genuinely available — never before.</div>
      </div>
    </section>
${ctaBand({ title: 'Put it to work', text: 'Order a VPS and manage it from day one — metrics, snapshots and lifecycle included.', label: 'View VPS Plans', href: '/hosting/vps' })}`,
  }),
});

pages.push({
  file: path.join('hosting', 'enterprise.html'),
  html: page({
    title: 'Enterprise Servers — Large-Scale Compute | CloudHost247',
    description: 'Enterprise-scale server deployments on CloudHost247: scoped per project, quoted transparently, delivered with managed support options.',
    canonical: '/hosting/enterprise', active: 'servers',
    body: servicePage({
      key: 'enterprise',
      crumbs: [['/', 'Home'], ['/hosting', 'Hosting'], [null, 'Enterprise Servers']],
      title: 'Enterprise Servers',
      lede: 'Large-scale compute for organizations that run serious infrastructure — scoped, quoted and delivered per deployment.',
      intro: { heading: 'Enterprise capacity, engineered with you', text: 'Enterprise deployments rarely fit a price list: multi-server environments, specific interconnects, compliance constraints and growth plans all shape the build. Rather than publish invented packages, we scope each deployment with you and quote the real configuration.' },
      features: ['Requirements-first scoping', 'Itemized formal quotes', 'Dedicated hardware options', 'Managed support tiers', 'Growth-path architecture', 'Single point of contact'],
      specs: [
        [I.cpu, 'Capacity', 'CPU, RAM, storage and network sized to the workload — not a fixed menu.'],
        [I.shield, 'Compliance', 'Single-tenant options where your requirements demand isolation.'],
        [I.headset, 'Operation', 'Managed support tiers for the lifetime of the deployment.'],
      ],
      product: 'dedicated',
      extraSections: ctaBand({ title: 'Start an enterprise conversation', text: 'Describe your workload and constraints — an engineer, not a sales script, will reply.', label: 'Contact Support', href: '/contact' }),
    }).body,
  }),
});

pages.push({
  file: path.join('hosting', 'game-servers.html'),
  html: page({
    title: 'Game Servers — Low-Latency Community Hosting | CloudHost247',
    description: 'Game server hosting on CloudHost247: dedicated resources, full root access and snapshots, built on our transparent VPS line.',
    canonical: '/hosting/game-servers', active: 'servers',
    body: servicePage({
      key: 'game-servers',
      crumbs: [['/', 'Home'], ['/hosting', 'Hosting'], [null, 'Game Servers']],
      title: 'Game Servers',
      lede: 'Low-latency virtual servers for community game servers — sized for the games you host.',
      intro: { heading: 'Your server, your rules', text: 'Dedicated game-server packages have not been published yet. Until they are, our VPS line is the right foundation: dedicated CPU and RAM, full root access to install your game server software, and enough network capacity for a busy community.' },
      features: ['Dedicated CPU & RAM', 'Full root access', 'Mod & plugin freedom', 'Snapshots & backups', 'Player slots your call', 'Upgrade any time'],
      specs: [
        [I.zap, 'Performance', 'Allocated resources keep tick rates stable — no noisy neighbours.'],
        [I.key, 'Control', 'Install any game server binary and configure it your way.'],
        [I.database, 'Safety', 'Snapshot before updates; restore in minutes if a mod goes wrong.'],
      ],
      product: 'vps',
      extraSections: ctaBand({ title: 'Spin up a game server', text: 'Choose a VPS configuration, install your game and invite your community.', label: 'Choose a Configuration', href: '/app/catalog?product=vps' }),
    }).body,
  }),
});

pages.push({
  file: path.join('domains', 'brokerage.html'),
  html: page({
    title: 'Domain Brokerage — Premium Domain Acquisition | CloudHost247',
    description: 'CloudHost247 Domain Brokerage: we negotiate the acquisition of already-registered domains on your behalf — confidential budget, itemized charges, recorded offers.',
    canonical: '/domains/brokerage', active: 'domains',
    body: pageHead({
      crumbs: [['/', 'Home'], ['/domains', 'Domains'], [null, 'Domain Brokerage']],
      title: 'Domain Brokerage',
      lede: 'The name you want is already registered? Our brokerage team attempts to acquire it for you through legitimate channels — with a confidential budget and itemized charges.',
    }) + `
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">The service</span><h2>How brokerage works</h2></div>
        ${grid3([
          ['Research & contact', 'We research legitimate acquisition routes and attempt contact with the domain owner or an authorized channel.'],
          ['Negotiation on your behalf', 'Your broker negotiates according to your instructions; offers and counteroffers are recorded permanently.'],
          ['Confidential budget', 'Your maximum budget is never disclosed unless you explicitly authorize it.'],
          ['Itemized charges', 'Acquisition price, brokerage fee, transfer fee and any escrow charges are always listed separately before you pay.'],
          ['Secure payment', 'Payment is coordinated through your CloudHost247 account — never to unknown third parties.'],
          ['Transfer to completion', 'We track the domain transfer until it is verified in your account.'],
        ])}
        <div class="notice" style="margin-top:22px">Acquisition is never guaranteed — a registered domain does not mean its owner will sell. The complete terms are published in the <a href="/legal/refund-policy">knowledgebase legal center</a> and the Domain Brokerage Terms you accept when a case is created.</div>
      </div>
    </section>
${ctaBand({ title: 'Request a brokerage case', text: 'Open a ticket with the domain you want and your budget — we will tell you honestly whether an acquisition route exists.', label: 'Contact Support', href: '/support' })}`,
  }),
});

pages.push({
  file: 'offers.html',
  html: page({
    title: 'Current Offers — Live Plans & Pricing | CloudHost247',
    description: 'Every CloudHost247 plan currently available for order, with live pricing, billing cycles and limits pulled straight from the catalog.',
    canonical: '/offers', active: 'resources',
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'Current Offers']],
      title: 'Current Offers',
      lede: 'Everything available for order right now — with the real prices, cycles and limits from our catalog. No invented promotions.',
    }) + `
    <section class="section">
      <div class="container">
        <div data-pricing data-product=""></div>
        <p class="muted small mt-3">Prices shown are for new orders. Renewal pricing is shown per plan where it differs. Taxes are calculated at checkout where applicable.</p>
      </div>
    </section>
${ctaBand({ title: 'Questions before you order?', text: 'Our team will help you pick the right plan — and tell you when a cheaper one fits.', label: 'Contact Sales', href: '/contact' })}`,
  }),
});

pages.push({
  file: 'faqs.html',
  html: page({
    title: 'Frequently Asked Questions | CloudHost247',
    description: 'Straight answers about CloudHost247 services, billing, support and account security.',
    canonical: '/faqs', active: 'resources',
    jsonldExtra: {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: FAQ_ITEMS.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
    body: pageHead({
      crumbs: [['/', 'Home'], [null, 'FAQs']],
      title: 'Frequently Asked Questions',
      lede: 'Straight answers about our services, billing and support. If your question is not covered, open a ticket and a human will answer.',
    }) + `
    <section class="section">
      <div class="container" style="max-width:880px;display:grid;gap:14px">
        ${FAQ_ITEMS.map(([q, a]) => `<details class="card"><summary style="font-weight:700;cursor:pointer">${q}</summary><p style="margin-top:10px">${a}</p></details>`).join('\n        ')}
      </div>
    </section>
${ctaBand({ title: 'Still have a question?', text: 'Our support team answers tickets personally — no bots, no canned replies.', label: 'Contact Support', href: '/support' })}`,
  }),
});

/* ------------------------------------------------------------------ */
/* Emit                                                                */
/* ------------------------------------------------------------------ */
let written = 0;
for (const { file, html } of pages) {
  const dest = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
  written += 1;
}
console.log(`[build-site] wrote ${written} pages to ${ROOT}`);
