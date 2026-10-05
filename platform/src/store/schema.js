/**
 * Schema registry — the single source of truth for table shapes.
 *
 * Both storage backends are driven from here:
 *   - src/store/json-store.js uses it for defaults, type coercion and unique-constraint checks
 *   - src/store/pg-store.js  uses it to emit CREATE TABLE and to build parameterised CRUD SQL
 *
 * It mirrors database/migrations/00*.sql in the Fastify platform so records written by either
 * platform have the same shape. Column names stay snake_case for exactly that reason.
 *
 * To port a further domain, add its table here — the repositories work immediately on both
 * backends without any other change.
 */
'use strict';

/** Column types supported by both backends. Maps to a PostgreSQL type for the pg backend. */
const TYPES = {
  uuid: 'UUID',
  text: 'TEXT',
  integer: 'INTEGER',
  bigint: 'BIGINT',
  numeric: 'NUMERIC(16,2)',
  boolean: 'BOOLEAN',
  timestamptz: 'TIMESTAMPTZ',
  jsonb: 'JSONB',
  textArray: 'TEXT[]',
};

/** Shorthand helpers so the table definitions below stay scannable. */
const text = (extra = {}) => ({ type: 'text', ...extra });
const uuid = (extra = {}) => ({ type: 'uuid', default: 'uuidv7', ...extra });
const pk = () => uuid({ primaryKey: true });
const int = (extra = {}) => ({ type: 'integer', ...extra });
const num = (extra = {}) => ({ type: 'numeric', ...extra });
const bool = (extra = {}) => ({ type: 'boolean', ...extra });
const ts = (extra = {}) => ({ type: 'timestamptz', default: 'now', ...extra });
const jsonb = (extra = {}) => ({ type: 'jsonb', ...extra });

const TABLES = {
  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------
  users: {
    columns: {
      id: pk(),
      email: text({ required: true }),
      password_hash: text({ required: true }),
      full_name: text({ required: true }),
      role: text({ default: 'customer' }),
      status: text({ default: 'active' }),
      // Permanent human-readable six-digit account number (migration 0051). Never a relational
      // key — `id` remains the primary key.
      customer_id: text({ nullable: true }),
      password_changed_at: ts({ default: 'now' }),
      email_verified_at: { type: 'timestamptz', nullable: true },
      auth_session_version: int({ default: 1 }),
      security_number_hash: text({ nullable: true }),
      security_number_created_at: { type: 'timestamptz', nullable: true },
      security_number_expires_at: { type: 'timestamptz', nullable: true },
      security_number_version: int({ default: 0 }),
      security_number_initialized: bool({ default: false }),
      phone: text({ nullable: true }),
      address_line1: text({ nullable: true }),
      city: text({ nullable: true }),
      state: text({ nullable: true }),
      postal_code: text({ nullable: true }),
      country: text({ nullable: true }),
      deleted_at: { type: 'timestamptz', nullable: true },
      deleted_by: text({ nullable: true }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [
      { name: 'users_email_key', columns: ['email'], unique: true, ci: true },
      { name: 'users_customer_id_key', columns: ['customer_id'], unique: true, sparse: true },
    ],
  },

  roles: {
    columns: {
      id: pk(),
      name: text({ required: true }),
      description: text({ nullable: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'roles_name_key', columns: ['name'], unique: true }],
    seed: [
      { name: 'customer', description: 'Standard customer account' },
      { name: 'staff', description: 'Support and operations staff' },
      { name: 'admin', description: 'Administrator with billing and platform access' },
      { name: 'super_admin', description: 'Full control including role and status changes' },
    ],
  },

  user_roles: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      role_id: uuid({ required: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'user_roles_unique', columns: ['user_id', 'role_id'], unique: true }],
  },

  auth_audit_log: {
    columns: {
      id: pk(),
      user_id: uuid({ nullable: true }),
      event_type: text({ required: true }),
      ip_address: text({ nullable: true }),
      user_agent: text({ nullable: true }),
      metadata: jsonb({ default: {} }),
      created_at: ts(),
    },
    indexes: [
      { name: 'auth_audit_log_user_idx', columns: ['user_id'] },
      { name: 'auth_audit_log_event_idx', columns: ['event_type'] },
    ],
  },

  revoked_tokens: {
    columns: {
      jti: text({ primaryKey: true }),
      user_id: uuid({ nullable: true }),
      reason: text({ nullable: true }),
      expires_at: { type: 'timestamptz', required: true },
      revoked_at: ts(),
    },
  },

  auth_recovery: {
    // Single-use tokens for email verification and password reset (migration 0059).
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      kind: text({ required: true }),          // 'email_verification' | 'password_reset'
      token_hash: text({ required: true }),    // sha256(token) — plaintext is never stored
      consumed_at: { type: 'timestamptz', nullable: true },
      expires_at: { type: 'timestamptz', required: true },
      created_at: ts(),
    },
    indexes: [{ name: 'auth_recovery_token_key', columns: ['token_hash'], unique: true }],
  },

  totp_mfa: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      secret_encrypted: text({ required: true }),
      status: text({ default: 'pending' }),    // 'pending' | 'enabled' | 'disabled'
      last_used_at: { type: 'timestamptz', nullable: true },
      last_used_counter: int({ default: -1 }),
      recovery_code_hashes: { type: 'jsonb', default: [] },
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'totp_mfa_user_idx', columns: ['user_id'] }],
  },

  webauthn_passkeys: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      credential_id: text({ required: true }),
      public_key: text({ required: true }),
      counter: int({ default: 0 }),
      transports: { type: 'jsonb', default: [] },
      name: text({ nullable: true }),
      aaguid: text({ nullable: true }),
      last_used_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
    },
    indexes: [{ name: 'webauthn_credential_key', columns: ['credential_id'], unique: true }],
  },

  webauthn_authentication_challenges: {
    columns: {
      id: pk(),
      user_id: uuid({ nullable: true }),
      challenge: text({ required: true }),
      kind: text({ default: 'authentication' }),
      consumed_at: { type: 'timestamptz', nullable: true },
      expires_at: { type: 'timestamptz', required: true },
      created_at: ts(),
    },
  },

  admin_support_sessions: {
    // Delegated "support mode" (spec §32). Re-read on every request so a token cannot outlive it.
    columns: {
      id: pk(),
      admin_user_id: uuid({ required: true }),
      customer_user_id: uuid({ required: true }),
      reason: text({ nullable: true }),
      started_at: ts(),
      ends_at: { type: 'timestamptz', required: true },
      ended_at: { type: 'timestamptz', nullable: true },
    },
    indexes: [{ name: 'admin_support_sessions_customer_idx', columns: ['customer_user_id'] }],
  },

  audit_logs: {
    columns: {
      id: pk(),
      actor_id: uuid({ nullable: true }),
      actor_role: text({ nullable: true }),
      action: text({ required: true }),
      entity_type: text({ nullable: true }),
      entity_id: text({ nullable: true }),
      ip_address: text({ nullable: true }),
      user_agent: text({ nullable: true }),
      before: jsonb({ nullable: true }),
      after: jsonb({ nullable: true }),
      created_at: ts(),
    },
    indexes: [
      { name: 'audit_logs_actor_idx', columns: ['actor_id'] },
      { name: 'audit_logs_entity_idx', columns: ['entity_type', 'entity_id'] },
    ],
  },

  // -------------------------------------------------------------------------
  // Catalog
  // -------------------------------------------------------------------------
  catalog_products: {
    columns: {
      id: pk(),
      slug: text({ required: true }),
      name: text({ required: true }),
      category: text({ nullable: true }),
      description: text({ nullable: true }),
      status: text({ default: 'draft' }),       // 'draft' | 'active' | 'archived'
      sort_order: int({ default: 0 }),
      metadata: jsonb({ default: {} }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'catalog_products_slug_key', columns: ['slug'], unique: true }],
  },

  catalog_product_plans: {
    columns: {
      id: pk(),
      product_id: uuid({ required: true }),
      slug: text({ required: true }),
      name: text({ required: true }),
      description: text({ nullable: true }),
      status: text({ default: 'draft' }),
      sort_order: int({ default: 0 }),
      limits: jsonb({ default: {} }),
      metadata: jsonb({ default: {} }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [
      { name: 'catalog_plans_slug_key', columns: ['product_id', 'slug'], unique: true },
      { name: 'catalog_plans_product_idx', columns: ['product_id'] },
    ],
  },

  catalog_plan_pricing: {
    columns: {
      id: pk(),
      plan_id: uuid({ required: true }),
      currency: text({ default: 'USD' }),
      billing_cycle: text({ required: true }),   // 'monthly' | 'quarterly' | 'annual' | 'once'
      price: num({ required: true }),
      setup_fee: num({ default: 0 }),
      is_active: bool({ default: true }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'catalog_pricing_unique', columns: ['plan_id', 'currency', 'billing_cycle'], unique: true }],
  },

  catalog_plan_features: {
    columns: {
      id: pk(),
      plan_id: uuid({ required: true }),
      label: text({ required: true }),
      value: text({ nullable: true }),
      icon: text({ nullable: true }),
      sort_order: int({ default: 0 }),
      created_at: ts(),
    },
    indexes: [{ name: 'catalog_features_plan_idx', columns: ['plan_id'] }],
  },

  // -------------------------------------------------------------------------
  // Commerce & billing
  // -------------------------------------------------------------------------
  carts: {
    columns: {
      id: pk(),
      user_id: uuid({ nullable: true }),
      session_token: text({ nullable: true }),
      currency: text({ default: 'USD' }),
      status: text({ default: 'open' }),         // 'open' | 'converted' | 'abandoned'
      expires_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'carts_user_idx', columns: ['user_id'] }],
  },

  cart_items: {
    columns: {
      id: pk(),
      cart_id: uuid({ required: true }),
      plan_id: uuid({ required: true }),
      quantity: int({ default: 1 }),
      billing_cycle: text({ required: true }),
      currency: text({ default: 'USD' }),
      unit_price: num({ required: true }),
      setup_fee: num({ default: 0 }),
      domain: text({ nullable: true }),
      options: jsonb({ default: {} }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'cart_items_cart_idx', columns: ['cart_id'] }],
  },

  orders: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      cart_id: uuid({ nullable: true }),
      reference: text({ nullable: true }),
      currency: text({ default: 'USD' }),
      subtotal: num({ default: 0 }),
      tax_total: num({ default: 0 }),
      discount_total: num({ default: 0 }),
      total: num({ default: 0 }),
      status: text({ default: 'pending' }),      // 'pending' | 'paid' | 'cancelled' | 'failed'
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [
      { name: 'orders_user_idx', columns: ['user_id'] },
      { name: 'orders_reference_key', columns: ['reference'], unique: true, sparse: true },
    ],
  },

  order_items: {
    columns: {
      id: pk(),
      order_id: uuid({ required: true }),
      plan_id: uuid({ required: true }),
      description: text({ nullable: true }),
      quantity: int({ default: 1 }),
      billing_cycle: text({ nullable: true }),
      unit_price: num({ required: true }),
      line_total: num({ required: true }),
      service_id: uuid({ nullable: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'order_items_order_idx', columns: ['order_id'] }],
  },

  invoices: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      order_id: uuid({ nullable: true }),
      number: text({ nullable: true }),
      currency: text({ default: 'USD' }),
      subtotal: num({ default: 0 }),
      tax_total: num({ default: 0 }),
      discount_total: num({ default: 0 }),
      credit_total: num({ default: 0 }),
      total: num({ default: 0 }),
      amount_paid: num({ default: 0 }),
      status: text({ default: 'unpaid' }),       // 'unpaid' | 'paid' | 'partially_paid' | 'refunded' | 'cancelled'
      issued_at: ts({ default: 'now' }),
      due_at: { type: 'timestamptz', nullable: true },
      paid_at: { type: 'timestamptz', nullable: true },
      notes: text({ nullable: true }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [
      { name: 'invoices_user_idx', columns: ['user_id'] },
      { name: 'invoices_number_key', columns: ['number'], unique: true, sparse: true },
    ],
  },

  payments: {
    columns: {
      id: pk(),
      invoice_id: uuid({ nullable: true }),
      order_id: uuid({ nullable: true }),
      user_id: uuid({ required: true }),
      gateway: text({ required: true }),
      gateway_reference: text({ nullable: true }),
      currency: text({ default: 'USD' }),
      amount: num({ required: true }),
      status: text({ default: 'pending' }),      // 'pending' | 'succeeded' | 'failed' | 'refunded'
      confirmed_by: uuid({ nullable: true }),
      confirmed_at: { type: 'timestamptz', nullable: true },
      rejection_reason: text({ nullable: true }),
      metadata: jsonb({ default: {} }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [
      { name: 'payments_invoice_idx', columns: ['invoice_id'] },
      { name: 'payments_gateway_ref_idx', columns: ['gateway', 'gateway_reference'] },
    ],
  },

  billing_ledger: {
    // Append-only double-entry record. Rows are never updated or deleted — see
    // database/migrations/0023_enforce_billing_invariants.sql for the invariants this protects.
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      invoice_id: uuid({ nullable: true }),
      payment_id: uuid({ nullable: true }),
      entry_type: text({ required: true }),      // 'charge' | 'payment' | 'refund' | 'credit' | 'adjustment'
      amount: num({ required: true }),
      currency: text({ default: 'USD' }),
      description: text({ nullable: true }),
      idempotency_key: text({ nullable: true }),
      created_at: ts(),
    },
    indexes: [
      { name: 'billing_ledger_user_idx', columns: ['user_id'] },
      { name: 'billing_ledger_idempotency_key', columns: ['idempotency_key'], unique: true, sparse: true },
    ],
  },

  webhook_events: {
    columns: {
      id: pk(),
      provider: text({ required: true }),
      event_id: text({ nullable: true }),
      event_type: text({ nullable: true }),
      signature_valid: bool({ default: false }),
      processed_at: { type: 'timestamptz', nullable: true },
      status: text({ default: 'received' }),     // 'received' | 'processed' | 'failed' | 'duplicate'
      payload: jsonb({ default: {} }),
      error: text({ nullable: true }),
      received_at: ts(),
    },
    indexes: [{ name: 'webhook_events_dedupe_key', columns: ['provider', 'event_id'], unique: true }],
  },

  subscriptions: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      service_id: uuid({ nullable: true }),
      plan_id: uuid({ nullable: true }),
      billing_cycle: text({ nullable: true }),
      status: text({ default: 'active' }),       // 'active' | 'paused' | 'cancelled' | 'expired'
      current_period_start: { type: 'timestamptz', nullable: true },
      current_period_end: { type: 'timestamptz', nullable: true },
      renews_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'subscriptions_user_idx', columns: ['user_id'] }],
  },

  // -------------------------------------------------------------------------
  // Customer holdings & support
  // -------------------------------------------------------------------------
  customer_services: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      plan_id: uuid({ nullable: true }),
      label: text({ nullable: true }),
      status: text({ default: 'pending' }),      // 'pending' | 'active' | 'suspended' | 'terminated'
      domain: text({ nullable: true }),
      username: text({ nullable: true }),
      package: text({ nullable: true }),
      server_id: uuid({ nullable: true }),
      next_due_date: { type: 'timestamptz', nullable: true },
      provisioned_at: { type: 'timestamptz', nullable: true },
      terminated_at: { type: 'timestamptz', nullable: true },
      metadata: jsonb({ default: {} }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'customer_services_user_idx', columns: ['user_id'] }],
  },

  customer_domains: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      service_id: uuid({ nullable: true }),
      domain: text({ required: true }),
      registrar: text({ nullable: true }),
      status: text({ default: 'pending' }),
      registered_at: { type: 'timestamptz', nullable: true },
      expires_at: { type: 'timestamptz', nullable: true },
      auto_renew: bool({ default: false }),
      nameservers: { type: 'jsonb', default: [] },
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [
      { name: 'customer_domains_user_idx', columns: ['user_id'] },
      { name: 'customer_domains_domain_idx', columns: ['domain'] },
    ],
  },

  support_tickets: {
    columns: {
      id: pk(),
      reference: text({ nullable: true }),
      user_id: uuid({ required: true }),
      subject: text({ required: true }),
      department: text({ default: 'general' }),
      priority: text({ default: 'normal' }),     // 'low' | 'normal' | 'high' | 'urgent'
      status: text({ default: 'open' }),         // 'open' | 'answered' | 'customer_reply' | 'closed'
      last_reply_at: { type: 'timestamptz', nullable: true },
      assigned_to: uuid({ nullable: true }),
      closed_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [
      { name: 'support_tickets_user_idx', columns: ['user_id'] },
      { name: 'support_tickets_reference_key', columns: ['reference'], unique: true, sparse: true },
    ],
  },

  support_ticket_messages: {
    columns: {
      id: pk(),
      ticket_id: uuid({ required: true }),
      author_id: uuid({ required: true }),
      author_role: text({ default: 'customer' }),
      body: text({ required: true }),
      is_internal: bool({ default: false }),
      attachments: { type: 'jsonb', default: [] },
      created_at: ts(),
    },
    indexes: [{ name: 'support_messages_ticket_idx', columns: ['ticket_id'] }],
  },

  // -------------------------------------------------------------------------
  // Platform
  // -------------------------------------------------------------------------
  platform_settings: {
    columns: {
      key: text({ primaryKey: true }),
      value: jsonb({ nullable: true }),
      updated_by: uuid({ nullable: true }),
      updated_at: ts(),
    },
  },

  server_metrics: {
    columns: {
      id: pk(),
      server_id: uuid({ required: true }),
      cpu_percent: num({ nullable: true }),
      memory_percent: num({ nullable: true }),
      disk_percent: num({ nullable: true }),
      load_average: num({ nullable: true }),
      collected_at: ts(),
    },
    indexes: [{ name: 'server_metrics_server_idx', columns: ['server_id'] }],
  },
};

/** Column metadata for a table; throws if the table is unknown (a typo must not pass silently). */
function getTable(name) {
  const table = TABLES[name];
  if (!table) throw new Error(`Unknown table: ${name}`);
  return { name, ...table };
}

function hasTable(name) {
  return Object.prototype.hasOwnProperty.call(TABLES, name);
}

function tableNames() {
  return Object.keys(TABLES);
}

/** Name of the primary key column for a table. */
function primaryKey(name) {
  const table = getTable(name);
  const found = Object.entries(table.columns).find(([, def]) => def.primaryKey);
  return found ? found[0] : 'id';
}

module.exports = { TABLES, TYPES, getTable, hasTable, tableNames, primaryKey };
