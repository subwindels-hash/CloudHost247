import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { getAppliedMigrations, listMigrationFiles, migrateUp, status, verify } from '../../database/migrate';

/**
 * Runs the *real* migration SQL files against @electric-sql/pglite — a WASM-compiled, real
 * PostgreSQL engine — so this test exercises actual Postgres SQL semantics without requiring a
 * running PostgreSQL server in CI or on a developer machine. This directly satisfies the
 * "migrations work" verification step required before cPanel deployment is considered ready.
 */
describe('migration runner against the real database/migrations SQL files', () => {
  let db: PGlite;
  let client: PgliteClient;

  beforeEach(async () => {
    db = new PGlite();
    client = new PgliteClient(db);
  });

  afterEach(async () => {
    await db.close();
  });

  const EXPECTED_MIGRATIONS = [
    '0001_create_users.sql',
    '0002_create_auth_audit_log.sql',
    '0003_create_revoked_tokens.sql',
    '0004_create_catalog_products.sql',
    '0005_create_catalog_product_plans.sql',
    '0006_create_catalog_plan_pricing.sql',
    '0007_create_catalog_plan_features.sql',
    '0008_create_customer_services.sql',
    '0009_create_customer_domains.sql',
    '0010_create_support_tickets.sql',
    '0011_create_support_ticket_messages.sql',
    '0012_add_password_changed_at_to_users.sql',
    '0013_extend_auth_audit_log_event_types.sql',
    '0014_create_carts.sql',
    '0015_create_cart_items.sql',
    '0016_create_orders.sql',
    '0017_create_order_items.sql',
    '0018_create_invoices.sql',
    '0019_create_billing_ledger.sql',
    '0020_create_payments.sql',
    '0021_add_payment_confirmation_fields.sql',
    '0022_extend_auth_audit_log_event_types_for_payments.sql',
    '0023_enforce_billing_invariants.sql',
    '0024_create_webhook_events.sql',
    '0025_extend_auth_audit_log_for_admin_billing.sql',
    '0026_create_domain_brokerage.sql',
    // Phase 6 — marketplace, deployments, servers, domains, billing lifecycle, audit.
    '0027_create_roles_user_roles.sql',
    '0028_create_servers_server_credentials.sql',
    '0029_create_application_categories.sql',
    '0030_create_applications.sql',
    '0031_create_application_versions.sql',
    '0032_create_application_installations.sql',
    '0033_create_deployments.sql',
    '0034_extend_domains.sql',
    '0035_create_application_environment_volumes.sql',
    '0036_create_backups.sql',
    '0037_create_subscriptions.sql',
    '0038_create_audit_logs.sql',
    '0039_create_server_metrics.sql',
    '0040_create_platform_settings.sql',
    '0041_create_os_catalog_and_server_provisioning.sql',
    '0042_expand_infrastructure_providers_and_server_operations.sql',
    '0043_create_control_panels_and_plans.sql',
    '0044_create_dns_zones_and_records.sql',
    '0045_create_ssl_certificates.sql',
    '0046_create_firewall_rules.sql',
    '0047_infrastructure_adapter_coverage.sql',
    '0048_operating_system_logo_assets.sql',
    '0049_notification_outbox_delivery_scheduling.sql',
    '0050_server_state_reconciliation.sql',
    '0051_customer_identity_and_support_sessions.sql',
  ];

  it('finds the committed migration files in order', () => {
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(EXPECTED_MIGRATIONS.length);
    expect(files.map((f) => f.name).slice(0, EXPECTED_MIGRATIONS.length)).toEqual(EXPECTED_MIGRATIONS);
  });

  it('applies all pending migrations and records them in schema_migrations', async () => {
    const result = await migrateUp(client, { isProduction: false });
    expect(result.applied).toEqual(EXPECTED_MIGRATIONS);

    const applied = await getAppliedMigrations(client);
    expect(applied.map((a) => a.name)).toEqual(EXPECTED_MIGRATIONS);

    const tables = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        'users',
        'user_profile_images',
        'admin_support_sessions',
        'security_number_attempts',
        'auth_audit_log',
        'revoked_tokens',
        'products',
        'product_plans',
        'plan_pricing',
        'plan_features',
        'schema_migrations',
        // Phase 6
        'roles',
        'servers',
        'server_credentials',
        'application_categories',
        'applications',
        'application_versions',
        'application_installations',
        'deployments',
        'deployment_steps',
        'deployment_events',
        'application_domains',
        'application_environment',
        'application_volumes',
        'backups',
        'subscriptions',
        'audit_logs',
        'server_metrics',
        'platform_settings',
        'operating_systems',
        'operating_system_versions',
        'infrastructure_providers',
        'infrastructure_regions',
        'infrastructure_datacenters',
        'server_os_images',
        'server_product_configurations',
        'provisioning_jobs',
        'customer_ssh_keys',
        'user_notifications',
      ])
    );
  });

  it('is idempotent: running up twice applies nothing the second time', async () => {
    await migrateUp(client, { isProduction: false });
    const second = await migrateUp(client, { isProduction: false });
    expect(second.applied).toEqual([]);
  });

  it('actually enforces the users table constraints created by the migration', async () => {
    await migrateUp(client, { isProduction: false });

    await client.query(
      "INSERT INTO users (id, email, password_hash, full_name) VALUES ('11111111-1111-1111-1111-111111111111', 'a@example.com', 'hash', 'A')"
    );

    await expect(
      client.query(
        "INSERT INTO users (id, email, password_hash, full_name, role) VALUES ('22222222-2222-2222-2222-222222222222', 'b@example.com', 'hash', 'B', 'not-a-real-role')"
      )
    ).rejects.toThrow();

    // Case-insensitive unique email index should reject a duplicate with different casing.
    await expect(
      client.query(
        "INSERT INTO users (id, email, password_hash, full_name) VALUES ('33333333-3333-3333-3333-333333333333', 'A@EXAMPLE.COM', 'hash', 'A2')"
      )
    ).rejects.toThrow();
  });

  it('refuses to apply migrations in production without explicit confirmation', async () => {
    const result = await migrateUp(client, { isProduction: true, confirmedForProduction: false });
    expect(result.applied).toEqual([]);
    expect(result.skippedReason).toMatch(/explicit confirmation/i);

    const applied = await getAppliedMigrations(client);
    expect(applied).toEqual([]);
  });

  it('applies in production once explicitly confirmed', async () => {
    const result = await migrateUp(client, { isProduction: true, confirmedForProduction: true });
    expect(result.applied.length).toBe(EXPECTED_MIGRATIONS.length);
  });

  it('status reports pending migrations before running and applied after', async () => {
    const before = await status(client);
    expect(before.every((m) => !m.applied)).toBe(true);

    await migrateUp(client, { isProduction: false });

    const after = await status(client);
    expect(after.every((m) => m.applied)).toBe(true);
    expect(after.every((m) => m.checksumMatches === true)).toBe(true);
  });

  it('verify() detects checksum drift without mutating anything', async () => {
    await migrateUp(client, { isProduction: false });
    const ok = await verify(client);
    expect(ok.ok).toBe(true);

    // Simulate drift: someone hand-edited an already-applied migration's checksum record.
    await client.query("UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE version = '0001'");
    const drifted = await verify(client);
    expect(drifted.ok).toBe(false);
    expect(drifted.drift[0]?.name).toBe('0001_create_users.sql');
  });

  it('refuses to apply further migrations when drift is detected', async () => {
    await migrateUp(client, { isProduction: false });
    await client.query("UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE version = '0001'");

    await expect(migrateUp(client, { isProduction: false })).rejects.toThrow(/checksum drift/i);
  });

  it('rolls back a failing migration file cleanly (no partial schema left behind)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ch247-migrations-'));
    writeFileSync(path.join(dir, '0001_ok.sql'), 'CREATE TABLE ok_table (id int primary key);');
    writeFileSync(path.join(dir, '0002_broken.sql'), 'CREATE TABLE broken_table (id int primary key); THIS IS NOT SQL;');

    await expect(migrateUp(client, { isProduction: false }, dir)).rejects.toThrow(/0002_broken\.sql failed/);

    const tables = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    // 0001 committed successfully; 0002's own (broken) DDL must not have partially applied.
    expect(tables.rows.map((r) => r.table_name)).toEqual(expect.arrayContaining(['ok_table']));
    expect(tables.rows.map((r) => r.table_name)).not.toContain('broken_table');

    rmSync(dir, { recursive: true, force: true });
  });
});
