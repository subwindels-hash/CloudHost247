# Migration renumber note (PR #113 merge resolution, 2026-11-09)

During merge of `arena/fe9b2088-cloudhost247` into `main`, a version collision was found:

- Our branch (Phases 14/16) had created `0093_refund_idempotency_key.sql` and
  `0094_refund_idempotency_global_uniqueness.sql`.
- `main` had independently advanced with `0093_add_ga4_configuration.sql`,
  `0094_add_ga4_checkout_context.sql`, `0095_add_ga4_purchase_delivery.sql`,
  `0096_create_email_forensics.sql`.
- `schema_migrations.version` is PRIMARY KEY — duplicate versions are unflashable.

Resolution: our two migrations are renumbered, preserving content and behavior:

- `0093_refund_idempotency_key.sql` → **`0097_refund_idempotency_key.sql`**
- `0094_refund_idempotency_global_uniqueness.sql` → **`0098_refund_idempotency_global_uniqueness.sql`**

Both use `IF NOT EXISTS` guards (`ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`,
`DROP INDEX IF EXISTS`), so a database that already applied either change under its old number
re-applies 0097/0098 as a no-op and records the new version row.

Historical phase reports (PHASE-14/PHASE-16/INDEPENDENT-SECURITY-REVIEW, Phase-27 artifacts) still
name 0093/0094 — those numbers were correct when written; this note is their authoritative
renumber mapping. Historical evidence is preserved, not silently rewritten.

Verification: `tests/integration/migrate.test.ts` 10/10 (PGlite applies all 96 migrations in
order, zero duplicates); `tsc` exit 0.
