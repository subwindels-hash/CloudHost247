/**
 * DEVELOPMENT PREVIEW ONLY — never imported by the production server or the cPanel package.
 *
 * The `tools-preview-server.ts` harness runs the real application against an in-memory PGlite
 * database. Migrations create the catalogue tables but deliberately seed **no** products or
 * prices (the platform's rule is "never invent a price"). That leaves the public pricing pages
 * empty, which is honest but makes it impossible to review a pricing layout locally.
 *
 * This file seeds a small, clearly-labelled demo catalogue into that in-memory database only, so
 * the tabbed pricing cards on the homepage are exercised against the real public API with real
 * `SELECT`s, DTO mapping, currency formatting and empty-state handling. Nothing here is written
 * to a production database, and the preview process discards it on exit.
 */
import { randomUUID } from 'node:crypto';
import type { DbClient } from '../database/db-client';

interface DemoPlan {
  slug: string;
  name: string;
  description: string;
  amount: number;
  features: Array<[string, string]>;
}

interface DemoProduct {
  slug: string;
  name: string;
  description: string;
  plans: DemoPlan[];
}

const DEMO_CATALOGUE: DemoProduct[] = [
  {
    slug: 'web-hosting',
    name: 'Web Hosting',
    description: 'Shared hosting for websites of every size, with mailboxes, databases and a free SSL certificate.',
    plans: [
      {
        slug: 'starter', name: 'Starter', amount: 2.99,
        description: 'For a first website, portfolio or landing page.',
        features: [
          ['Websites', '1'], ['SSD storage', '20 GB'], ['Free SSL certificate', 'Included'],
          ['Mailboxes', '2'], ['Weekly backups', 'Included'], ['One-click app installs', 'Included'],
        ],
      },
      {
        slug: 'business', name: 'Business', amount: 4.99,
        description: 'More room for a growing business site or blog.',
        features: [
          ['Websites', '10'], ['NVMe storage', '50 GB'], ['Free SSL certificate', 'Included'],
          ['Mailboxes', 'Unlimited'], ['Daily backups', 'Included'], ['Staging environment', 'Included'],
          ['CDN', 'Included'],
        ],
      },
      {
        slug: 'pro', name: 'Pro', amount: 8.99,
        description: 'Higher limits and priority handling for busy sites.',
        features: [
          ['Websites', 'Unlimited'], ['NVMe storage', '100 GB'], ['Free SSL certificate', 'Included'],
          ['Mailboxes', 'Unlimited'], ['Daily + on-demand backups', 'Included'], ['Staging environment', 'Included'],
          ['CDN', 'Included'], ['Priority support', 'Included'],
        ],
      },
    ],
  },
  {
    slug: 'vps-hosting',
    name: 'VPS Hosting',
    description: 'Virtual servers with full root access, predictable resources and a choice of operating systems.',
    plans: [
      {
        slug: 'kvm-1', name: 'KVM 1', amount: 6.99,
        description: 'A small server for a side project or a lightweight API.',
        features: [
          ['vCPU', '1'], ['Memory', '2 GB'], ['NVMe storage', '40 GB'],
          ['Bandwidth', '2 TB'], ['Full root access', 'Included'], ['Snapshots', 'Available'],
        ],
      },
      {
        slug: 'kvm-2', name: 'KVM 2', amount: 12.99,
        description: 'Room for a production application and its database.',
        features: [
          ['vCPU', '2'], ['Memory', '4 GB'], ['NVMe storage', '80 GB'],
          ['Bandwidth', '4 TB'], ['Full root access', 'Included'], ['Snapshots', 'Available'],
          ['Firewall management', 'Included'],
        ],
      },
      {
        slug: 'kvm-4', name: 'KVM 4', amount: 24.99,
        description: 'For heavier workloads, build agents and multiple services.',
        features: [
          ['vCPU', '4'], ['Memory', '8 GB'], ['NVMe storage', '160 GB'],
          ['Bandwidth', '8 TB'], ['Full root access', 'Included'], ['Snapshots', 'Available'],
          ['Firewall management', 'Included'], ['Monitoring', 'Included'],
        ],
      },
    ],
  },
  {
    slug: 'cloud-hosting',
    name: 'Cloud Hosting',
    description: 'Scalable cloud instances with managed backups, monitoring and a restore path you can inspect.',
    plans: [
      {
        slug: 'cloud-2', name: 'Cloud 2', amount: 14.99,
        description: 'A managed instance for a production service.',
        features: [
          ['vCPU', '2'], ['Memory', '4 GB'], ['NVMe storage', '80 GB'],
          ['Managed backups', 'Included'], ['Monitoring', 'Included'], ['Private networking', 'Available'],
        ],
      },
      {
        slug: 'cloud-4', name: 'Cloud 4', amount: 29.99,
        description: 'More compute for a busier application or several services.',
        features: [
          ['vCPU', '4'], ['Memory', '8 GB'], ['NVMe storage', '160 GB'],
          ['Managed backups', 'Included'], ['Monitoring', 'Included'], ['Private networking', 'Available'],
          ['Dedicated IP', 'Included'],
        ],
      },
      {
        slug: 'cloud-8', name: 'Cloud 8', amount: 59.99,
        description: 'High-traffic workloads with headroom to scale.',
        features: [
          ['vCPU', '8'], ['Memory', '16 GB'], ['NVMe storage', '320 GB'],
          ['Managed backups', 'Included'], ['Monitoring', 'Included'], ['Private networking', 'Available'],
          ['Dedicated IP', 'Included'], ['Priority support', 'Included'],
        ],
      },
    ],
  },
];

export async function seedPreviewCatalog(client: DbClient): Promise<number> {
  let inserted = 0;

  for (const product of DEMO_CATALOGUE) {
    const existing = await client.query<{ id: string }>('SELECT id FROM products WHERE slug = $1', [product.slug]);
    if (existing.rows[0]) continue;

    const productId = randomUUID();
    await client.query(
      `INSERT INTO products (id, slug, name, description, product_type, status, visibility, display_order)
       VALUES ($1, $2, $3, $4, 'hosting', 'active', 'public', $5)`,
      [productId, product.slug, product.name, product.description, inserted]
    );

    for (const [planIndex, plan] of product.plans.entries()) {
      const planId = randomUUID();
      await client.query(
        `INSERT INTO product_plans (id, product_id, slug, name, description, status, billing_model, display_order)
         VALUES ($1, $2, $3, $4, $5, 'active', 'recurring', $6)`,
        [planId, productId, plan.slug, plan.name, plan.description, planIndex]
      );
      await client.query(
        `INSERT INTO plan_pricing (id, plan_id, billing_period, currency, amount, effective_status)
         VALUES ($1, $2, 'monthly', 'USD', $3, 'published')`,
        [randomUUID(), planId, plan.amount]
      );
      for (const [featureIndex, [name, value]] of plan.features.entries()) {
        await client.query(
          `INSERT INTO plan_features (id, plan_id, feature_name, feature_value, display_order, visibility)
           VALUES ($1, $2, $3, $4, $5, 'public')`,
          [randomUUID(), planId, name, value, featureIndex]
        );
      }
      inserted += 1;
    }
  }

  return inserted;
}
