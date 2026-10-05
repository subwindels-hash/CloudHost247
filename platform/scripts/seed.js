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

  await store.flush?.();
  logger.info({ products, plans, backend: store.backend }, 'seed complete');
  await store.close();
}

main().catch((err) => {
  process.stderr.write(`[seed] fatal: ${err.message}\n`);
  process.exit(1);
});
