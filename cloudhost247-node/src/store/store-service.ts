/**
 * CloudHost247 Online Store — merchant catalogue, shopper orders, fulfilment and digital delivery.
 *
 * Scope boundary (see database/migrations/0074): `orders`/`invoices` remain the PLATFORM's billing
 * records for CloudHost247's own customers. A shopper buying from a merchant's store is a different
 * commercial relationship, so shopper orders live in `store_orders`. They are not a second billing
 * engine: nothing here invoices through the platform billing stack, and no platform subscription is
 * derived from a shopper order.
 *
 * Two honesty rules are enforced in code, not just in copy:
 *
 *   1. **Digital products are never shipped.** A `digital` product must have a stored file
 *      (a database CHECK enforces it), its order line gets a fulfilment row marked `delivered` with
 *      a real expiring download token, and it is excluded from every shipping calculation. A
 *      physical line, conversely, cannot be checked out without an address.
 *   2. **Payment is only ever "paid" because a provider said so.** `recordPaymentEvent` is the only
 *      function that can set `payment_status = 'paid'`, it is idempotent per provider reference,
 *      and until a provider is connected the store runs in `order_intake` mode where the customer
 *      is told plainly that payment will be arranged directly.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { downloadLink, sendTransactionalEmail } from '../lib/transactional-email';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';
import { createNotification } from '../services/notification-service';
import { getStoreLimits } from '../builders/entitlements';
import { decodeAndValidateUpload, MAX_DIGITAL_PRODUCT_BYTES } from '../lib/media-upload';
import { normalizePath } from '../builders/site-service';

export interface StoreRow {
  id: string;
  user_id: string;
  site_id: string | null;
  name: string;
  slug: string;
  description: string;
  currency: string;
  status: 'draft' | 'active' | 'suspended';
  payment_mode: 'order_intake' | 'provider';
  settings: Record<string, unknown>;
  theme: Record<string, unknown>;
  plan_code: string;
  subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

function slugify(input: string): string {
  const base = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return base.length >= 2 ? base : `store-${randomBytes(3).toString('hex')}`;
}

function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function toCents(value: string | number): number {
  return Math.round(Number(value) * 100);
}

/* --------------------------------------------------------------------------------------------
 * Stores
 * ------------------------------------------------------------------------------------------ */

export async function listStores(db: Queryable, userId: string): Promise<StoreRow[]> {
  const { rows } = await db.query<StoreRow>(`SELECT * FROM store_stores WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
  return rows;
}

export async function requireOwnedStore(db: Queryable, userId: string, storeId: string): Promise<StoreRow> {
  const { rows } = await db.query<StoreRow>(`SELECT * FROM store_stores WHERE id = $1 LIMIT 1`, [storeId]);
  const store = rows[0];
  if (!store || store.user_id !== userId) throw new NotFoundError('No store was found with that id');
  return store;
}

export async function createStore(
  db: Queryable,
  userId: string,
  input: { name: string; description?: string; siteId?: string | null; currency?: string }
): Promise<StoreRow> {
  const limits = await getStoreLimits(db, userId);
  const existing = await listStores(db, userId);
  if (existing.length >= limits.stores) {
    throw new ForbiddenError(
      `Your CloudHost247 plan includes ${limits.stores} store${limits.stores === 1 ? '' : 's'}. Upgrade to open another.`
    );
  }
  if (input.siteId) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM builder_sites WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [input.siteId, userId]
    );
    if (!rows[0]) throw new NotFoundError('That website is not on your account');
  }

  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError('Give the store a name of at least 2 characters');
  const currency = (input.currency ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ValidationError('Currency must be a 3-letter ISO code');

  let slug = slugify(name);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM store_stores WHERE lower(slug) = $1 LIMIT 1`, [slug]);
    if (!rows[0]) break;
    slug = `${slugify(name).slice(0, 52)}-${randomBytes(2).toString('hex')}`;
  }

  const { rows } = await db.query<StoreRow>(
    `INSERT INTO store_stores (id, user_id, site_id, name, slug, description, currency)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [randomUUID(), userId, input.siteId ?? null, name, slug, (input.description ?? '').slice(0, 2000), currency]
  );
  const store = rows[0];
  if (!store) throw new Error('Store creation failed');
  return store;
}

export async function updateStore(
  db: Queryable,
  userId: string,
  storeId: string,
  patch: {
    name?: string;
    description?: string;
    status?: 'draft' | 'active' | 'suspended';
    paymentMode?: 'order_intake' | 'provider';
    settings?: Record<string, unknown>;
    theme?: Record<string, unknown>;
  }
): Promise<StoreRow> {
  const store = await requireOwnedStore(db, userId, storeId);
  if (patch.status === 'active' && store.payment_mode === 'order_intake') {
    // Not a blocker — a merchant may legitimately take orders and arrange payment directly — but
    // the mode is reported back exactly as it is, so the storefront can say so.
  }
  const { rows } = await db.query<StoreRow>(
    `UPDATE store_stores SET
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        status = COALESCE($4, status),
        payment_mode = COALESCE($5, payment_mode),
        settings = COALESCE($6, settings),
        theme = COALESCE($7, theme),
        updated_at = now()
      WHERE id = $1 RETURNING *`,
    [
      store.id,
      patch.name?.trim() || null,
      patch.description ?? null,
      patch.status ?? null,
      patch.paymentMode ?? null,
      patch.settings === undefined ? null : JSON.stringify(patch.settings),
      patch.theme === undefined ? null : JSON.stringify(patch.theme),
    ]
  );
  const updated = rows[0];
  if (!updated) throw new NotFoundError('No store was found with that id');
  return updated;
}

/* --------------------------------------------------------------------------------------------
 * Products
 * ------------------------------------------------------------------------------------------ */

export interface ProductInput {
  kind: 'physical' | 'digital' | 'service';
  name: string;
  slug?: string;
  description?: string;
  priceAmount: number;
  compareAtAmount?: number | null;
  sku?: string | null;
  trackInventory?: boolean;
  inventoryQuantity?: number;
  weightGrams?: number | null;
  downloadLimit?: number;
  downloadExpiryDays?: number;
  metadata?: Record<string, unknown>;
  /** Digital asset; required for `kind: 'digital'` unless the product already has one. */
  download?: { filename: string; contentType: string; base64: string } | null;
}

export async function listProducts(db: Queryable, storeId: string, includeArchived = false) {
  const { rows } = await db.query(
    `SELECT p.id, p.kind, p.name, p.slug, p.description, p.status, p.sku, p.price_amount, p.currency,
            p.compare_at_amount, p.track_inventory, p.inventory_quantity, p.requires_shipping,
            p.weight_grams, p.download_filename, p.download_byte_size, p.download_limit, p.download_expiry_days,
            p.metadata, p.created_at, p.updated_at,
            (SELECT count(*)::int FROM store_product_variants v WHERE v.product_id = p.id AND v.status = 'active') AS variant_count,
            (SELECT count(*)::int FROM store_order_items i WHERE i.product_id = p.id) AS order_count
       FROM store_products p
      WHERE p.store_id = $1 ${includeArchived ? '' : `AND p.status <> 'archived'`}
      ORDER BY p.created_at DESC`,
    [storeId]
  );
  return rows;
}

export async function createProduct(db: Queryable, userId: string, storeId: string, input: ProductInput) {
  const store = await requireOwnedStore(db, userId, storeId);
  const limits = await getStoreLimits(db, userId);
  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM store_products WHERE store_id = $1 AND status <> 'archived'`,
    [store.id]
  );
  if (Number(countRows[0]?.count ?? '0') >= limits.productsPerStore) {
    throw new ForbiddenError(
      `Your CloudHost247 plan includes ${limits.productsPerStore} products per store. Upgrade to add more.`
    );
  }

  const name = input.name.trim();
  if (name.length < 1) throw new ValidationError('A product needs a name');
  if (!(input.priceAmount >= 0)) throw new ValidationError('A product needs a price of 0 or more');
  if (input.kind === 'digital' && !input.download) {
    throw new ValidationError('A digital product needs a downloadable file before it can be saved');
  }
  if (input.kind === 'physical' && !(input.weightGrams && input.weightGrams > 0)) {
    // Not fatal, but a physical product's weight is what shipping is priced on; say so rather than
    // silently shipping something the platform cannot weigh.
    throw new ValidationError('A physical product needs a weight in grams so shipping can be quoted');
  }

  let asset: { filename: string; contentType: string; data: Buffer; byteSize: number; checksum: string } | null = null;
  if (input.download) {
    const validated = decodeAndValidateUpload(
      input.download.base64,
      input.download.contentType,
      input.download.filename,
      MAX_DIGITAL_PRODUCT_BYTES
    );
    asset = {
      filename: validated.filename,
      contentType: validated.contentType,
      data: validated.data,
      byteSize: validated.byteSize,
      checksum: validated.checksum,
    };
  }

  const slug = slugify(input.slug ?? name);
  const { rows: clash } = await db.query<{ id: string }>(
    `SELECT id FROM store_products WHERE store_id = $1 AND lower(slug) = lower($2) LIMIT 1`,
    [store.id, slug]
  );
  if (clash[0]) throw new ConflictError('This store already has a product with that URL');

  const { rows } = await db.query(
    `INSERT INTO store_products
       (id, store_id, kind, name, slug, description, status, sku, price_amount, currency, compare_at_amount,
        track_inventory, inventory_quantity, requires_shipping, weight_grams,
        download_filename, download_content_type, download_byte_size, download_checksum, download_data,
        download_limit, download_expiry_days, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING id, kind, name, slug, status, price_amount, currency, requires_shipping, download_filename, created_at`,
    [
      randomUUID(),
      store.id,
      input.kind,
      name,
      slug,
      (input.description ?? '').slice(0, 8000),
      input.sku ?? null,
      money(input.priceAmount),
      store.currency,
      input.compareAtAmount === undefined || input.compareAtAmount === null ? null : money(input.compareAtAmount),
      input.trackInventory ?? false,
      Math.max(0, Math.trunc(input.inventoryQuantity ?? 0)),
      input.kind === 'physical',
      input.weightGrams ?? null,
      asset?.filename ?? null,
      asset?.contentType ?? null,
      asset?.byteSize ?? null,
      asset?.checksum ?? null,
      asset?.data ?? null,
      input.downloadLimit ?? 5,
      input.downloadExpiryDays ?? 30,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  return rows[0];
}

export async function updateProduct(
  db: Queryable,
  userId: string,
  productId: string,
  patch: Partial<ProductInput> & { status?: 'draft' | 'active' | 'archived' }
) {
  const { rows: ownerRows } = await db.query<{ store_id: string; kind: string; download_filename: string | null }>(
    `SELECT store_id, kind, download_filename FROM store_products WHERE id = $1 LIMIT 1`,
    [productId]
  );
  const product = ownerRows[0];
  if (!product) throw new NotFoundError('No product was found with that id');
  await requireOwnedStore(db, userId, product.store_id);

  let asset: { filename: string; contentType: string; data: Buffer; byteSize: number; checksum: string } | null = null;
  if (patch.download) {
    const validated = decodeAndValidateUpload(
      patch.download.base64,
      patch.download.contentType,
      patch.download.filename,
      MAX_DIGITAL_PRODUCT_BYTES
    );
    asset = {
      filename: validated.filename,
      contentType: validated.contentType,
      data: validated.data,
      byteSize: validated.byteSize,
      checksum: validated.checksum,
    };
  }
  if (product.kind === 'digital' && patch.status === 'active' && !asset && !product.download_filename) {
    throw new ValidationError('A digital product needs a downloadable file before it can be published');
  }

  const { rows } = await db.query(
    `UPDATE store_products SET
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        status = COALESCE($4, status),
        sku = CASE WHEN $5::boolean THEN $6 ELSE sku END,
        price_amount = COALESCE($7, price_amount),
        compare_at_amount = CASE WHEN $8::boolean THEN $9 ELSE compare_at_amount END,
        track_inventory = COALESCE($10, track_inventory),
        inventory_quantity = COALESCE($11, inventory_quantity),
        weight_grams = CASE WHEN $12::boolean THEN $13 ELSE weight_grams END,
        download_filename = COALESCE($14, download_filename),
        download_content_type = COALESCE($15, download_content_type),
        download_byte_size = COALESCE($16, download_byte_size),
        download_checksum = COALESCE($17, download_checksum),
        download_data = COALESCE($18, download_data),
        download_limit = COALESCE($19, download_limit),
        download_expiry_days = COALESCE($20, download_expiry_days),
        metadata = COALESCE($21, metadata),
        updated_at = now()
      WHERE id = $1
      RETURNING id, kind, name, slug, status, price_amount, currency, inventory_quantity, track_inventory, requires_shipping, created_at`,
    [
      productId,
      patch.name?.trim() || null,
      patch.description ?? null,
      patch.status ?? null,
      Object.prototype.hasOwnProperty.call(patch, 'sku'),
      patch.sku ?? null,
      patch.priceAmount === undefined ? null : money(patch.priceAmount),
      Object.prototype.hasOwnProperty.call(patch, 'compareAtAmount'),
      patch.compareAtAmount === undefined || patch.compareAtAmount === null ? null : money(patch.compareAtAmount),
      patch.trackInventory ?? null,
      patch.inventoryQuantity === undefined ? null : Math.max(0, Math.trunc(patch.inventoryQuantity)),
      Object.prototype.hasOwnProperty.call(patch, 'weightGrams'),
      patch.weightGrams ?? null,
      asset?.filename ?? null,
      asset?.contentType ?? null,
      asset?.byteSize ?? null,
      asset?.checksum ?? null,
      asset?.data ?? null,
      patch.downloadLimit ?? null,
      patch.downloadExpiryDays ?? null,
      patch.metadata === undefined ? null : JSON.stringify(patch.metadata),
    ]
  );
  return rows[0];
}

export async function adjustInventory(
  db: Queryable,
  userId: string,
  productId: string,
  delta: number,
  reason: 'restock' | 'adjustment',
  actorId: string
) {
  const { rows: ownerRows } = await db.query<{ store_id: string; inventory_quantity: number }>(
    `SELECT store_id, inventory_quantity FROM store_products WHERE id = $1 LIMIT 1`,
    [productId]
  );
  const product = ownerRows[0];
  if (!product) throw new NotFoundError('No product was found with that id');
  const store = await requireOwnedStore(db, userId, product.store_id);
  const next = Math.max(0, product.inventory_quantity + delta);

  await withTransaction(db, async (tx) => {
    await tx.query(`UPDATE store_products SET inventory_quantity = $2, updated_at = now() WHERE id = $1`, [productId, next]);
    await tx.query(
      `INSERT INTO store_inventory_movements (id, store_id, product_id, delta, quantity_after, reason, actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), store.id, productId, next - product.inventory_quantity, next, reason, actorId]
    );
  });
  return { inventoryQuantity: next };
}

/* --------------------------------------------------------------------------------------------
 * Discounts, shipping and tax (all merchant-configured; nothing is guessed)
 * ------------------------------------------------------------------------------------------ */

export async function createDiscount(
  db: Queryable,
  userId: string,
  storeId: string,
  input: { code: string; kind: 'percentage' | 'fixed'; value: number; minOrderAmount?: number | null; maxRedemptions?: number | null; endsAt?: string | null }
) {
  const store = await requireOwnedStore(db, userId, storeId);
  const code = input.code.trim().toUpperCase().slice(0, 40);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new ValidationError('A discount code must be 3–40 characters: letters, numbers, - or _');
  if (!(input.value > 0)) throw new ValidationError('A discount needs a value greater than zero');
  if (input.kind === 'percentage' && input.value > 100) throw new ValidationError('A percentage discount cannot exceed 100%');

  const { rows } = await db.query(
    `INSERT INTO store_discount_codes (id, store_id, code, kind, value, currency, min_order_amount, max_redemptions, ends_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (store_id, upper(code)) DO NOTHING
     RETURNING id, code, kind, value, currency, min_order_amount, max_redemptions, ends_at, status`,
    [
      randomUUID(),
      store.id,
      code,
      input.kind,
      money(input.value),
      store.currency,
      input.minOrderAmount === undefined || input.minOrderAmount === null ? null : money(input.minOrderAmount),
      input.maxRedemptions ?? null,
      input.endsAt ?? null,
    ]
  );
  if (!rows[0]) throw new ConflictError('This store already has a discount with that code');
  return rows[0];
}

export async function listDiscounts(db: Queryable, userId: string, storeId: string) {
  await requireOwnedStore(db, userId, storeId);
  const { rows } = await db.query(
    `SELECT id, code, kind, value, currency, min_order_amount, max_redemptions, redemptions, starts_at, ends_at, status
       FROM store_discount_codes WHERE store_id = $1 ORDER BY created_at DESC`,
    [storeId]
  );
  return rows;
}

export async function createShippingMethod(
  db: Queryable,
  userId: string,
  storeId: string,
  input: { name: string; description?: string; priceAmount: number; countries?: string[]; minOrderAmount?: number | null }
) {
  const store = await requireOwnedStore(db, userId, storeId);
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new ValidationError('A shipping method needs a name');
  if (!(input.priceAmount >= 0)) throw new ValidationError('A shipping price cannot be negative');
  const countries = (input.countries ?? [])
    .map((country) => country.trim().toUpperCase())
    .filter((country) => /^[A-Z]{2}$/.test(country))
    .slice(0, 250);
  const { rows } = await db.query(
    `INSERT INTO store_shipping_methods (id, store_id, name, description, price_amount, currency, countries, min_order_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, name, description, price_amount, currency, countries, min_order_amount, status`,
    [
      randomUUID(),
      store.id,
      name,
      (input.description ?? '').slice(0, 255),
      money(input.priceAmount),
      store.currency,
      JSON.stringify(countries),
      input.minOrderAmount === undefined || input.minOrderAmount === null ? null : money(input.minOrderAmount),
    ]
  );
  return rows[0];
}

export async function createTaxRate(
  db: Queryable,
  userId: string,
  storeId: string,
  input: { name: string; countryCode: string; region?: string | null; ratePercent: number; includesShipping?: boolean }
) {
  const store = await requireOwnedStore(db, userId, storeId);
  const countryCode = input.countryCode.trim().toUpperCase() === '*' ? '*' : input.countryCode.trim().toUpperCase();
  if (countryCode !== '*' && !/^[A-Z]{2}$/.test(countryCode)) throw new ValidationError('Country must be a 2-letter ISO code, or * for a store-wide default');
  if (!(input.ratePercent >= 0 && input.ratePercent <= 100)) throw new ValidationError('A tax rate must be between 0 and 100 percent');
  const { rows } = await db.query(
    `INSERT INTO store_tax_rates (id, store_id, name, country_code, region, rate_percent, includes_shipping)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, name, country_code, region, rate_percent, includes_shipping, status`,
    [
      randomUUID(),
      store.id,
      input.name.trim().slice(0, 120) || 'Tax',
      countryCode,
      input.region?.slice(0, 80) ?? null,
      input.ratePercent,
      input.includesShipping ?? false,
    ]
  );
  return rows[0];
}

/* --------------------------------------------------------------------------------------------
 * Public storefront + checkout
 * ------------------------------------------------------------------------------------------ */

export async function getPublicStore(db: Queryable, slug: string) {
  const { rows } = await db.query<StoreRow>(
    `SELECT * FROM store_stores WHERE lower(slug) = lower($1) AND status = 'active' LIMIT 1`,
    [slug]
  );
  const store = rows[0];
  if (!store) return null;
  const { rows: products } = await db.query(
    `SELECT p.id, p.kind, p.name, p.slug, p.description, p.price_amount, p.currency, p.compare_at_amount,
            p.inventory_quantity, p.track_inventory, p.requires_shipping, p.weight_grams,
            (p.download_filename IS NOT NULL) AS is_downloadable,
            (SELECT json_agg(json_build_object('id', v.id, 'name', v.name, 'price', v.price_amount, 'options', v.options)
                             ORDER BY v.sort_order)
               FROM store_product_variants v WHERE v.product_id = p.id AND v.status = 'active') AS variants
       FROM store_products p
      WHERE p.store_id = $1 AND p.status = 'active'
      ORDER BY p.created_at DESC`,
    [store.id]
  );
  const { rows: shipping } = await db.query(
    `SELECT id, name, description, price_amount, currency, countries, min_order_amount
       FROM store_shipping_methods WHERE store_id = $1 AND status = 'active' ORDER BY sort_order`,
    [store.id]
  );
  const { rows: tax } = await db.query(
    `SELECT country_code, region, rate_percent, includes_shipping FROM store_tax_rates
      WHERE store_id = $1 AND status = 'active'`,
    [store.id]
  );
  return { store, products, shippingMethods: shipping, taxRates: tax };
}

export interface CheckoutItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

export interface ShopperCheckoutInput {
  items: CheckoutItemInput[];
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  shippingMethodId?: string | null;
  shippingAddress?: Record<string, string> | null;
  discountCode?: string | null;
  notes?: string | null;
}

/**
 * Places a shopper order. Everything money-related is computed here from the merchant's own stored
 * prices: the client sends product ids and quantities, never amounts. Stock is decremented under a
 * transaction with a guarded UPDATE, so two simultaneous buyers cannot oversell the last unit.
 */
export async function placeShopperOrder(
  db: Queryable,
  storeSlug: string,
  input: ShopperCheckoutInput,
  context: { sourceIp?: string | null } = {}
) {
  const storefront = await getPublicStore(db, storeSlug);
  if (!storefront) throw new NotFoundError('No store was found at that address');
  const store = storefront.store;

  if (!input.items.length) throw new ValidationError('Your cart is empty');
  if (input.items.length > 50) throw new ValidationError('Too many lines in one order');
  const name = input.customerName.trim().slice(0, 200);
  const email = input.customerEmail.trim().toLowerCase().slice(0, 255);
  if (name.length < 2) throw new ValidationError('Enter your name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError('Enter a valid email address');

  const orderId = randomUUID();

  const result = await withTransaction(db, async (tx) => {
    const lines: Array<{
      productId: string;
      variantId: string | null;
      name: string;
      variantName: string | null;
      kind: 'physical' | 'digital' | 'service';
      quantity: number;
      unitCents: number;
      requiresShipping: boolean;
    }> = [];

    for (const item of input.items) {
      const quantity = Math.trunc(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
        throw new ValidationError('Enter a quantity between 1 and 1000 for each item');
      }
      const { rows } = await tx.query<{
        id: string; kind: 'physical' | 'digital' | 'service'; name: string; price_amount: string;
        currency: string; track_inventory: boolean; inventory_quantity: number; requires_shipping: boolean;
        status: string; store_id: string;
      }>(
        `SELECT id, kind, name, price_amount, currency, track_inventory, inventory_quantity, requires_shipping, status, store_id
           FROM store_products WHERE id = $1 LIMIT 1`,
        [item.productId]
      );
      const product = rows[0];
      if (!product || product.store_id !== store.id || product.status !== 'active') {
        throw new ValidationError('One of the items is no longer available');
      }

      let unitCents = toCents(product.price_amount);
      let variantName: string | null = null;
      if (item.variantId) {
        const { rows: variantRows } = await tx.query<{
          id: string; name: string; price_amount: string; track_inventory: boolean; inventory_quantity: number; status: string;
        }>(`SELECT id, name, price_amount, track_inventory, inventory_quantity, status FROM store_product_variants WHERE id = $1 AND product_id = $2 LIMIT 1`, [
          item.variantId,
          product.id,
        ]);
        const variant = variantRows[0];
        if (!variant || variant.status !== 'active') throw new ValidationError('One of the selected options is no longer available');
        unitCents = toCents(variant.price_amount);
        variantName = variant.name;

        if (variant.track_inventory) {
          const { rows: reserved } = await tx.query(
            `UPDATE store_product_variants SET inventory_quantity = inventory_quantity - $2, updated_at = now()
              WHERE id = $1 AND inventory_quantity >= $2 RETURNING id`,
            [variant.id, quantity]
          );
          if (!reserved[0]) throw new ConflictError(`${product.name} (${variant.name}) does not have ${quantity} left in stock`);
        }
      } else if (product.track_inventory) {
        const { rows: reserved } = await tx.query(
          `UPDATE store_products SET inventory_quantity = inventory_quantity - $2, updated_at = now()
            WHERE id = $1 AND inventory_quantity >= $2 RETURNING id, inventory_quantity`,
          [product.id, quantity]
        );
        if (!reserved[0]) throw new ConflictError(`${product.name} does not have ${quantity} left in stock`);
        await tx.query(
          `INSERT INTO store_inventory_movements (id, store_id, product_id, delta, quantity_after, reason, order_id)
           VALUES ($1,$2,$3,$4,$5,'order',$6)`,
          [randomUUID(), store.id, product.id, -quantity, reserved[0].inventory_quantity, orderId]
        );
      }

      lines.push({
        productId: product.id,
        variantId: item.variantId ?? null,
        name: product.name,
        variantName,
        kind: product.kind,
        quantity,
        unitCents,
        requiresShipping: product.requires_shipping || product.kind === 'physical',
      });
    }

    const needsShipping = lines.some((line) => line.requiresShipping);
    let shippingCents = 0;
    let shippingMethodId: string | null = null;
    if (needsShipping) {
      // A merchant may ship without publishing priced methods; requiring an address is the
      // non-negotiable part, and the order records "arranged with the merchant" when no method is set.
      if (!input.shippingAddress || Object.keys(input.shippingAddress).length === 0) {
        throw new ValidationError('This order contains items that must be shipped — a delivery address is required');
      }
      if (input.shippingMethodId) {
        const { rows: shippingRows } = await tx.query<{ id: string; price_amount: string }>(
          `SELECT id, price_amount FROM store_shipping_methods WHERE id = $1 AND store_id = $2 AND status = 'active' LIMIT 1`,
          [input.shippingMethodId, store.id]
        );
        if (!shippingRows[0]) throw new ValidationError('That shipping option is no longer available');
        shippingCents = toCents(shippingRows[0].price_amount);
        shippingMethodId = shippingRows[0].id;
      }
    }

    const subtotalCents = lines.reduce((total, line) => total + line.unitCents * line.quantity, 0);

    let discountCents = 0;
    let discountCode: string | null = null;
    if (input.discountCode) {
      const code = input.discountCode.trim().toUpperCase();
      const { rows: discountRows } = await tx.query<{
        id: string; kind: 'percentage' | 'fixed'; value: string; min_order_amount: string | null;
        max_redemptions: number | null; redemptions: number; ends_at: string | null; status: string;
      }>(
        `SELECT id, kind, value, min_order_amount, max_redemptions, redemptions, ends_at, status
           FROM store_discount_codes WHERE store_id = $1 AND upper(code) = $2 LIMIT 1`,
        [store.id, code]
      );
      const discount = discountRows[0];
      if (!discount || discount.status !== 'active') throw new ValidationError('That discount code is not valid');
      if (discount.ends_at && new Date(discount.ends_at).getTime() < Date.now()) throw new ValidationError('That discount code has expired');
      if (discount.max_redemptions !== null && discount.redemptions >= discount.max_redemptions) {
        throw new ValidationError('That discount code has been fully redeemed');
      }
      if (discount.min_order_amount && subtotalCents < toCents(discount.min_order_amount)) {
        throw new ValidationError(`That discount code needs a minimum order of ${store.currency} ${discount.min_order_amount}`);
      }
      discountCents =
        discount.kind === 'percentage'
          ? Math.round((subtotalCents * toCents(discount.value)) / 10_000)
          : Math.min(toCents(discount.value), subtotalCents);
      discountCode = code;
      await tx.query(`UPDATE store_discount_codes SET redemptions = redemptions + 1, updated_at = now() WHERE id = $1`, [discount.id]);
    }

    // Tax uses only the merchant's configured rates. No rate configured → no tax, stated as such.
    const country = (input.shippingAddress?.country ?? input.shippingAddress?.countryCode ?? '').toUpperCase();
    let taxCents = 0;
    if (country) {
      for (const rate of storefront.taxRates) {
        if (rate.country_code !== '*' && rate.country_code !== country) continue;
        const base = rate.includes_shipping ? subtotalCents - discountCents + shippingCents : subtotalCents - discountCents;
        taxCents += Math.round((base * Number(rate.rate_percent)) / 100);
        break; // The first matching (specific then default) rate applies.
      }
    }

    const totalCents = subtotalCents - discountCents + shippingCents + taxCents;
    const { rows: numberRows } = await tx.query<{ next: string }>(
      `SELECT (COALESCE(max(NULLIF(regexp_replace(order_number, '\\D', '', 'g'), '')::bigint), 0) + 1)::text AS next
         FROM store_orders WHERE store_id = $1`,
      [store.id]
    );
    const orderNumber = `S${String(numberRows[0]?.next ?? '1').padStart(5, '0')}`;

    await tx.query(
      `INSERT INTO store_orders
         (id, store_id, order_number, status, payment_status, payment_mode, currency, subtotal_amount,
          discount_amount, shipping_amount, tax_amount, total_amount, discount_code, customer_name,
          customer_email, customer_phone, shipping_method_id, shipping_address, notes)
       VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        orderId,
        store.id,
        orderNumber,
        store.payment_mode === 'provider' ? 'unpaid' : 'unpaid',
        store.payment_mode,
        store.currency,
        money(subtotalCents / 100),
        money(discountCents / 100),
        money(shippingCents / 100),
        money(taxCents / 100),
        money(totalCents / 100),
        discountCode,
        name,
        email,
        input.customerPhone?.slice(0, 40) ?? null,
        shippingMethodId,
        input.shippingAddress ? JSON.stringify(input.shippingAddress) : null,
        input.notes?.slice(0, 2000) ?? null,
      ]
    );

    for (const line of lines) {
      const itemId = randomUUID();
      const lineTotal = line.unitCents * line.quantity;
      await tx.query(
        `INSERT INTO store_order_items
           (id, order_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot, kind, quantity,
            unit_price_amount, currency, line_total_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          itemId,
          orderId,
          line.productId,
          line.variantId,
          line.name,
          line.variantName,
          line.kind,
          line.quantity,
          money(line.unitCents / 100),
          store.currency,
          money(lineTotal / 100),
        ]
      );
      // Every line starts with a real fulfilment state: shipped goods await dispatch, digital
      // goods await token issue (done after payment), services await the merchant.
      await tx.query(
        `INSERT INTO store_order_fulfilments (id, order_id, order_item_id, status) VALUES ($1,$2,$3,'pending')`,
        [randomUUID(), orderId, itemId]
      );
    }

    return { orderNumber, totalCents, currency: store.currency, needsShipping };
  });

  await createNotification(db, {
    userId: store.user_id,
    type: 'STORE_ORDER_PLACED',
    title: `New order ${result.orderNumber} in ${store.name}`,
    message: [
      `Customer: ${name} <${email}>`,
      `Total: ${result.currency} ${money(result.totalCents / 100)}`,
      store.payment_mode === 'provider'
        ? 'Payment is collected by the connected provider; fulfilment starts once it is verified.'
        : 'Payment is arranged with the customer directly (this store has no connected payment provider).',
      'Manage it in your CloudHost247 dashboard under Store → Orders.',
    ].join('\n'),
    resourceType: 'store_order',
    resourceId: orderId,
  });

  void context;
  return { orderId, orderNumber: result.orderNumber, totalAmount: money(result.totalCents / 100), currency: result.currency };
}

/* --------------------------------------------------------------------------------------------
 * Merchant order management
 * ------------------------------------------------------------------------------------------ */

export async function listOrders(db: Queryable, userId: string, storeId: string, status?: string) {
  await requireOwnedStore(db, userId, storeId);
  const { rows } = await db.query(
    `SELECT o.id, o.order_number, o.status, o.payment_status, o.payment_mode, o.currency, o.total_amount,
            o.customer_name, o.customer_email, o.created_at, o.paid_at,
            (SELECT count(*)::int FROM store_order_items i WHERE i.order_id = o.id) AS item_count,
            (SELECT count(*)::int FROM store_order_fulfilments f WHERE f.order_id = o.id AND f.status = 'pending') AS pending_fulfilments
       FROM store_orders o
      WHERE o.store_id = $1 ${status ? 'AND o.status = $2' : ''}
      ORDER BY o.created_at DESC LIMIT 200`,
    status ? [storeId, status] : [storeId]
  );
  return rows;
}

export async function getOrder(db: Queryable, userId: string, storeId: string, orderId: string) {
  await requireOwnedStore(db, userId, storeId);
  const { rows } = await db.query(`SELECT * FROM store_orders WHERE id = $1 AND store_id = $2 LIMIT 1`, [orderId, storeId]);
  const order = rows[0];
  if (!order) throw new NotFoundError('No order was found with that id');
  const { rows: items } = await db.query(
    `SELECT i.*, f.status AS fulfilment_status, f.carrier, f.tracking_number, f.tracking_url, f.fulfilled_at
       FROM store_order_items i
       LEFT JOIN store_order_fulfilments f ON f.order_item_id = i.id
      WHERE i.order_id = $1 ORDER BY i.created_at ASC`,
    [orderId]
  );
  return { order, items };
}

/**
 * Marks one line fulfilled. A physical line requires a carrier and tracking number the merchant
 * actually typed; a digital line is refused here (it is delivered by the download system, not by a
 * human claim); a service line is simply completed.
 */
export async function fulfilOrderItem(
  db: Queryable,
  userId: string,
  storeId: string,
  orderId: string,
  itemId: string,
  input: { status: 'processing' | 'shipped' | 'delivered' | 'cancelled'; carrier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null; notes?: string | null }
) {
  await requireOwnedStore(db, userId, storeId);
  const { rows: itemRows } = await db.query<{ id: string; kind: string; order_id: string }>(
    `SELECT id, kind, order_id FROM store_order_items WHERE id = $1 AND order_id = $2 LIMIT 1`,
    [itemId, orderId]
  );
  const item = itemRows[0];
  if (!item) throw new NotFoundError('No order line was found with that id');
  if (item.kind === 'digital' && input.status === 'shipped') {
    throw new ValidationError('Digital products are not shipped — delivery is the download link for this line');
  }
  if (item.kind === 'physical' && (input.status === 'shipped' || input.status === 'delivered')) {
    if (!input.carrier?.trim() || !input.trackingNumber?.trim()) {
      throw new ValidationError('A shipped order line needs the carrier and tracking number');
    }
  }

  const { rows } = await db.query(
    `UPDATE store_order_fulfilments SET
        status = $2::varchar,
        carrier = COALESCE($3, carrier),
        tracking_number = COALESCE($4, tracking_number),
        tracking_url = COALESCE($5, tracking_url),
        notes = COALESCE($6, notes),
        fulfilled_at = CASE WHEN $2::varchar IN ('shipped','delivered') THEN now() ELSE fulfilled_at END,
        updated_at = now()
      WHERE order_item_id = $1
      RETURNING id, status, carrier, tracking_number, tracking_url, fulfilled_at`,
    [
      itemId,
      input.status,
      input.carrier?.slice(0, 80) ?? null,
      input.trackingNumber?.slice(0, 120) ?? null,
      input.trackingUrl?.slice(0, 500) ?? null,
      input.notes?.slice(0, 500) ?? null,
    ]
  );

  await recomputeOrderStatus(db, orderId);
  return rows[0];
}

async function recomputeOrderStatus(db: Queryable, orderId: string): Promise<void> {
  const { rows } = await db.query<{ total: string; shipped: string; delivered: string; pending: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE status = 'shipped')::text AS shipped,
            count(*) FILTER (WHERE status IN ('delivered','shipped'))::text AS delivered,
            count(*) FILTER (WHERE status = 'pending')::text AS pending
       FROM store_order_fulfilments WHERE order_id = $1`,
    [orderId]
  );
  const counts = rows[0];
  if (!counts || Number(counts.total) === 0) return;
  const status = Number(counts.pending) === 0 && Number(counts.delivered) === Number(counts.total)
    ? 'completed'
    : Number(counts.shipped) > 0 || Number(counts.delivered) > 0
      ? 'shipped'
      : 'processing';
  await db.query(`UPDATE store_orders SET status = $2, updated_at = now() WHERE id = $1 AND status NOT IN ('cancelled','refunded')`, [
    orderId,
    status,
  ]);
}

export async function cancelOrder(db: Queryable, userId: string, storeId: string, orderId: string, reason: string) {
  await requireOwnedStore(db, userId, storeId);
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM store_orders WHERE id = $1 AND store_id = $2 LIMIT 1`, [
    orderId,
    storeId,
  ]);
  if (!rows[0]) throw new NotFoundError('No order was found with that id');
  if (rows[0].status === 'completed') throw new ValidationError('A completed order cannot be cancelled — issue a refund instead');

  await withTransaction(db, async (tx) => {
    await tx.query(`UPDATE store_orders SET status = 'cancelled', updated_at = now() WHERE id = $1`, [orderId]);
    await tx.query(`UPDATE store_order_fulfilments SET status = 'cancelled', updated_at = now() WHERE order_id = $1 AND status = 'pending'`, [
      orderId,
    ]);
    // Restock the physical lines that had been decremented, and record why the number moved.
    const { rows: items } = await tx.query<{ product_id: string | null; variant_id: string | null; quantity: number; kind: string }>(
      `SELECT product_id, variant_id, quantity, kind FROM store_order_items WHERE order_id = $1`,
      [orderId]
    );
    for (const item of items) {
      if (!item.product_id || item.kind !== 'physical') continue;
      const { rows: updated } = await tx.query<{ inventory_quantity: number }>(
        `UPDATE store_products SET inventory_quantity = inventory_quantity + $2, updated_at = now()
          WHERE id = $1 AND track_inventory RETURNING inventory_quantity`,
        [item.product_id, item.quantity]
      );
      if (updated[0]) {
        await tx.query(
          `INSERT INTO store_inventory_movements (id, store_id, product_id, variant_id, delta, quantity_after, reason, order_id, actor_id)
           VALUES ($1,$2,$3,$4,$5,$6,'cancellation',$7,$8)`,
          [randomUUID(), storeId, item.product_id, item.variant_id, item.quantity, updated[0].inventory_quantity, orderId, userId]
        );
      }
      if (item.variant_id) {
        await tx.query(`UPDATE store_product_variants SET inventory_quantity = inventory_quantity + $2, updated_at = now() WHERE id = $1 AND track_inventory`, [
          item.variant_id,
          item.quantity,
        ]);
      }
    }
  });
  void reason;
  return { ok: true };
}

/* --------------------------------------------------------------------------------------------
 * Payment verification and digital delivery
 * ------------------------------------------------------------------------------------------ */

/**
 * The ONLY path that can mark a shopper order paid. Idempotent per (provider, provider_reference),
 * and it records the verification outcome either way, so an unverified or duplicated callback can
 * never credit an order twice.
 */
export async function recordPaymentEvent(
  db: Queryable,
  input: {
    storeId: string;
    provider: string;
    providerReference: string;
    eventType: string;
    status: 'paid' | 'failed' | 'refunded' | 'pending';
    amount?: string | null;
    currency?: string | null;
    signatureVerified: boolean;
    payload?: Record<string, unknown>;
    orderId?: string | null;
  },
  delivery: { source?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}
) {
  const { rows: storeRows } = await db.query<{ id: string }>(`SELECT id FROM store_stores WHERE id = $1 LIMIT 1`, [input.storeId]);
  if (!storeRows[0]) throw new NotFoundError('No store was found with that id');

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO store_payment_events
       (id, store_id, order_id, provider, provider_reference, event_type, status, amount, currency, signature_verified, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (provider, provider_reference) DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      input.storeId,
      input.orderId ?? null,
      input.provider,
      input.providerReference,
      input.eventType,
      input.status,
      input.amount ?? null,
      input.currency?.toUpperCase() ?? null,
      input.signatureVerified,
      JSON.stringify(input.payload ?? {}),
    ]
  );
  if (!inserted.rows[0]) {
    return { recorded: false, duplicate: true, orderId: input.orderId ?? null };
  }
  if (!input.signatureVerified) {
    return { recorded: true, duplicate: false, orderId: input.orderId ?? null, applied: false };
  }
  if (!input.orderId || input.status !== 'paid') {
    return { recorded: true, duplicate: false, orderId: input.orderId ?? null, applied: false };
  }

  const paid = await markOrderPaid(db, input.orderId, delivery);
  return { recorded: true, duplicate: false, orderId: input.orderId, applied: true, downloadDelivery: paid.downloadDelivery ?? null };
}

/** Marks a paid order and issues delivery. Called only from a verified payment path. */
export async function markOrderPaid(
  db: Queryable,
  orderId: string,
  delivery: { source?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}
) {
  const { rows } = await db.query<{ id: string; store_id: string; payment_status: string; order_number: string; customer_email: string; user_id: string }>(
    `SELECT o.id, o.store_id, o.payment_status, o.order_number, o.customer_email, s.user_id
       FROM store_orders o JOIN store_stores s ON s.id = o.store_id
      WHERE o.id = $1 LIMIT 1`,
    [orderId]
  );
  const order = rows[0];
  if (!order) throw new NotFoundError('No order was found with that id');
  if (order.payment_status === 'paid') return { alreadyPaid: true, tokens: [] as string[] };

  const tokens = await withTransaction(db, async (tx) => {
    await tx.query(`UPDATE store_orders SET payment_status = 'paid', paid_at = now(), status = 'processing', updated_at = now() WHERE id = $1`, [
      orderId,
    ]);
    // Digital lines are delivered now — and only now, because the link is the goods.
    const { rows: digitalItems } = await tx.query<{ id: string; product_id: string }>(
      `SELECT id, product_id FROM store_order_items WHERE order_id = $1 AND kind = 'digital' AND product_id IS NOT NULL`,
      [orderId]
    );
    const issued: string[] = [];
    for (const item of digitalItems) {
      const { rows: productRows } = await tx.query<{ download_limit: number; download_expiry_days: number }>(
        `SELECT download_limit, download_expiry_days FROM store_products WHERE id = $1`,
        [item.product_id]
      );
      const settings = productRows[0];
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + (settings?.download_expiry_days ?? 30) * 86_400_000);
      await tx.query(
        `INSERT INTO store_download_tokens (id, order_id, order_item_id, product_id, token, max_downloads, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), orderId, item.id, item.product_id, token, settings?.download_limit ?? 5, expiresAt.toISOString()]
      );
      await tx.query(`UPDATE store_order_fulfilments SET status = 'delivered', fulfilled_at = now(), updated_at = now() WHERE order_item_id = $1`, [
        item.id,
      ]);
      issued.push(token);
    }
    return issued;
  });

  // The buyer is not necessarily a platform user, so their links go out through the platform's
  // transactional email transport (the same one notifications use) and the outcome is stored.
  let deliveryOutcome: { status: 'sent' | 'manual' | 'failed'; note: string } | null = null;
  if (tokens.length) {
    const source = delivery.source ?? process.env;
    const links = tokens.map((token) => downloadLink(source, token));
    const outcome = await sendTransactionalEmail(
      {
        to: order.customer_email,
        subject: `Your download${tokens.length > 1 ? 's are' : ' is'} ready — order ${order.order_number}`,
        template: 'store_digital_delivery',
        text: [
          `Thank you for your order ${order.order_number}.`,
          '',
          tokens.length === 1 ? 'Your download link:' : 'Your download links:',
          ...links,
          '',
          'Keep this link — it is the delivery of your purchase. If it expires, ask the store to re-issue it.',
        ].join('\n'),
      },
      { source, fetchImpl: delivery.fetchImpl }
    );
    deliveryOutcome = { status: outcome.status, note: outcome.note };
    await db.query(
      `UPDATE store_orders
          SET download_delivery_status = $2, download_delivery_note = $3, download_links_sent_at = now(), updated_at = now()
        WHERE id = $1`,
      [orderId, outcome.status, outcome.note.slice(0, 500)]
    );
  }

  await createNotification(db, {
    userId: order.user_id,
    type: 'STORE_ORDER_PAID',
    title: `Payment received for order ${order.order_number}`,
    message: tokens.length
      ? deliveryOutcome?.status === 'sent'
        ? `${tokens.length} digital download link(s) were emailed to ${order.customer_email}.`
        : `${tokens.length} digital download link(s) were issued to ${order.customer_email}, but the email was not sent (${deliveryOutcome?.status}). The buyer can still retrieve them from the order-status lookup.`
      : 'The order is paid and ready to fulfil.',
    resourceType: 'store_order',
    resourceId: orderId,
  });

  return { alreadyPaid: false, tokens, downloadDelivery: deliveryOutcome };
}

export interface DownloadResult {
  filename: string;
  contentType: string;
  data: Buffer;
}

/**
 * Redeems a download token. Enforces expiry and the redemption ceiling, and refuses a line whose
 * order is not paid — the file is never served because someone guessed a token.
 */
export async function redeemDownloadToken(db: Queryable, token: string): Promise<DownloadResult> {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new NotFoundError('That download link is not valid');

  const { rows } = await db.query<{
    id: string; download_count: number; max_downloads: number; expires_at: string; product_id: string;
    payment_status: string; filename: string | null; content_type: string | null; data: Buffer | null;
  }>(
    `SELECT t.id, t.download_count, t.max_downloads, t.expires_at, t.product_id,
            o.payment_status, p.download_filename AS filename, p.download_content_type AS content_type, p.download_data AS data
       FROM store_download_tokens t
       JOIN store_orders o ON o.id = t.order_id
       JOIN store_products p ON p.id = t.product_id
      WHERE t.token = $1 LIMIT 1`,
    [token]
  );
  const record = rows[0];
  if (!record) throw new NotFoundError('That download link is not valid');
  if (record.payment_status !== 'paid') throw new ForbiddenError('This download is not available until the order is paid');
  if (new Date(record.expires_at).getTime() < Date.now()) throw new ForbiddenError('This download link has expired');
  if (record.download_count >= record.max_downloads) throw new ForbiddenError('This download link has reached its download limit');
  if (!record.data || !record.filename || !record.content_type) {
    throw new NotFoundError('This product has no downloadable file attached');
  }

  await withTransaction(db, async (tx) => {
    const { rows: consumed } = await tx.query(
      `UPDATE store_download_tokens
          SET download_count = download_count + 1, last_downloaded_at = now()
        WHERE id = $1 AND download_count < max_downloads
        RETURNING id`,
      [record.id]
    );
    if (!consumed[0]) throw new ForbiddenError('This download link has reached its download limit');
  });

  return { filename: record.filename, contentType: record.content_type, data: Buffer.from(record.data) };
}

/** Public order status lookup for a shopper (email + order number), no listing of other orders. */
export async function getShopperOrderStatus(db: Queryable, storeSlug: string, orderNumber: string, email: string) {
  const { rows } = await db.query(
    `SELECT o.order_number, o.status, o.payment_status, o.currency, o.total_amount, o.created_at, o.paid_at,
            (SELECT COALESCE(json_agg(json_build_object(
               'name', i.product_name_snapshot, 'variant', i.variant_name_snapshot, 'quantity', i.quantity,
               'kind', i.kind, 'fulfilment', f.status, 'carrier', f.carrier, 'tracking', f.tracking_number
             ) ORDER BY i.created_at), '[]'::json)
               FROM store_order_items i LEFT JOIN store_order_fulfilments f ON f.order_item_id = i.id
              WHERE i.order_id = o.id) AS items
       FROM store_orders o
       JOIN store_stores s ON s.id = o.store_id
      WHERE lower(s.slug) = lower($1) AND o.order_number = $2 AND lower(o.customer_email) = lower($3) LIMIT 1`,
    [storeSlug, orderNumber, email]
  );
  if (!rows[0]) throw new NotFoundError('No order was found with those details');
  const status = rows[0] as Record<string, unknown> & { payment_status?: string };

  // The lookup is already gated on the order number *and* the buyer's email, which is the same
  // credential that gets the goods. A buyer whose email could not be sent can therefore still
  // retrieve a paid download here, and an unpaid order exposes nothing.
  let downloads: Array<Record<string, unknown>> = [];
  if (status.payment_status === 'paid') {
    const { rows: tokenRows } = await db.query(
      `SELECT t.token, t.max_downloads, t.download_count, t.expires_at, p.name AS product_name, p.download_filename AS filename
         FROM store_download_tokens t
         JOIN store_orders o ON o.id = t.order_id
         JOIN store_stores s ON s.id = o.store_id
         JOIN store_products p ON p.id = t.product_id
        WHERE lower(s.slug) = lower($1) AND o.order_number = $2 AND lower(o.customer_email) = lower($3)
          AND t.expires_at > now() AND t.download_count < t.max_downloads
        ORDER BY t.created_at ASC`,
      [storeSlug, orderNumber, email]
    );
    downloads = tokenRows;
    const delivery = await db.query<{ download_delivery_status: string | null; download_delivery_note: string | null }>(
      `SELECT download_delivery_status, download_delivery_note FROM store_orders WHERE order_number = $1 LIMIT 1`,
      [orderNumber]
    );
    const row = delivery.rows[0];
    return {
      ...status,
      downloads,
      downloadDelivery: row
        ? { status: row.download_delivery_status, note: row.download_delivery_note }
        : null,
    };
  }
  return { ...status, downloads };
}
