-- Migration: 0074_create_online_store.sql
-- Purpose: CloudHost247 Online Store — the customer's own storefront: catalogue (physical, digital
-- and service products), variants, inventory, discounts, shipping and tax configuration, shopper
-- orders, and fulfilment (including real digital delivery).
--
-- Scope boundary that keeps this honest:
--
--   `orders`/`invoices`/`payments` (0016–0020) remain the PLATFORM's billing records — what
--   CloudHost247 charges its customer. A store shopper buying from the customer's store is a
--   different commercial relationship, so it gets its own order tables. They are not a second
--   implementation of the platform's billing engine: no shopper order is ever invoiced through
--   the platform billing stack, and no platform subscription is derived from a shopper order.
--
--   Shopper payment is recorded only from a verified provider callback. Until an admin connects a
--   payment provider that supports the merchant's market, a store runs in the honest
--   `order_intake` mode: the order is accepted, the merchant is notified, and the checkout page
--   shows that payment will be arranged directly — it never claims money was collected.
--
--   Shipping rates and tax rates are merchant-configured rows (`store_shipping_methods`,
--   `store_tax_rates`). Nothing is fabricated: a store with no configured method shows
--   "shipping is arranged with the merchant" at checkout, and a store with no tax rate charges no
--   tax rather than a guessed percentage.

CREATE TABLE IF NOT EXISTS store_stores (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  site_id uuid NULL REFERENCES builder_sites (id) ON DELETE SET NULL,
  name varchar(160) NOT NULL,
  slug varchar(80) NOT NULL,
  description text NOT NULL DEFAULT '',
  currency char(3) NOT NULL DEFAULT 'USD',
  status varchar(16) NOT NULL DEFAULT 'draft',
  -- 'provider' = a connected payment provider collects payment online.
  -- 'order_intake' = orders are accepted and payment is arranged with the merchant directly.
  -- The commerce mode is derived from whether a provider is actually configured, and is reported
  -- to the customer exactly as it is — never upgraded optimistically.
  payment_mode varchar(16) NOT NULL DEFAULT 'order_intake',
  -- Merchant-configured storefront settings: low-stock threshold, order confirmation copy,
  -- whether downloads require an account, notification address.
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan_code varchar(64) NOT NULL DEFAULT 'free',
  subscription_id uuid NULL REFERENCES subscriptions (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_stores_status_check CHECK (status IN ('draft', 'active', 'suspended')),
  CONSTRAINT store_stores_payment_mode_check CHECK (payment_mode IN ('order_intake', 'provider')),
  CONSTRAINT store_stores_currency_check CHECK (currency = upper(currency))
);

CREATE UNIQUE INDEX IF NOT EXISTS store_stores_slug_unique_idx ON store_stores (lower(slug));
CREATE INDEX IF NOT EXISTS store_stores_user_idx ON store_stores (user_id, created_at DESC);
-- One store per hosted site (a site without a store is unaffected; the index is partial).
CREATE UNIQUE INDEX IF NOT EXISTS store_stores_site_unique_idx ON store_stores (site_id) WHERE site_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS store_products (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES store_stores (id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL,
  name varchar(200) NOT NULL,
  slug varchar(120) NOT NULL,
  description text NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'draft',
  sku varchar(80) NULL,
  price_amount numeric(12, 2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  compare_at_amount numeric(12, 2) NULL,
  track_inventory boolean NOT NULL DEFAULT false,
  inventory_quantity integer NOT NULL DEFAULT 0,
  -- Digital products are delivered as a downloadable asset; a service product is neither shipped
  -- nor downloaded but produces a fulfilment task for the merchant.
  requires_shipping boolean NOT NULL DEFAULT false,
  weight_grams integer NULL,
  -- Digital delivery: the asset bytes live in the same database, under the same access control
  -- and backup as everything else. 10 MiB is the per-file ceiling.
  download_filename varchar(255) NULL,
  download_content_type varchar(64) NULL,
  download_byte_size integer NULL,
  download_checksum char(64) NULL,
  download_data bytea NULL,
  download_limit integer NOT NULL DEFAULT 5,
  download_expiry_days integer NOT NULL DEFAULT 30,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_products_kind_check CHECK (kind IN ('physical', 'digital', 'service')),
  CONSTRAINT store_products_status_check CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT store_products_price_check CHECK (price_amount >= 0),
  CONSTRAINT store_products_currency_check CHECK (currency = upper(currency)),
  CONSTRAINT store_products_inventory_check CHECK (inventory_quantity >= 0),
  CONSTRAINT store_products_compare_at_check CHECK (compare_at_amount IS NULL OR compare_at_amount >= price_amount),
  -- A digital product must be either downloadable or explicitly a service-style delivery; a
  -- product claiming to be digital with no file can never be presented as deliverable.
  CONSTRAINT store_products_digital_download_check CHECK (
    kind <> 'digital' OR (download_data IS NOT NULL AND download_filename IS NOT NULL)
  ),
  CONSTRAINT store_products_download_size_check CHECK (
    download_byte_size IS NULL OR (download_byte_size > 0 AND download_byte_size <= 10485760)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS store_products_store_slug_unique_idx ON store_products (store_id, lower(slug));
CREATE INDEX IF NOT EXISTS store_products_store_idx ON store_products (store_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS store_product_variants (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES store_products (id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  sku varchar(80) NULL,
  -- Absolute price for the variant, not a delta: a delta can silently produce a negative or
  -- nonsensical price when the base price is edited later.
  price_amount numeric(12, 2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  track_inventory boolean NOT NULL DEFAULT false,
  inventory_quantity integer NOT NULL DEFAULT 0,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'active',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_product_variants_price_check CHECK (price_amount >= 0),
  CONSTRAINT store_product_variants_inventory_check CHECK (inventory_quantity >= 0),
  CONSTRAINT store_product_variants_status_check CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS store_product_variants_product_idx ON store_product_variants (product_id, sort_order);

CREATE TABLE IF NOT EXISTS store_discount_codes (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES store_stores (id) ON DELETE CASCADE,
  code varchar(40) NOT NULL,
  kind varchar(16) NOT NULL,
  value numeric(12, 2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  min_order_amount numeric(12, 2) NULL,
  max_redemptions integer NULL,
  redemptions integer NOT NULL DEFAULT 0,
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_discount_codes_kind_check CHECK (kind IN ('percentage', 'fixed')),
  CONSTRAINT store_discount_codes_value_check CHECK (value > 0),
  CONSTRAINT store_discount_codes_percentage_check CHECK (kind <> 'percentage' OR value <= 100),
  CONSTRAINT store_discount_codes_status_check CHECK (status IN ('active', 'paused', 'expired')),
  CONSTRAINT store_discount_codes_redemptions_check CHECK (redemptions >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS store_discount_codes_unique_idx ON store_discount_codes (store_id, upper(code));

CREATE TABLE IF NOT EXISTS store_shipping_methods (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES store_stores (id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  description varchar(255) NOT NULL DEFAULT '',
  price_amount numeric(12, 2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  -- ISO-3166 alpha-2 codes the method delivers to. Empty array = every destination the merchant
  -- ships to, which is stated verbatim at checkout.
  countries jsonb NOT NULL DEFAULT '[]'::jsonb,
  min_order_amount numeric(12, 2) NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_shipping_methods_price_check CHECK (price_amount >= 0),
  CONSTRAINT store_shipping_methods_status_check CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS store_shipping_methods_store_idx ON store_shipping_methods (store_id, sort_order);

CREATE TABLE IF NOT EXISTS store_tax_rates (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES store_stores (id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  -- ISO-3166 alpha-2, or '*' for a store-wide default. Merchant-configured only: the platform
  -- never guesses a jurisdiction's rate.
  country_code varchar(2) NOT NULL,
  region varchar(80) NULL,
  rate_percent numeric(6, 3) NOT NULL,
  includes_shipping boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_tax_rates_rate_check CHECK (rate_percent >= 0 AND rate_percent <= 100),
  CONSTRAINT store_tax_rates_status_check CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS store_tax_rates_store_idx ON store_tax_rates (store_id, country_code);

-- Shopper orders. `order_number` is server-generated per store; `payment_status` is only ever
-- advanced by a verified provider callback (or by the merchant recording a direct payment mode).
CREATE TABLE IF NOT EXISTS store_orders (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES store_stores (id) ON DELETE CASCADE,
  order_number varchar(32) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  payment_status varchar(24) NOT NULL DEFAULT 'unpaid',
  payment_mode varchar(16) NOT NULL DEFAULT 'order_intake',
  currency char(3) NOT NULL,
  subtotal_amount numeric(12, 2) NOT NULL,
  discount_amount numeric(12, 2) NOT NULL DEFAULT 0,
  shipping_amount numeric(12, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0,
  total_amount numeric(12, 2) NOT NULL,
  discount_code varchar(40) NULL,
  customer_name varchar(200) NOT NULL,
  customer_email varchar(255) NOT NULL,
  customer_phone varchar(40) NULL,
  shipping_method_id uuid NULL REFERENCES store_shipping_methods (id) ON DELETE SET NULL,
  shipping_address jsonb NULL,
  notes text NULL,
  provider varchar(40) NULL,
  provider_reference varchar(160) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz NULL,
  CONSTRAINT store_orders_status_check CHECK (
    status IN ('pending', 'processing', 'shipped', 'completed', 'cancelled', 'refunded', 'failed')
  ),
  CONSTRAINT store_orders_payment_status_check CHECK (
    payment_status IN ('unpaid', 'pending', 'paid', 'partially_refunded', 'refunded', 'failed')
  ),
  CONSTRAINT store_orders_payment_mode_check CHECK (payment_mode IN ('order_intake', 'provider')),
  CONSTRAINT store_orders_amounts_check CHECK (
    subtotal_amount >= 0 AND discount_amount >= 0 AND shipping_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0
  ),
  CONSTRAINT store_orders_currency_check CHECK (currency = upper(currency)),
  -- Physical goods need somewhere to go; a store can never accept a shippable order without one.
  CONSTRAINT store_orders_shipping_address_check CHECK (
    shipping_address IS NOT NULL OR shipping_method_id IS NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS store_orders_number_unique_idx ON store_orders (store_id, order_number);
CREATE INDEX IF NOT EXISTS store_orders_store_idx ON store_orders (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_orders_status_idx ON store_orders (store_id, status);

CREATE TABLE IF NOT EXISTS store_order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES store_orders (id) ON DELETE CASCADE,
  product_id uuid NULL REFERENCES store_products (id) ON DELETE SET NULL,
  variant_id uuid NULL REFERENCES store_product_variants (id) ON DELETE SET NULL,
  product_name_snapshot varchar(200) NOT NULL,
  variant_name_snapshot varchar(160) NULL,
  kind varchar(16) NOT NULL,
  quantity integer NOT NULL,
  unit_price_amount numeric(12, 2) NOT NULL,
  currency char(3) NOT NULL,
  line_total_amount numeric(12, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_order_items_kind_check CHECK (kind IN ('physical', 'digital', 'service')),
  CONSTRAINT store_order_items_quantity_check CHECK (quantity > 0 AND quantity <= 1000),
  CONSTRAINT store_order_items_amounts_check CHECK (unit_price_amount >= 0 AND line_total_amount >= 0)
);

CREATE INDEX IF NOT EXISTS store_order_items_order_idx ON store_order_items (order_id);

-- Fulfilment state per order item: a physical line becomes shipped with a real carrier/tracking
-- value the merchant typed, a digital line becomes delivered when its download token is issued,
-- and a service line becomes completed when the merchant marks the work done.
CREATE TABLE IF NOT EXISTS store_order_fulfilments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES store_orders (id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES store_order_items (id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'pending',
  carrier varchar(80) NULL,
  tracking_number varchar(120) NULL,
  tracking_url varchar(500) NULL,
  notes varchar(500) NULL,
  fulfilled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_order_fulfilments_status_check CHECK (
    status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS store_order_fulfilments_item_unique_idx ON store_order_fulfilments (order_item_id);
CREATE INDEX IF NOT EXISTS store_order_fulfilments_order_idx ON store_order_fulfilments (order_id);

-- Digital delivery: a single-use token per (order item, download unit). Tokens are opaque,
-- server-generated, expire, and are counted — a link that leaked cannot be replayed forever.
CREATE TABLE IF NOT EXISTS store_download_tokens (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES store_orders (id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES store_order_items (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES store_products (id) ON DELETE CASCADE,
  token char(64) NOT NULL,
  download_count integer NOT NULL DEFAULT 0,
  max_downloads integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  last_downloaded_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS store_download_tokens_token_unique_idx ON store_download_tokens (token);
CREATE INDEX IF NOT EXISTS store_download_tokens_item_idx ON store_download_tokens (order_item_id);

-- Verified provider callbacks for shopper payments. One row per (provider, reference) so a
-- redelivered webhook cannot double-credit an order.
CREATE TABLE IF NOT EXISTS store_payment_events (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES store_stores (id) ON DELETE CASCADE,
  order_id uuid NULL REFERENCES store_orders (id) ON DELETE SET NULL,
  provider varchar(40) NOT NULL,
  provider_reference varchar(160) NOT NULL,
  event_type varchar(60) NOT NULL,
  status varchar(24) NOT NULL,
  amount numeric(12, 2) NULL,
  currency char(3) NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS store_payment_events_reference_unique_idx
  ON store_payment_events (provider, provider_reference);
CREATE INDEX IF NOT EXISTS store_payment_events_store_idx ON store_payment_events (store_id, created_at DESC);

-- Inventory movements, so a stock number can always be explained: order, restock, manual
-- adjustment or cancellation. Append-only.
CREATE TABLE IF NOT EXISTS store_inventory_movements (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES store_stores (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES store_products (id) ON DELETE CASCADE,
  variant_id uuid NULL REFERENCES store_product_variants (id) ON DELETE CASCADE,
  delta integer NOT NULL,
  quantity_after integer NOT NULL,
  reason varchar(40) NOT NULL,
  order_id uuid NULL REFERENCES store_orders (id) ON DELETE SET NULL,
  actor_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_inventory_movements_reason_check CHECK (
    reason IN ('order', 'restock', 'adjustment', 'cancellation', 'return')
  )
);

CREATE INDEX IF NOT EXISTS store_inventory_movements_product_idx ON store_inventory_movements (product_id, created_at DESC);
