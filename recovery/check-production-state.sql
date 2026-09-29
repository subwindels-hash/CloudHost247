-- ============================================================================
-- CloudHost247 — Phase 5 production state check.  READ ONLY.
--
-- Answers the one question that cannot be answered from the development
-- sandbox: has any Phase 5 schema or financial data actually reached your
-- production database?
--
-- Every statement is a SELECT, inside a READ ONLY transaction. Nothing is
-- created, altered or deleted. Safe to run against live production.
--
-- Usage:
--   psql "$DATABASE_URL" -X -f recovery/check-production-state.sql
--
-- How to read the output is documented at the bottom of this file.
-- ============================================================================

BEGIN TRANSACTION READ ONLY;

\echo ''
\echo '--- 1. Do the Phase 5 tables even exist? ---'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('carts','cart_items','orders','order_items',
                     'invoices','billing_ledger','payments')
ORDER BY table_name;
\echo '    (7 rows = full Phase 5 schema present; 0 rows = Phase 5 never reached this database)'

\echo ''
\echo '--- 2a. Have the Phase 5B/5C migrations 0018-0022 specifically been applied? ---'
-- Lists all five by name and shows APPLIED / not applied for each, so the answer does not depend
-- on reading a possibly-empty result set correctly.
-- NOTE: schema_migrations.version stores the four-digit prefix only ('0018'), not the full
-- filename. Matching on the filename silently reports "not applied" for every row even on a
-- database where the migrations ARE applied, which is the exact opposite of the truth and the
-- wrong answer to base a rollback decision on.
SELECT m.version,
       m.description,
       CASE WHEN s.version IS NULL THEN 'not applied' ELSE 'APPLIED' END AS status,
       s.applied_at
FROM (VALUES
        ('0018', 'create_invoices'),
        ('0019', 'create_billing_ledger'),
        ('0020', 'create_payments'),
        ('0021', 'add_payment_confirmation_fields'),
        ('0022', 'extend_auth_audit_log_event_types_for_payments')
     ) AS m(version, description)
LEFT JOIN schema_migrations s ON s.version = m.version
ORDER BY m.version;
\echo '    (all five "not applied" = no Phase 5B/5C schema has ever reached this database)'

\echo ''
\echo '--- 2b. Every Phase 5 migration applied here (>= 0014, includes 5A commerce) ---'
SELECT version, applied_at
FROM schema_migrations
WHERE version >= '0014'
ORDER BY version;
\echo '    (no rows = NO Phase 5 migration of any kind has ever run here)'

\echo ''
\echo '--- 3. Does any financial data exist? ---'
SELECT (SELECT count(*) FROM orders)         AS orders,
       (SELECT count(*) FROM order_items)    AS order_items,
       (SELECT count(*) FROM invoices)       AS invoices,
       (SELECT count(*) FROM billing_ledger) AS ledger_entries,
       (SELECT count(*) FROM payments)       AS payments;

\echo ''
\echo '--- 4. Has any real payment ever been recorded? ---'
SELECT id, provider, method, status, amount, currency, completed_at, confirmed_by_user_id
FROM payments
WHERE status <> 'pending'
ORDER BY created_at;
\echo '    (no rows = no payment has ever been confirmed, failed or refunded)'

\echo ''
\echo '--- 5. CRITICAL: has the Phase 5C double-credit defect already fired? ---'
\echo '    (see PHASE_5_CHECKPOINT_REPORT.md section 3.1)'
SELECT invoice_id,
       count(*)    AS ledger_entries,
       sum(amount) AS total_credited
FROM billing_ledger
WHERE entry_type = 'payment'
GROUP BY invoice_id
HAVING count(*) > 1
ORDER BY count(*) DESC;
\echo '    (no rows = no invoice double-credited. ANY row is a real double-credit:'
\echo '     correct it with a compensating entry, NEVER by deleting ledger rows.)'

\echo ''
\echo '--- 6. Cross-check: is any invoice recorded as over-paid? ---'
SELECT i.invoice_number,
       i.status,
       i.total_amount,
       COALESCE(sum(l.amount), 0) AS ledger_payments
FROM invoices i
LEFT JOIN billing_ledger l
       ON l.invoice_id = i.id AND l.entry_type = 'payment'
GROUP BY i.id, i.invoice_number, i.status, i.total_amount
HAVING COALESCE(sum(l.amount), 0) > i.total_amount
ORDER BY i.invoice_number;
\echo '    (no rows = no invoice is recorded as over-paid)'

COMMIT;

-- ============================================================================
-- HOW TO READ THIS
--
--   Sections 2 AND 3 empty/zero
--     -> Phase 5 never reached production. Recovery Option B is available at
--        essentially zero data risk.
--
--   Section 2 has rows, but 3 and 4 are zero
--     -> Schema applied, no financial data yet. Fixing forward (Option A) is
--        safe. Do NOT drop migrations 0018-0022.
--
--   Section 3 or 4 non-zero
--     -> Real financial records exist. Recovery Option C applies: pg_dump
--        FIRST, preserve all data, no schema change until the backup is
--        verified restorable.
--
--   Section 5 or 6 returns ANY row
--     -> The double-credit defect has already fired in production. Report this
--        before applying any code change.
-- ============================================================================
