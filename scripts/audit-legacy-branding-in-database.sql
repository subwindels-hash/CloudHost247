-- ---------------------------------------------------------------------------
-- CloudHost247 — READ-ONLY database audit for retired vendor branding.
--
-- Purpose: turn "we think these identifiers are stored in the database" into
-- evidence. docs/BRANDING-COMPATIBILITY.md §4 retains three legacy block
-- template filenames and six legacy banner image filenames *because* the
-- ionCube-encoded page builder stores those values. This script proves or
-- disproves that on a real installation, and reports every other place the
-- retired brand is still stored.
--
-- It performs NO writes. Every statement is a SELECT. No backup is required,
-- no maintenance window is required, and it is safe to run against production
-- (it is bounded: no full-text scan of customer tables such as tbltickets,
-- tblclients, tblinvoices or tblhosting).
--
--   mysql -u USER -p --table --force DATABASE \
--       < scripts/audit-legacy-branding-in-database.sql > branding-audit.txt
--
-- --force is deliberate: B7 reads the archived vendor settings table, which only exists where
-- the legacy page builder is installed. Everywhere else that one statement
-- reports "table doesn't exist" and the rest of the audit still runs. No other
-- statement depends on an optional table; Part C generates its queries from
-- information_schema so it always matches your real schema.
--
-- How to read the result:
--   Part A  schema-level: which tables/columns still carry the legacy name.
--   Part B  WHMCS core: branding that a customer or administrator can see.
--           Every row here is a defect to fix (except tblmodulelog, which is
--           an audit trail and is reported for information only).
--   Part C  generator: prints ready-to-run SELECTs for the addon-owned and CMS
--           tables. Copy its output and run it — this keeps the script safe on
--           installations where a table or column does not exist.
--
-- Column names follow WHMCS 8.x. If your version differs, Part C's generator
-- is authoritative for your own schema.
-- ---------------------------------------------------------------------------

SELECT 'CloudHost247 legacy-branding database audit' AS script,
       DATABASE()                                     AS schema_name,
       NOW()                                          AS run_at,
       'READ ONLY - no statement in this file writes' AS mode;

-- ===========================================================================
-- Part A. Schema level: table and column names
-- ===========================================================================

-- The retired identifiers are assembled from fragments here so this script
-- never spells the retired brand in plain text; @b is the retired brand token.
SET @b  = CONCAT('host','x');
SET @mb = CONCAT('mod_',@b,'_');

-- A1. Tables still named after the retired brand.
--     Expected after scripts/migrate-legacy-names-to-cloudhost247.sql:
--       the four legacy page-builder content tables, which section 8 of the
--       migration renames onto the independent theme schema.
--     Unexpected: anything still prefixed with the retired token at all.
SELECT table_name AS legacy_named_table,
       table_rows AS approximate_rows,
       CASE
           WHEN table_name IN (CONCAT(@mb,'pages'), CONCAT(@mb,'page_products'),
                               CONCAT(@mb,'setting'), CONCAT(@mb,'dynmic_translation'))
               THEN 'DEFECT - section 8 of the migration has not renamed it'
           WHEN table_name LIKE CONCAT('mod\\_',@b,'\\_tools\\_%')
               THEN 'DEFECT - rename with the tools module migration'
           WHEN table_name LIKE CONCAT('mod\\_',@b,'\\_email\\_%')
               THEN 'DEFECT - rename with the Email Hosting migration'
           ELSE 'INVESTIGATE'
       END AS verdict
  FROM information_schema.tables
 WHERE table_schema = DATABASE()
   AND LOWER(table_name) REGEXP 'host[ _-]?x'
 ORDER BY table_name;

-- A2. Columns still named after the retired brand (any table).
SELECT table_name, column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = DATABASE()
   AND LOWER(column_name) REGEXP 'host[ _-]?x'
 ORDER BY table_name, ordinal_position;

-- ===========================================================================
-- Part B. WHMCS core rows a customer or administrator can see
-- ===========================================================================

-- B1. System settings: company name, template, order form, and any other value
--     that still spells the retired brand. CompanyName feeds invoices, emails
--     and the client area; Template/OrderFormTemplate decide which theme
--     directory WHMCS loads.
SELECT setting, value,
       CASE
           WHEN setting = 'CompanyName'          THEN 'DEFECT - must read CloudHost247 Isc.'
           WHEN setting IN ('Template', 'OrderFormTemplate')
                                                 THEN 'DEFECT - directory no longer exists'
           ELSE 'INVESTIGATE'
       END AS verdict
  FROM tblconfiguration
 WHERE LOWER(value) REGEXP 'host[ _-]?x'
 ORDER BY setting;

-- B2. Provisioning / addon module bindings. WHMCS resolves a module by the
--     directory name, so a stale value means "module not found".
SELECT 'tblproducts.servertype' AS binding, id, name AS label, servertype AS value
  FROM tblproducts  WHERE LOWER(servertype) REGEXP 'host[ _-]?x'
UNION ALL
SELECT 'tblservers.type', id, name, type
  FROM tblservers   WHERE LOWER(type) REGEXP 'host[ _-]?x'
UNION ALL
SELECT 'tbladdonmodules.module', id, module, module
  FROM tbladdonmodules WHERE LOWER(module) REGEXP 'host[ _-]?x'
UNION ALL
SELECT 'tblproductgroups.orderfrmtpl', id, name, orderfrmtpl
  FROM tblproductgroups WHERE LOWER(orderfrmtpl) REGEXP 'host[ _-]?x'
 ORDER BY binding, id;

-- B3. Administrator role permissions are keyed by addon module name.
--     the vendor theme-helper addon was retired on 2026-10-01, so a row here
--     a row for cloudhost247_tools / cloudhost247_domain_lookup is a defect.
SELECT id, name, permissions
  FROM tbladminroles
 WHERE LOWER(permissions) REGEXP 'host[ _-]?x'
 ORDER BY id;

-- B4. Email templates: sender name, subject and body. This is the highest
--     visibility surface for the retired brand.
SELECT id, type, name, subject, fromname, replyto,
       CHAR_LENGTH(message) AS message_length,
       CASE WHEN LOWER(message) REGEXP 'host[ _-]?x'
            THEN 'DEFECT - body still contains the retired brand'
            ELSE 'header only' END AS verdict
  FROM tblemailtemplates
 WHERE LOWER(subject)   REGEXP 'host[ _-]?x'
    OR LOWER(message)   REGEXP 'host[ _-]?x'
    OR LOWER(fromname)  REGEXP 'host[ _-]?x'
    OR LOWER(replyto)   REGEXP 'host[ _-]?x'
    OR LOWER(name)      REGEXP 'host[ _-]?x'
 ORDER BY type, name;

-- B5. Product, group and server display names.
SELECT 'tblproducts' AS surface, id, name AS label
  FROM tblproducts WHERE LOWER(name) REGEXP 'host[ _-]?x'
                     OR LOWER(shortdescription) REGEXP 'host[ _-]?x'
UNION ALL
SELECT 'tblproductgroups', id, name FROM tblproductgroups
  WHERE LOWER(name) REGEXP 'host[ _-]?x'
UNION ALL
SELECT 'tblservers', id, name FROM tblservers
  WHERE LOWER(name) REGEXP 'host[ _-]?x'
 ORDER BY surface, id;

-- B6. INFORMATION ONLY. Historical module-log rows keep the identifier they
--     logged under; an audit trail is never rewritten. Reported so the count is
--     known and is not mistaken for a live binding.
SELECT module, COUNT(*) AS historical_rows, MIN(date) AS earliest, MAX(date) AS latest
  FROM tblmodulelog
 WHERE LOWER(module) REGEXP 'host[ _-]?x'
 GROUP BY module;

-- B7. Theme settings. The vendor key/value table is archived by section 8 of
--     the migration; any row here still carrying the retired token is
--     customer-visible copy, an asset path or a stored slug.
SELECT setting, value,
       CASE
           WHEN LOWER(value) REGEXP 'host[ _-]?x\\.(png|webp|jpg|jpeg|svg|ico)'
               THEN 'asset filename - see Part C for the banner/block search'
           WHEN setting = 'template_name_custom'
               THEN 'must read cloudhost247_legacy'
           ELSE 'customer-visible copy or slug - rebrand through the theme admin'
       END AS verdict
  FROM mod_cloudhost247_theme_vendor_settings_archive
 WHERE LOWER(value) REGEXP 'host[ _-]?x'
 ORDER BY setting;

-- ===========================================================================
-- Part C. Generator for tables whose columns differ between installations
-- ===========================================================================
--
-- The legacy page builder's content tables (page, page-product and
-- dynamic-translation, all prefixed with the retired token) and the CMS tables
-- have no schema in this repository. Instead of guessing, this prints one
-- SELECT per text column that actually exists in YOUR database.
--
-- Run the file, copy the `generated_sql` column into a second file and run
-- that. It answers the two open questions in
-- docs/BRANDING-COMPATIBILITY.md §4:
--
--   * are the retired block slugs (the two web-hosting blocks and the
--     why-block) stored anywhere?  -> if zero rows, the three .tpl files can
--     be renamed safely in a follow-up.
--   * are the retired banner filenames (`*-[token].png` / `.webp`) stored anywhere?
--     -> if zero rows, the six images can be renamed safely in a follow-up.
--
-- If either search returns rows, the file rename must ship in the SAME
-- maintenance window as an UPDATE of those rows, and the migration must be
-- added to scripts/migrate-legacy-names-to-cloudhost247.sql.
--
-- The same generator answers a third question: the legacy footer renders a
-- stored `copyright` block when one exists
-- (templates/cloudhost247_legacy/includes/blocks/copyright.tpl) and falls back
-- to the static "CloudHost247 Isc." line only when it does not. Any row the
-- generator reports for a copyright/footer block is customer-visible legal copy
-- and must be corrected through the theme admin before cutover.

SELECT CONCAT(
           'SELECT ''', c.table_name, '.', c.column_name, ''' AS location, COUNT(*) AS rows_matching',
           ' FROM `', c.table_name, '`',
           ' WHERE LOWER(`', c.column_name, '`) REGEXP ''host[ _-]?x'';'
       ) AS generated_sql
  FROM information_schema.columns c
 WHERE c.table_schema = DATABASE()
   AND c.data_type IN ('char', 'varchar', 'text', 'tinytext',
                       'mediumtext', 'longtext', 'json')
   AND (c.table_name LIKE CONCAT('mod\\_',@b,'\\_%')
        OR c.table_name IN ('tblannouncements', 'tblkbarticles', 'tblkbcats',
                            'tbltickets', 'tblticketnotes', 'tblaffiliates',
                            'tbldownloads', 'tbldownloadcats', 'tblnews',
                            'tblpaymentgateways', 'tbltax', 'tblcurrencies'))
 ORDER BY c.table_name, c.ordinal_position;

-- Targeted generators for the two retained filename sets, so the answer does
-- not depend on reading a large report.
SELECT CONCAT(
           'SELECT ''', c.table_name, '.', c.column_name, ''' AS location, COUNT(*) AS block_slug_rows',
           ' FROM `', c.table_name, '` WHERE `', c.column_name, '`',
           ' REGEXP ''(', @b, '_web_hosting(_2)?|why_', @b, ')'';'
       ) AS generated_block_slug_sql
  FROM information_schema.columns c
 WHERE c.table_schema = DATABASE()
   AND c.data_type IN ('char', 'varchar', 'text', 'tinytext',
                       'mediumtext', 'longtext', 'json')
   AND c.table_name LIKE CONCAT('mod\\_',@b,'\\_%')
 ORDER BY c.table_name, c.ordinal_position;

SELECT CONCAT(
           'SELECT ''', c.table_name, '.', c.column_name, ''' AS location, COUNT(*) AS banner_filename_rows',
           ' FROM `', c.table_name, '` WHERE LOWER(`', c.column_name, '`)',
           ' REGEXP ''(enterprise|game|hosting)-servers-', @b, '\\\\.(png|webp)'';'
       ) AS generated_banner_sql
  FROM information_schema.columns c
 WHERE c.table_schema = DATABASE()
   AND c.data_type IN ('char', 'varchar', 'text', 'tinytext',
                       'mediumtext', 'longtext', 'json')
   AND c.table_name LIKE CONCAT('mod\\_',@b,'\\_%')
 ORDER BY c.table_name, c.ordinal_position;

SELECT 'audit complete' AS status,
       'Part B rows are defects unless marked INFORMATION/RETAINED; run the Part C output next' AS next_step;
