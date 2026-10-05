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
      customer_id: uuid({ nullable: true }),
      product_id: uuid({ nullable: true }),
      plan_id: uuid({ nullable: true }),
      control_panel_id: uuid({ nullable: true }),
      license_id: uuid({ nullable: true }),
      label: text({ nullable: true }),
      status: text({ default: 'pending' }),      // 'pending' | 'active' | 'suspended' | 'terminated'
      domain: text({ nullable: true }),
      hostname: text({ nullable: true }),
      username: text({ nullable: true }),
      package: text({ nullable: true }),
      server_id: uuid({ nullable: true }),
      billing_cycle: text({ default: 'monthly' }),
      amount: num({ default: 0 }),
      currency: text({ default: 'USD' }),
      next_due_date: { type: 'timestamptz', nullable: true },
      suspension_date: { type: 'timestamptz', nullable: true },
      termination_date: { type: 'timestamptz', nullable: true },
      notes: text({ nullable: true }),
      external_reference: text({ nullable: true }),
      created_by: uuid({ nullable: true }),
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
      external_reference: text({ nullable: true }),
      notes: text({ nullable: true }),
      created_by: uuid({ nullable: true }),
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

  // -------------------------------------------------------------------------
  // Identity extras
  // -------------------------------------------------------------------------
  profile_images: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      content_type: text({ default: 'image/png' }),
      data_base64: text({ required: true }),
      size_bytes: int({ default: 0 }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'profile_images_user_key', columns: ['user_id'], unique: true }],
  },

  // -------------------------------------------------------------------------
  // Networking: DNS / SSL / firewall
  // -------------------------------------------------------------------------
  dns_zones: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      domain: text({ required: true }),
      provider: text({ default: 'internal' }),
      status: text({ default: 'active' }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'dns_zones_domain_key', columns: ['domain'], unique: true }],
  },

  dns_records: {
    columns: {
      id: pk(),
      zone_id: uuid({ required: true }),
      type: text({ required: true }),
      name: text({ required: true }),
      content: text({ required: true }),
      ttl: int({ default: 3600 }),
      priority: int({ nullable: true }),
      proxied: bool({ default: false }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'dns_records_zone_idx', columns: ['zone_id'] }],
  },

  ssl_certificates: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      domain: text({ required: true }),
      issuer: text({ default: 'letsencrypt' }),
      status: text({ default: 'pending' }),
      issued_at: { type: 'timestamptz', nullable: true },
      expires_at: { type: 'timestamptz', nullable: true },
      auto_renew: bool({ default: true }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'ssl_certificates_user_idx', columns: ['user_id'] }],
  },

  firewall_rules: {
    columns: {
      id: pk(),
      server_id: uuid({ nullable: true }),
      user_id: uuid({ nullable: true }),
      direction: text({ default: 'in' }),
      action: text({ default: 'allow' }),
      protocol: text({ default: 'tcp' }),
      port: int({ nullable: true }),
      cidr: text({ nullable: true }),
      description: text({ nullable: true }),
      enabled: bool({ default: true }),
      created_at: ts(),
      updated_at: ts(),
    },
  },

  // -------------------------------------------------------------------------
  // Servers / provisioning / infrastructure
  // -------------------------------------------------------------------------
  servers: {
    columns: {
      name: text({ nullable: true }),
      plan_id: uuid({ nullable: true }),
      region_id: uuid({ nullable: true }),
      os_id: uuid({ nullable: true }),
      id: pk(),
      user_id: uuid({ nullable: true }),
      hostname: text({ required: true }),
      provider: text({ nullable: true }),
      region: text({ nullable: true }),
      os: text({ nullable: true }),
      panel: text({ nullable: true }),
      status: text({ default: 'pending' }),
      ip_address: text({ nullable: true }),
      plan: text({ nullable: true }),
      metadata: jsonb({ default: {} }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'servers_hostname_key', columns: ['hostname'], unique: true }],
  },

  server_credentials: {
    columns: {
      kind: text({ default: 'password' }),
      secret: text({ nullable: true }),
      id: pk(),
      server_id: uuid({ required: true }),
      username: text({ nullable: true }),
      password_encrypted: text({ nullable: true }),
      ssh_key: text({ nullable: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'server_credentials_server_idx', columns: ['server_id'] }],
  },

  ssh_keys: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      name: text({ required: true }),
      public_key: text({ required: true }),
      fingerprint: text({ nullable: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'ssh_keys_user_idx', columns: ['user_id'] }],
  },

  provisioning_jobs: {
    columns: {
      user_id: uuid({ nullable: true }),
      kind: text({ nullable: true }),
      resource_type: text({ nullable: true }),
      resource_id: text({ nullable: true }),
      error: text({ nullable: true }),
      id: pk(),
      server_id: uuid({ nullable: true }),
      service_id: uuid({ nullable: true }),
      type: text({ nullable: true }),
      status: text({ default: 'queued' }),
      payload: jsonb({ default: {} }),
      result: jsonb({ nullable: true }),
      attempts: int({ default: 0 }),
      started_at: { type: 'timestamptz', nullable: true },
      finished_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'provisioning_jobs_status_idx', columns: ['status'] }],
  },

  operating_systems: {
    columns: {
      id: pk(),
      slug: text({ required: true }),
      name: text({ required: true }),
      family: text({ nullable: true }),
      vendor: text({ nullable: true }),
      description: text({ nullable: true }),
      logo_url: text({ nullable: true }),
      is_vps_supported: bool({ default: true }),
      is_dedicated_supported: bool({ default: true }),
      is_cloud_supported: bool({ default: true }),
      is_reinstall_supported: bool({ default: true }),
      sort_order: int({ default: 0 }),
      status: text({ default: 'ACTIVE' }),
      eol_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'operating_systems_slug_key', columns: ['slug'], unique: true }],
  },

  operating_system_versions: {
    columns: {
      id: pk(),
      operating_system_id: uuid({ required: true }),
      version: text({ required: true }),
      display_name: text({ nullable: true }),
      release_name: text({ nullable: true }),
      architecture_support: jsonb({ default: [] }),
      is_default: bool({ default: false }),
      is_recommended: bool({ default: false }),
      is_lts: bool({ default: false }),
      release_date: { type: 'timestamptz', nullable: true },
      end_of_life_date: { type: 'timestamptz', nullable: true },
      status: text({ default: 'ACTIVE' }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'os_versions_os_idx', columns: ['operating_system_id'] }],
  },

  // Uploaded OS logos. Binary content is stored base64-encoded; served with an ETag for caching.
  operating_system_logos: {
    columns: {
      id: pk(),
      operating_system_id: uuid({ required: true }),
      content_type: text({ required: true }),
      content: text({ required: true }),
      byte_size: int({ default: 0 }),
      sha256: text({ nullable: true }),
      original_filename: text({ nullable: true }),
      uploaded_by: uuid({ nullable: true }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'os_logos_os_idx', columns: ['operating_system_id'], unique: true }],
  },

  os_images: {
    columns: {
      provider_image_id: text({ nullable: true }),
      region_id: uuid({ nullable: true }),
      active: bool({ default: true }),
      id: pk(),
      os_id: uuid({ required: true }),
      version: text({ nullable: true }),
      arch: text({ default: 'x86_64' }),
      status: text({ default: 'active' }),
      verified_at: { type: 'timestamptz', nullable: true },
      verified_by: uuid({ nullable: true }),
      verification_error: text({ nullable: true }),
      created_at: ts(),
      updated_at: ts(),
    },
  },

  infra_providers: {
    columns: {
      type: text({ nullable: true }),
      active: bool({ default: true }),
      id: pk(),
      slug: text({ nullable: true }),
      name: text({ required: true }),
      kind: text({ default: 'cloud' }),
      status: text({ default: 'active' }),
      config: jsonb({ default: {} }),
      created_at: ts(),
    },
    indexes: [{ name: 'infra_providers_slug_key', columns: ['slug'], unique: true }],
  },

  regions: {
    columns: {
      active: bool({ default: true }),
      id: pk(),
      provider_id: uuid({ required: true }),
      code: text({ required: true }),
      name: text({ required: true }),
      created_at: ts(),
    },
  },

  server_plans: {
    columns: {
      price_cents: int({ default: 0 }),
      spec: jsonb(),
      active: bool({ default: true }),
      id: pk(),
      provider_id: uuid({ nullable: true }),
      slug: text({ nullable: true }),
      name: text({ required: true }),
      vcpu: int({ nullable: true }),
      ram_gb: num({ nullable: true }),
      disk_gb: num({ nullable: true }),
      monthly_price: num({ nullable: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'server_plans_slug_key', columns: ['slug'], unique: true }],
  },

  infrastructure_logs: {
    columns: {
      id: pk(),
      server_id: uuid({ nullable: true }),
      level: text({ default: 'info' }),
      message: text({ required: true }),
      context: jsonb({ default: {} }),
      created_at: ts(),
    },
  },

  notification_outbox: {
    columns: {
      updated_at: ts(),
      id: pk(),
      user_id: uuid({ nullable: true }),
      channel: text({ default: 'email' }),
      subject: text({ nullable: true }),
      body: text({ nullable: true }),
      status: text({ default: 'pending' }),
      delivered_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
    },
  },

  // Customer notification centre (read/unread per user).
  notifications: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      title: text({ nullable: true }),
      body: text({ nullable: true }),
      read_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
    },
    indexes: [{ name: 'notifications_user_idx', columns: ['user_id'] }],
  },

  // -------------------------------------------------------------------------
  // Control panels / licenses / services
  // -------------------------------------------------------------------------
  control_panels: {
    columns: {
      id: pk(),
      slug: text({ required: true }),
      name: text({ required: true }),
      vendor: text({ nullable: true }),
      status: text({ default: 'active' }),
      created_at: ts(),
    },
    indexes: [{ name: 'control_panels_slug_key', columns: ['slug'], unique: true }],
  },

  control_panel_plans: {
    columns: {
      user_id: uuid({ required: true }),
      hosting_plan_id: uuid({ nullable: true }),
      id: pk(),
      panel_id: uuid({ required: true }),
      name: text({ nullable: true }),
      price: num({ nullable: true }),
      created_at: ts(),
    },
  },

  licenses: {
    columns: {
      id: pk(),
      user_id: uuid({ nullable: true }),
      product: text({ required: true }),
      license_key: text({ nullable: true }),
      status: text({ default: 'active' }),
      activated_at: { type: 'timestamptz', nullable: true },
      expires_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
  },

  // -------------------------------------------------------------------------
  // Marketplace / deployments
  // -------------------------------------------------------------------------
  application_categories: {
    columns: {
      active: bool({ default: true }),
      id: pk(),
      slug: text({ required: true }),
      name: text({ required: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'app_categories_slug_key', columns: ['slug'], unique: true }],
  },

  applications: {
    columns: {
      version: text({ nullable: true }),
      price_cents: int({ default: 0 }),
      active: bool({ default: true }),
      icon: text({ nullable: true }),
      id: pk(),
      slug: text({ required: true }),
      name: text({ required: true }),
      category_id: uuid({ nullable: true }),
      description: text({ nullable: true }),
      long_description: text({ nullable: true }),
      website_url: text({ nullable: true }),
      repository_url: text({ nullable: true }),
      documentation_url: text({ nullable: true }),
      license: text({ nullable: true }),
      logo_url: text({ nullable: true }),
      deployment_type: text({ default: 'docker_compose' }),
      supported_hosting_types: jsonb({ default: [] }),
      min_cpu: int({ default: 1 }),
      min_memory_mb: int({ default: 512 }),
      min_storage_mb: int({ default: 5120 }),
      featured: bool({ default: false }),
      requires_admin_approval: bool({ default: false }),
      manifest: jsonb({ default: {} }),
      status: text({ default: 'draft' }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'applications_slug_key', columns: ['slug'], unique: true }],
  },

  // Application versions (marketplace §43): draft → published → deprecated, one stable at a time.
  application_versions: {
    columns: {
      id: pk(),
      application_id: uuid({ required: true }),
      version: text({ required: true }),
      release_notes: text({ nullable: true }),
      is_stable: bool({ default: false }),
      manifest: jsonb({ default: {} }),
      status: text({ default: 'draft' }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'app_versions_app_idx', columns: ['application_id'] }],
  },

  application_installations: {
    columns: {
      config: jsonb(),
      id: pk(),
      user_id: uuid({ required: true }),
      application_id: uuid({ required: true }),
      version_id: uuid({ nullable: true }),
      server_id: uuid({ nullable: true }),
      name: text({ nullable: true }),
      domain: text({ nullable: true }),
      plan_id: uuid({ nullable: true }),
      billing_period: text({ nullable: true }),
      backup_enabled: bool({ default: false }),
      order_id: uuid({ nullable: true }),
      status: text({ default: 'installing' }),
      url: text({ nullable: true }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'app_installations_user_idx', columns: ['user_id'] }],
  },

  deployments: {
    columns: {
      ref: text({ nullable: true }),
      service_id: uuid({ nullable: true }),
      id: pk(),
      user_id: uuid({ required: true }),
      installation_id: uuid({ nullable: true }),
      server_id: uuid({ nullable: true }),
      action: text({ nullable: true }),
      idempotency_key: text({ nullable: true }),
      requested_by: uuid({ nullable: true }),
      payload: jsonb({ default: {} }),
      status: text({ default: 'queued' }),
      source: text({ nullable: true }),
      logs: jsonb({ default: [] }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'deployments_user_idx', columns: ['user_id'] }],
  },

  // Application installation sub-resources: encrypted environment, backups, attached domains.
  // Environment values are WRITE-ONLY (encrypted, never returned); only keys are listed.
  application_environment: {
    columns: {
      id: pk(),
      installation_id: uuid({ required: true }),
      key: text({ required: true }),
      value_encrypted: text({ nullable: true }),
      is_secret: bool({ default: true }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'app_env_installation_idx', columns: ['installation_id'] }],
  },
  application_backups: {
    columns: {
      id: pk(),
      installation_id: uuid({ required: true }),
      status: text({ default: 'pending' }),
      size_bytes: int({ nullable: true }),
      location: text({ nullable: true }),
      completed_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'app_backups_installation_idx', columns: ['installation_id'] }],
  },
  application_domains: {
    columns: {
      id: pk(),
      installation_id: uuid({ required: true }),
      domain_id: uuid({ required: true }),
      primary: bool({ default: false }),
      created_at: ts(),
    },
    indexes: [{ name: 'app_domains_installation_idx', columns: ['installation_id'] }],
  },

  // -------------------------------------------------------------------------
  // Domain services & brokerage
  // -------------------------------------------------------------------------
  domain_searches: {
    columns: {
      id: pk(),
      user_id: uuid({ nullable: true }),
      query: text({ required: true }),
      kind: text({ default: 'single' }),
      results: jsonb({ default: [] }),
      created_at: ts(),
    },
  },

  domain_registrations: {
    columns: {
      domain_name: text({ nullable: true }),
      id: pk(),
      user_id: uuid({ required: true }),
      domain: text({ nullable: true }),
      registrar: text({ nullable: true }),
      years: int({ default: 1 }),
      status: text({ default: 'pending' }),
      price: num({ nullable: true }),
      provider_reference: text({ nullable: true }),
      provider_status: text({ nullable: true }),
      error_code: text({ nullable: true }),
      error_message: text({ nullable: true }),
      order_id: uuid({ nullable: true }),
      invoice_id: uuid({ nullable: true }),
      requested_at: { type: 'timestamptz', nullable: true },
      confirmed_at: { type: 'timestamptz', nullable: true },
      registered_at: { type: 'timestamptz', nullable: true },
      expires_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
  },

  domain_transfers: {
    columns: {
      domain_name: text({ nullable: true }),
      id: pk(),
      user_id: uuid({ required: true }),
      domain: text({ nullable: true }),
      auth_code: text({ nullable: true }),
      current_registrar: text({ nullable: true }),
      status: text({ default: 'pending' }),
      provider_status: text({ nullable: true }),
      provider_reference: text({ nullable: true }),
      provider_metadata: jsonb({ nullable: true }),
      error_code: text({ nullable: true }),
      error_message: text({ nullable: true }),
      order_id: uuid({ nullable: true }),
      invoice_id: uuid({ nullable: true }),
      initiated_at: { type: 'timestamptz', nullable: true },
      completed_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
  },

  domain_auctions: {
    columns: {
      user_id: uuid({ required: true }),
      domain_name: text(),
      starting_bid_cents: int({ default: 0 }),
      current_bid_cents: int({ default: 0 }),
      id: pk(),
      domain: text({ nullable: true }),
      starting_bid: num({ default: 0 }),
      current_bid: num({ default: 0 }),
      minimum_bid: num({ nullable: true }),
      bid_increment: num({ nullable: true }),
      seller_id: uuid({ nullable: true }),
      status: text({ default: 'open' }),
      starts_at: { type: 'timestamptz', nullable: true },
      ends_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
    },
  },

  domain_auction_bids: {
    columns: {
      amount_cents: int({ default: 0 }),
      id: pk(),
      auction_id: uuid({ required: true }),
      user_id: uuid({ required: true }),
      amount: num({ nullable: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'auction_bids_auction_idx', columns: ['auction_id'] }],
  },

  domain_watches: {
    columns: {
      domain_name: text({ nullable: true }),
      id: pk(),
      user_id: uuid({ required: true }),
      domain: text({ nullable: true }),
      status: text({ default: 'active' }),
      created_at: ts(),
    },
  },

  // Domain services extras: appraisals, WHOIS history, club, extensions, transactions.
  domain_appraisals: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      domain: text({ required: true }),
      status: text({ default: 'pending' }),
      estimated_value: num({ nullable: true }),
      currency: text({ default: 'USD' }),
      confidence: num({ nullable: true }),
      provider: text({ nullable: true }),
      error_code: text({ nullable: true }),
      completed_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'domain_appraisals_user_idx', columns: ['user_id'] }],
  },
  domain_whois_lookups: {
    columns: {
      id: pk(),
      user_id: uuid({ nullable: true }),
      domain: text({ required: true }),
      status: text({ default: 'unknown' }),
      source: text({ nullable: true }),
      privacy_protected: bool({ default: false }),
      registrar: text({ nullable: true }),
      raw: jsonb(),
      created_at: ts(),
    },
    indexes: [{ name: 'domain_whois_user_idx', columns: ['user_id'] }],
  },
  domain_club_plans: {
    columns: {
      id: pk(),
      name: text({ required: true }),
      description: text({ nullable: true }),
      billing_period: text({ default: 'monthly' }),
      price_cents: int({ default: 0 }),
      price_amount: num({ default: 0 }),
      discount_type: text({ default: 'percentage' }),
      discount_value: num({ default: 0 }),
      eligible_extensions: jsonb({ default: [] }),
      promotion: jsonb({ nullable: true }),
      status: text({ default: 'published' }),
      active: bool({ default: true }),
      created_at: ts(),
      updated_at: ts(),
    },
  },
  domain_club_memberships: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      plan_id: uuid({ required: true }),
      status: text({ default: 'active' }),
      started_at: ts(),
      cancelled_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'domain_club_memberships_user_idx', columns: ['user_id'] }],
  },
  domain_extensions: {
    columns: {
      id: pk(),
      tld: text({ required: true }),
      register_price_cents: int({ default: 0 }),
      renew_price_cents: int({ default: 0 }),
      is_trending: bool({ default: false }),
      description: text({ nullable: true }),
      restrictions: text({ nullable: true }),
      registration_requirements: text({ nullable: true }),
      status: text({ default: 'active' }),
      active: bool({ default: true }),
      created_at: ts(),
      updated_at: ts(),
    },
  },
  domain_transactions: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      transaction_type: text({ nullable: true }),
      status: text({ default: 'pending' }),
      amount: num({ default: 0 }),
      currency: text({ default: 'USD' }),
      order_id: uuid({ nullable: true }),
      invoice_id: uuid({ nullable: true }),
      payment_id: uuid({ nullable: true }),
      provider_reference: text({ nullable: true }),
      error_code: text({ nullable: true }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'domain_transactions_user_idx', columns: ['user_id'] }],
  },

  // Registrar/RDAP/appraisal/auction connectors. Credentials are WRITE-ONLY: stored encrypted and
  // never returned by any API. `status: 'connected'` is only ever set by a real successful test.
  domain_service_providers: {
    columns: {
      id: pk(),
      provider_key: text({ required: true }),
      name: text({ required: true }),
      adapter_key: text({ required: true }),
      provider_type: text({ required: true }),
      api_base_url: text({ nullable: true }),
      environment: text({ default: 'production' }),
      capabilities: jsonb({ default: {} }),
      configuration: jsonb({ default: {} }),
      status: text({ default: 'not_configured' }),
      connection_tested: bool({ default: false }),
      connection_succeeded: bool({ default: false }),
      last_error: text({ nullable: true }),
      credentials_encrypted: text({ nullable: true }),
      created_by: uuid({ nullable: true }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'domain_service_providers_key_idx', columns: ['provider_key'], unique: true }],
  },

  domain_brokerage_cases: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      domain_name: text({ required: true }),
      owner_id: uuid({ nullable: true }),
      priority: text({ default: 'normal' }),
      budget_cents: int({ nullable: true }),
      notes: text({ nullable: true }),
      status: text({ default: 'open' }),
      created_at: ts(),
      updated_at: ts(),
    },
  },

  domain_brokerage_providers: {
    columns: {
      type: text({ nullable: true }),
      active: bool({ default: true }),
      id: pk(),
      name: text({ required: true }),
      status: text({ default: 'active' }),
      created_at: ts(),
    },
  },

  // -------------------------------------------------------------------------
  // Domain brokerage workflow (spec §11): cases + offers, messages, events,
  // payments, transfers, assignments and providers. Mirrors the Fastify schema.
  // -------------------------------------------------------------------------
  domain_broker_cases: {
    columns: {
      id: pk(),
      brokerage_id: text({ required: true }),
      user_id: uuid({ required: true }),
      customer_name: text({ nullable: true }),
      contact_information: text({ nullable: true }),
      domain: text({ required: true }),
      domain_status: text({ default: 'registered' }),
      acquisition_route: text({ default: 'manual_broker_required' }),
      max_budget: num({ nullable: true }),
      currency: text({ default: 'USD' }),
      opening_offer: num({ nullable: true }),
      current_offer: num({ nullable: true }),
      deadline_at: { type: 'timestamptz', nullable: true },
      negotiation_instructions: text({ nullable: true }),
      customer_message: text({ nullable: true }),
      terms_accepted_at: { type: 'timestamptz', nullable: true },
      idempotency_key: text({ nullable: true }),
      status: text({ default: 'request_submitted' }),
      payment_status: text({ nullable: true }),
      transfer_status: text({ nullable: true }),
      assigned_broker_id: uuid({ nullable: true }),
      provider_id: uuid({ nullable: true }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [
      { name: 'domain_broker_cases_user_idx', columns: ['user_id'] },
      { name: 'domain_broker_cases_idem_uq', columns: ['user_id', 'idempotency_key'], unique: true },
    ],
  },
  domain_broker_offers: {
    columns: {
      id: pk(),
      case_id: uuid({ required: true }),
      amount: num({ required: true }),
      currency: text({ default: 'USD' }),
      sender_type: text({ default: 'customer' }),
      recipient_type: text({ default: 'customer' }),
      status: text({ default: 'open' }),
      expires_at: { type: 'timestamptz', nullable: true },
      provider_reference: text({ nullable: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'domain_broker_offers_case_idx', columns: ['case_id'] }],
  },
  domain_broker_messages: {
    columns: {
      id: pk(),
      case_id: uuid({ required: true }),
      author_id: uuid({ nullable: true }),
      visibility: text({ default: 'customer' }),
      body: text({ required: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'domain_broker_messages_case_idx', columns: ['case_id'] }],
  },
  domain_broker_events: {
    columns: {
      id: pk(),
      case_id: uuid({ required: true }),
      actor_id: uuid({ nullable: true }),
      event_type: text({ required: true }),
      result: text({ nullable: true }),
      metadata: jsonb(),
      correlation_id: text({ nullable: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'domain_broker_events_case_idx', columns: ['case_id'] }],
  },
  domain_broker_documents: {
    columns: {
      id: pk(),
      case_id: uuid({ required: true }),
      name: text({ nullable: true }),
      visibility: text({ default: 'customer' }),
      created_at: ts(),
    },
  },
  domain_broker_payments: {
    columns: {
      id: pk(),
      case_id: uuid({ required: true }),
      acquisition_amount: num({ default: 0 }),
      brokerage_fee: num({ default: 0 }),
      transfer_fee: num({ default: 0 }),
      payment_fee: num({ default: 0 }),
      total_amount: num({ default: 0 }),
      currency: text({ default: 'USD' }),
      status: text({ default: 'pending' }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'domain_broker_payments_case_uq', columns: ['case_id'], unique: true }],
  },
  domain_broker_transfers: {
    columns: {
      id: pk(),
      case_id: uuid({ required: true }),
      status: text({ default: 'not_started' }),
      registrar: text({ nullable: true }),
      provider_reference: text({ nullable: true }),
      failure_reason: text({ nullable: true }),
      initiated_at: { type: 'timestamptz', nullable: true },
      completed_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'domain_broker_transfers_case_uq', columns: ['case_id'], unique: true }],
  },
  domain_broker_assignments: {
    columns: {
      id: pk(),
      case_id: uuid({ required: true }),
      broker_id: uuid({ required: true }),
      assigned_by: uuid({ nullable: true }),
      created_at: ts(),
    },
  },
  domain_broker_providers: {
    columns: {
      id: pk(),
      provider_key: text({ required: true }),
      name: text({ required: true }),
      provider_type: text({ default: 'manual' }),
      status: text({ default: 'configured' }),
      environment: text({ default: 'production' }),
      capabilities: jsonb(),
      last_health_check_at: { type: 'timestamptz', nullable: true },
      last_error: text({ nullable: true }),
      created_at: ts(),
    },
  },
  domain_broker_audit_logs: {
    columns: {
      id: pk(),
      case_id: uuid({ nullable: true }),
      actor_id: uuid({ nullable: true }),
      action: text({ required: true }),
      metadata: jsonb(),
      created_at: ts(),
    },
  },

  // -------------------------------------------------------------------------
  // Cloudflare
  // -------------------------------------------------------------------------
  cloudflare_accounts: {
    columns: {
      user_id: uuid({ nullable: true }),
      account_name: text(),
      api_token: text(),
      id: pk(),
      name: text({ nullable: true }),
      account_id: text({ nullable: true }),
      cloudflare_account_id: text({ nullable: true }),
      encrypted_api_token: text({ nullable: true }),
      api_base_url: text({ nullable: true }),
      default_zone_type: text({ nullable: true }),
      default_ssl_mode: text({ nullable: true }),
      default_proxied: bool({ nullable: true }),
      created_by: uuid({ nullable: true }),
      status: text({ default: 'active' }),
      created_at: ts(),
    },
  },

  cloudflare_plan_mappings: {
    columns: {
      product_id: uuid({ nullable: true }),
      plan_id: uuid({ nullable: true }),
      plan_name: text({ nullable: true }),
      product_name: text({ nullable: true }),
      id: pk(),
      plan_slug: text({ nullable: true }),
      cloudflare_plan: text({ nullable: true }),
      plan_status: text({ default: 'active' }),
      entitlements: jsonb({ default: {} }),
      max_domains: int({ nullable: true }),
      provisioning_mode: text({ nullable: true }),
      default_ssl_mode: text({ nullable: true }),
      default_proxied: bool({ nullable: true }),
      created_by: uuid({ nullable: true }),
      created_at: ts(),
      updated_at: ts(),
    },
  },

  cloudflare_services: {
    columns: {
      account_id: uuid({ nullable: true }),
      plan_id: uuid({ nullable: true }),
      zone_name: text({ nullable: true }),
      id: pk(),
      user_id: uuid({ required: true }),
      zone: text({ nullable: true }),
      plan: text({ nullable: true }),
      zone_id: text({ nullable: true }),
      name_server_1: text({ nullable: true }),
      name_server_2: text({ nullable: true }),
      cloudflare_plan: text({ nullable: true }),
      plan_name: text({ nullable: true }),
      ssl_mode: text({ nullable: true }),
      development_mode_until: { type: 'timestamptz', nullable: true },
      customer_domain_id: uuid({ nullable: true }),
      activation_status: text({ nullable: true }),
      last_synced_at: { type: 'timestamptz', nullable: true },
      status: text({ default: 'pending' }),
      created_at: ts(),
      updated_at: ts(),
    },
  },

  cloudflare_jobs: {
    columns: {
      account_id: uuid({ nullable: true }),
      kind: text({ nullable: true }),
      payload: jsonb(),
      id: pk(),
      service_id: uuid({ nullable: true }),
      type: text({ nullable: true }),
      status: text({ default: 'queued' }),
      created_at: ts(),
      updated_at: ts(),
    },
  },

  cloudflare_logs: {
    columns: {
      id: pk(),
      job_id: uuid({ nullable: true }),
      level: text({ default: 'info' }),
      message: text({ required: true }),
      created_at: ts(),
    },
  },

  // Upstream Cloudflare API call log (admin observability). Populated by the deferred provider
  // worker; the admin logs/overview endpoints read it. success=false drives the error counters.
  cloudflare_api_logs: {
    columns: {
      id: pk(),
      account_id: uuid({ nullable: true }),
      service_id: uuid({ nullable: true }),
      method: text({ nullable: true }),
      path: text({ nullable: true }),
      status_code: int({ nullable: true }),
      success: bool({ default: true }),
      error_code: text({ nullable: true }),
      duration_ms: int({ nullable: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'cf_api_logs_service_idx', columns: ['service_id'] }],
  },

  // Customer Cloudflare feature caches. The live Cloudflare client is deferred, so these tables
  // are the synchronized local view: DNS records, firewall access rules and per-zone settings.
  // Cloudflare remains the source of truth; Sync refreshes the cache from the (deferred) worker.
  cloudflare_dns_records: {
    columns: {
      id: pk(),
      service_id: uuid({ required: true }),
      cloudflare_record_id: text({ nullable: true }),
      type: text({ required: true }),
      name: text({ required: true }),
      content: text({ required: true }),
      ttl: int({ default: 1 }),
      proxied: bool({ default: false }),
      priority: int({ nullable: true }),
      comment: text({ nullable: true }),
      ownership: text({ default: 'CUSTOMER_MANAGED' }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'cf_dns_records_service_idx', columns: ['service_id'] }],
  },
  cloudflare_access_rules: {
    columns: {
      id: pk(),
      service_id: uuid({ required: true }),
      cloudflare_rule_id: text({ nullable: true }),
      target: text({ nullable: true }),
      value: text({ required: true }),
      mode: text({ required: true }),
      notes: text({ nullable: true }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'cf_access_rules_service_idx', columns: ['service_id'] }],
  },
  cloudflare_zone_settings: {
    columns: {
      id: pk(),
      service_id: uuid({ required: true }),
      settings: jsonb({ default: {} }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'cf_zone_settings_service_idx', columns: ['service_id'], unique: true }],
  },

  // -------------------------------------------------------------------------
  // Revenue Guardian
  // -------------------------------------------------------------------------
  rg_recovery_cases: {
    columns: {
      customer_id: uuid({ nullable: true }),
      owner_id: uuid({ nullable: true }),
      priority: text({ default: 'normal' }),
      risk_level: text({ nullable: true }),
      id: pk(),
      user_id: uuid({ required: true }),
      invoice_id: uuid({ nullable: true }),
      amount: num({ default: 0 }),
      status: text({ default: 'open' }),
      assigned_to: uuid({ nullable: true }),
      created_at: ts(),
      updated_at: ts(),
    },
  },

  rg_follow_ups: {
    columns: {
      kind: text({ default: 'note' }),
      body: text({ nullable: true }),
      created_by: uuid({ nullable: true }),
      id: pk(),
      case_id: uuid({ required: true }),
      note: text({ nullable: true }),
      due_at: { type: 'timestamptz', nullable: true },
      done: bool({ default: false }),
      created_at: ts(),
    },
  },

  rg_payment_promises: {
    columns: {
      amount_cents: int({ default: 0 }),
      due_at: text({ nullable: true }),
      status: text({ default: 'promised' }),
      created_by: uuid({ nullable: true }),
      id: pk(),
      case_id: uuid({ required: true }),
      promised_at: { type: 'timestamptz', nullable: true },
      amount: num({ default: 0 }),
      kept: bool({ nullable: true }),
      created_at: ts(),
    },
  },

  rg_assignment_rules: {
    columns: {
      staff_id: uuid({ nullable: true }),
      priority: int({ default: 100 }),
      active: bool({ default: true }),
      id: pk(),
      name: text({ nullable: true }),
      predicate: jsonb({ default: {} }),
      assignee: uuid({ nullable: true }),
      enabled: bool({ default: true }),
      created_at: ts(),
    },
  },

  rg_automation_rules: {
    columns: {
      trigger: text({ nullable: true }),
      active: bool({ default: true }),
      id: pk(),
      name: text({ required: true }),
      action: text({ required: true }),
      enabled: bool({ default: true }),
      created_at: ts(),
    },
  },

  // -------------------------------------------------------------------------
  // AI support & AI control plane
  // -------------------------------------------------------------------------
  ai_support_agents: {
    columns: {
      active: bool({ default: true }),
      role: text({ nullable: true }),
      system_prompt: text({ nullable: true }),
      id: pk(),
      name: text({ required: true }),
      presence: text({ default: 'offline' }),
      created_at: ts(),
    },
  },

  ai_support_conversations: {
    columns: {
      agent_id: uuid({ nullable: true }),
      subject: text({ nullable: true }),
      id: pk(),
      user_id: uuid({ nullable: true }),
      visitor_name: text({ nullable: true }),
      visitor_email: text({ nullable: true }),
      escalation_reason: text({ nullable: true }),
      escalation_note: text({ nullable: true }),
      priority: text({ default: 'normal' }),
      assigned_agent_id: uuid({ nullable: true }),
      support_ticket_id: uuid({ nullable: true }),
      source: text({ nullable: true }),
      status: text({ default: 'AI_ACTIVE' }),
      last_message_at: { type: 'timestamptz', nullable: true },
      resolved_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
  },

  // Support agent presence (online/busy/offline + capacity). One row per agent, upserted.
  support_agent_presence: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      status: text({ default: 'OFFLINE' }),
      capacity: int({ default: 3 }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'support_presence_user_idx', columns: ['user_id'], unique: true }],
  },

  ai_support_messages: {
    columns: {
      id: pk(),
      conversation_id: uuid({ required: true }),
      role: text({ default: 'user' }),
      content: text({ required: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'ai_messages_conversation_idx', columns: ['conversation_id'] }],
  },

  ai_support_knowledge: {
    columns: {
      trigger: text({ nullable: true }),
      id: pk(),
      title: text({ required: true }),
      body: text({ required: true }),
      created_at: ts(),
    },
  },

  newsletter_subscriptions: {
    columns: {
      id: pk(),
      name: text({ nullable: true }),
      email: text({ required: true }),
      source: text({ nullable: true }),
      status: text({ default: 'ACTIVE' }),
      created_at: ts(),
      updated_at: ts(),
    },
    indexes: [{ name: 'newsletter_email_key', columns: ['email'], unique: true }],
  },

  ai_registry: {
    columns: {
      id: pk(),
      slug: text({ required: true }),
      name: text({ required: true }),
      kind: text({ default: 'model' }),
      status: text({ default: 'active' }),
      metadata: jsonb({ default: {} }),
      created_at: ts(),
    },
    indexes: [{ name: 'ai_registry_slug_key', columns: ['slug'], unique: true }],
  },

  // -------------------------------------------------------------------------
  // Tools center
  // -------------------------------------------------------------------------
  tools_history: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      tool_slug: text({ required: true }),
      input: jsonb({ nullable: true }),
      output: jsonb({ nullable: true }),
      created_at: ts(),
    },
  },

  tools_favorites: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      tool_slug: text({ required: true }),
      created_at: ts(),
    },
    indexes: [{ name: 'tools_favorites_unique', columns: ['user_id', 'tool_slug'], unique: true }],
  },

  tools_reports: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      tool_slug: text({ required: true }),
      title: text({ required: true }),
      content: jsonb({ default: {} }),
      created_at: ts(),
    },
  },

  tools_monitors: {
    columns: {
      id: pk(),
      user_id: uuid({ required: true }),
      url: text({ required: true }),
      interval_seconds: int({ default: 60 }),
      status: text({ default: 'unknown' }),
      last_checked_at: { type: 'timestamptz', nullable: true },
      created_at: ts(),
      updated_at: ts(),
    },
  },

  agent_heartbeats: {
    columns: {
      last_seen_at: ts(),
      id: pk(),
      agent_id: text({ nullable: true }),
      server_id: uuid({ nullable: true }),
      payload: jsonb({ default: {} }),
      created_at: ts(),
    },
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
