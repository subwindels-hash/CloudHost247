#!/usr/bin/env node
/**
 * Development seed — idempotently loads RBAC roles and a sample catalog so both frontends have
 * real data on first run. Safe to run repeatedly and safe on both backends (JSON and PostgreSQL).
 *
 *   node scripts/seed.js
 *
 * This never fabricates secrets or customer data; it only loads reference catalog content that is
 * explicitly published (status: active). It is not required in production.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/core/config');
const { createLogger } = require('../src/core/logger');
const { createStore } = require('../src/store');
const { uuidv7 } = require('../src/lib/ids');

const ROLES = [
  ['customer', 'Standard customer account'],
  ['staff', 'Support and operations staff'],
  ['admin', 'Administrator with billing and platform access'],
  ['super_admin', 'Full control including role and status changes'],
];

// slug -> { name, category, description, plans: [...] }
const CATALOG = [
  {
    slug: 'web-hosting',
    name: 'Web Hosting',
    category: 'hosting',
    description: 'Fast, secure shared hosting with NVMe storage, free SSL and daily backups.',
    plans: [
      {
        slug: 'starter', name: 'Starter', status: 'active',
        limits: { websites: 1, storageGb: 10, bandwidthGb: 100, email: 5 },
        features: ['1 website', '10 GB NVMe storage', 'Free SSL', '5 mailboxes', 'Daily backups'],
        pricing: [
          { billingCycle: 'monthly', price: 2.99 },
          { billingCycle: 'annual', price: 29.99 },
        ],
      },
      {
        slug: 'business', name: 'Business', status: 'active',
        limits: { websites: 10, storageGb: 50, bandwidthGb: 500, email: 50 },
        features: ['10 websites', '50 GB NVMe storage', 'Free SSL', '50 mailboxes', 'Priority support'],
        pricing: [
          { billingCycle: 'monthly', price: 7.99 },
          { billingCycle: 'annual', price: 79.99 },
        ],
      },
    ],
  },
  {
    slug: 'vps',
    name: 'Cloud VPS',
    category: 'vps',
    description: 'Root-access virtual servers with dedicated resources, provisioned in minutes.',
    plans: [
      {
        slug: 'vps-2gb', name: 'VPS 2GB', status: 'active',
        limits: { vcpu: 1, ramGb: 2, ssdGb: 50, transferGb: 2000 },
        features: ['1 vCPU', '2 GB RAM', '50 GB SSD', '2 TB transfer', 'Full root access'],
        pricing: [
          { billingCycle: 'monthly', price: 12.0 },
        ],
      },
      {
        slug: 'vps-8gb', name: 'VPS 8GB', status: 'active',
        limits: { vcpu: 4, ramGb: 8, ssdGb: 160, transferGb: 5000 },
        features: ['4 vCPU', '8 GB RAM', '160 GB SSD', '5 TB transfer', 'Full root access'],
        pricing: [
          { billingCycle: 'monthly', price: 36.0 },
        ],
      },
    ],
  },
  {
    slug: 'domains',
    name: 'Domain Registration',
    category: 'domain',
    description: 'Register and manage domains with free WHOIS privacy and DNS.',
    plans: [
      {
        slug: 'register', name: 'Register', status: 'active',
        limits: { privacy: true, dns: true },
        features: ['Free WHOIS privacy', 'Free DNS management', 'Auto-renewal protection'],
        pricing: [
          { billingCycle: 'once', price: 9.99 },
          { billingCycle: 'annual', price: 9.99 },
        ],
      },
    ],
  },
];

// Knowledgebase and blog content. Every article documents the platform's actual behaviour —
// facts about this system, not marketing filler. Idempotent upsert by slug.
const ARTICLES = [
  {
    kind: 'kb', slug: 'sign-in-with-a-passkey', title: 'Signing in with a passkey',
    category: 'Account', summary: 'Use a passkey instead of a password: what it is, and how to register and sign in with one.',
    body: `## What a passkey is
A passkey is a credential stored by your device or password manager. It signs a challenge from CloudHost247 without ever sending a shared secret over the network, which makes it resistant to phishing.

## Registering a passkey
- Sign in to the client area and open the Security page.
- In the Passkeys section, choose to add a passkey and confirm your current password.
- Your device will ask you to create the credential (fingerprint, face scan or device PIN).
- The passkey then appears in your list, where you can rename or remove it.

## Signing in
- On the sign-in page, choose "Sign in with a passkey".
- If you enter your email first, the ceremony targets that account; you can also let your device choose a discoverable credential.
- Approve the prompt on your device and you are signed in.

## Notes
- Passkey registration and removal always require your current password.
- During an active support session, passkey changes are refused for your protection.
- Attestation formats other than "none" are currently refused, which covers all common platform authenticators.`,
  },
  {
    kind: 'kb', slug: 'enable-two-factor-authentication', title: 'Enabling two-factor authentication (TOTP)',
    category: 'Account', summary: 'Add a time-based one-time code to your sign-in using any standard authenticator app.',
    body: `## How it works
CloudHost247 supports TOTP two-factor authentication. Your account stores a secret; your authenticator app turns it into a rotating 6-digit code that sign-in requires in addition to your password.

## Enrolling
- Open the Security page in the client area.
- Start TOTP enrolment; the page shows a QR code and an otpauth URI.
- Scan the QR code with your authenticator app (Google Authenticator, Aegis, 1Password and similar all work).
- Enter the current 6-digit code to confirm. Two-factor is active only after confirmation succeeds.

## Signing in afterwards
Enter your password, then the current code when prompted. Codes rotate every 30 seconds; a code is accepted with a small clock-skew tolerance.

## Disabling
Disabling requires your account password and is done from the same Security page.`,
  },
  {
    kind: 'kb', slug: 'understanding-invoices-and-billing-cycles', title: 'Understanding invoices and billing cycles',
    category: 'Billing', summary: 'How orders become invoices, what balances mean, and how payments settle.',
    body: `## From cart to invoice
When you check out, the platform turns your cart into an order and issues an invoice in one server-side transaction. Prices are re-read from the catalog at that moment — the cart display is never trusted for billing.

## Billing cycles
Plans are priced per billing cycle (for example monthly or annual). The cycle you choose at add-to-cart is the one invoiced, and subscriptions renew on that cycle.

## Balances and payments
- An invoice's balance is its total minus settled payments.
- The payment methods shown on an invoice are the gateways actually configured for this deployment; nothing invented is ever listed.
- When a payment settles — confirmed through the gateway's own verification — the invoice balance updates automatically.

## Where to look
The Billing page lists invoices, subscriptions and your ledger. Each invoice has its own detail page with line items, ledger entries and payment actions.`,
  },
  {
    kind: 'kb', slug: 'how-domain-search-works', title: 'How domain search works (and what "estimate" means)',
    category: 'Domains', summary: 'What the domain search checks today, and when it becomes a live registry check.',
    body: `## What happens when you search
The search endpoint evaluates your name and returns suggestions. Until a registrar/RDAP connector is configured for this deployment, results are structural estimates — and the page says so explicitly.

## Why estimates are labeled
A claim of "available" is only trustworthy when it comes from the registry. The platform refuses to present guesses as registry answers; the readiness endpoint reports honestly whether a live connector exists.

## Extension pricing
Prices shown for extensions come from the platform's configured extension pricing. If an extension you need is not listed, its pricing has not been configured yet — contact us and we will set it up.

## Registering
Registration runs through your client area: the domain is queued for provisioning and its status is tracked on your Domains page.`,
  },
  {
    kind: 'kb', slug: 'reading-the-status-page', title: 'Reading the status page',
    category: 'Technical Support', summary: 'What "operational", "unmonitored" and the verified checks actually mean.',
    body: `## Verified checks
When you load the status page it performs live checks it can genuinely perform: the website answering, the API answering, and the platform storage ping. Each result reflects that moment.

## Unmonitored components
Components such as hosting, DNS and billing are listed as "unmonitored" until a monitoring integration is wired in. We do not display uptime numbers or "all systems operational" banners that no measurement backs.

## During an incident
A failing verified check appears immediately as an error state on the page. Platform-level issues are also communicated through support.`,
  },
  {
    kind: 'kb', slug: 'get-started-with-your-first-service', title: 'Getting started: order your first service',
    category: 'Hosting', summary: 'The full journey from catalog to a running service in your client area.',
    body: `## 1. Choose a product
Browse the catalog — every plan shown has real configured pricing. Pick a billing cycle and add the plan to your cart.

## 2. Review the cart
Check items, quantities and cycle. Totals are recalculated server-side at checkout.

## 3. Check out
Checkout accepts the terms of service and turns your cart into an order plus an invoice.

## 4. Pay
Pay the invoice with one of the configured payment methods. The sandbox gateway is available in non-production environments for testing the flow.

## 5. Track provisioning
Once payment settles, provisioning jobs run for your service. Progress and results appear under Services in the client area.`,
  },
  {
    kind: 'blog', slug: 'introducing-the-cloudhost247-platform', title: 'Introducing the CloudHost247 platform',
    category: 'CloudHost247 News', summary: 'What we built, why we built it, and what "honest infrastructure" means for this site.',
    body: `## A platform, not a template
CloudHost247 now runs on its own platform: one account for hosting, domains, billing and support, with an API-first backend and a client area built for the whole journey — catalog, cart, checkout, payment, provisioning, dashboard.

## Honest by design
You will notice things other hosting sites hide:
- Prices shown here are read live from the configured catalog. Where a service has no plans yet, we say so.
- The status page reports verified checks only; unmonitored components are labeled as such.
- Server locations are the regions actually configured on the platform — no invented data centers.
- Contact details appear when they are published through our official configuration, never before.

## What's next
Infrastructure regions, payment providers and monitoring integrations come online as they are configured and verified — and each one will show up on this site the moment it is real.`,
  },
];

// Reference domain-extension pricing for development (USD cents). Idempotent upsert by TLD —
// operators manage real pricing through the admin domain-services screens; this only gives a
// fresh development store data to render.
const DOMAIN_EXTENSIONS = [
  { tld: 'com', register_price_cents: 1299, renew_price_cents: 1499 },
  { tld: 'net', register_price_cents: 1399, renew_price_cents: 1599 },
  { tld: 'org', register_price_cents: 1199, renew_price_cents: 1399 },
  { tld: 'io', register_price_cents: 3999, renew_price_cents: 4499 },
  { tld: 'co', register_price_cents: 2799, renew_price_cents: 2999 },
  { tld: 'cloud', register_price_cents: 2199, renew_price_cents: 2499 },
  { tld: 'online', register_price_cents: 999, renew_price_cents: 3299 },
];

async function upsertBy(store, table, keyColumn, keyValue, create) {
  const existing = await store.table(table).findOne({ [keyColumn]: keyValue });
  if (existing) return existing;
  return store.table(table).insert(create);
}

async function main() {
  const { config, warnings } = loadConfig({ cwd: path.join(__dirname, '..') });
  const logger = createLogger({ level: config.LOG_LEVEL, base: { tool: 'seed' } });
  for (const w of warnings) logger.warn(w);

  const store = await createStore(config, logger);
  await store.connect();

  // --- roles ---------------------------------------------------------------
  for (const [name, description] of ROLES) {
    await upsertBy(store, 'roles', 'name', name, { id: uuidv7(), name, description });
  }

  // --- catalog -------------------------------------------------------------
  let products = 0;
  let plans = 0;

  for (const product of CATALOG) {
    const row = await upsertBy(store, 'catalog_products', 'slug', product.slug, {
      id: uuidv7(),
      slug: product.slug,
      name: product.name,
      category: product.category,
      description: product.description,
      status: 'active',
    });
    products += 1;

    for (const plan of product.plans) {
      const planRow = await upsertBy(store, 'catalog_product_plans', 'slug', plan.slug, {
        id: uuidv7(),
        product_id: row.id,
        slug: plan.slug,
        name: plan.name,
        status: plan.status,
        limits: plan.limits,
      });
      plans += 1;

      for (const price of plan.pricing) {
        const existingPrice = await store.table('catalog_plan_pricing').findOne({
          plan_id: planRow.id,
          currency: 'USD',
          billing_cycle: price.billingCycle,
        });
        if (!existingPrice) {
          await store.table('catalog_plan_pricing').insert({
            id: uuidv7(),
            plan_id: planRow.id,
            currency: 'USD',
            billing_cycle: price.billingCycle,
            price: price.price,
            setup_fee: 0,
            is_active: true,
          });
        }
      }

      for (let i = 0; i < plan.features.length; i += 1) {
        const label = plan.features[i];
        const existingFeature = await store.table('catalog_plan_features').findOne({
          plan_id: planRow.id,
          label,
        });
        if (!existingFeature) {
          await store.table('catalog_plan_features').insert({
            id: uuidv7(),
            plan_id: planRow.id,
            label,
            value: null,
            sort_order: i,
          });
        }
      }
    }
  }

  // --- domain extensions ----------------------------------------------------
  let extensions = 0;
  for (const ext of DOMAIN_EXTENSIONS) {
    await upsertBy(store, 'domain_extensions', 'tld', ext.tld, {
      id: uuidv7(),
      ...ext,
    });
    extensions += 1;
  }

  // --- knowledgebase / blog articles -----------------------------------------
  let articlesSeeded = 0;
  const publishedAt = new Date().toISOString();
  for (const article of ARTICLES) {
    await upsertBy(store, 'site_articles', 'slug', article.slug, {
      id: uuidv7(),
      kind: article.kind,
      slug: article.slug,
      title: article.title,
      category: article.category,
      author: 'CloudHost247 Team',
      summary: article.summary,
      body: article.body,
      status: 'published',
      search_keywords: null,
      published_at: publishedAt,
    });
    articlesSeeded += 1;
  }

  // --- application marketplace catalog --------------------------------------
  // Source of truth: the real deployment manifests in cloudhost247-node/manifests
  // (extracted once into scripts/app-catalog.json). Only these are advertised.
  let applications = 0;
  const appCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'app-catalog.json'), 'utf8'));
  for (const app of appCatalog) {
    await upsertBy(store, 'marketplace_applications', 'slug', app.slug, {
      id: uuidv7(),
      slug: app.slug,
      name: app.name,
      category: app.category || 'general',
      summary: app.description || null,
      featured: app.featured === true,
      hosting_types: app.hosting ?? [],
      status: 'active',
    });
    applications += 1;
  }
  // Control panels and OS entries are intentionally NOT seeded: they publish
  // only when an operator configures real, provisioned entries via the admin API.

  await store.flush?.();
  logger.info({ products, plans, extensions, articles: articlesSeeded, applications, backend: store.backend }, 'seed complete');
  await store.close();
}

main().catch((err) => {
  process.stderr.write(`[seed] fatal: ${err.message}\n`);
  process.exit(1);
});
