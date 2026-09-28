-- ---------------------------------------------------------------------------
-- Custom Affiliate Commission - canonical schema
--
-- Applied automatically on module activation. It is also safe to run by hand
-- (every statement is IF NOT EXISTS) before activating the module.
--
-- Existing installations are upgraded through install/migrations/*.sql; any
-- change made here must also be expressed as a migration.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Module settings (admin configurable, see Addons > Custom Affiliate
-- Commission > Settings).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mod_customaffiliate_settings` (
    `setting_name`  VARCHAR(64) NOT NULL,
    `setting_value` TEXT NULL,
    `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`setting_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Commission ledger: one row per referred service.
--
-- This is the table the commission rules consult: `first_commission_paid`
-- decides whether the next paid invoice earns the first-payment rate or the
-- recurring rate.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mod_customaffiliate_commissions` (
    `id`                          INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `service_id`                  INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `affiliate_id`                INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `client_id`                   INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `product_id`                  INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `product_group_id`            INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `client_was_new`              TINYINT(1) NOT NULL DEFAULT 1,
    `first_commission_paid`       TINYINT(1) NOT NULL DEFAULT 0,
    `first_commission_amount`     DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    `first_commission_invoice_id` INT(10) UNSIGNED NULL DEFAULT NULL,
    `first_commission_paid_at`    DATETIME NULL DEFAULT NULL,
    `first_commission_reversed_at` DATETIME NULL DEFAULT NULL,
    `total_recurring_commission`  DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    `recurring_count`             INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `total_commission`            DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    `last_invoice_id`             INT(10) UNSIGNED NULL DEFAULT NULL,
    `last_commission_at`          DATETIME NULL DEFAULT NULL,
    `notes`                       TEXT NULL DEFAULT NULL,
    `created_at`                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `svc_aff_unique` (`service_id`, `affiliate_id`),
    KEY `service_id` (`service_id`),
    KEY `affiliate_id` (`affiliate_id`),
    KEY `client_id` (`client_id`),
    KEY `product_id` (`product_id`),
    KEY `first_commission_paid` (`first_commission_paid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Individual commission payouts: one row per invoice line item.
--
-- The UNIQUE key on (invoice_id, invoice_item_id) is the duplicate-payout
-- guard: replaying InvoicePaid (re-payment, cron re-run, manual "mark paid")
-- can never credit the same line item twice.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mod_customaffiliate_payouts` (
    `id`              INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `ledger_id`       INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `service_id`      INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `affiliate_id`    INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `client_id`       INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `invoice_id`      INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `invoice_item_id` INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `commission_type` ENUM('first','recurring') NOT NULL DEFAULT 'first',
    `base_amount`     DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    `rate`            DECIMAL(6,3) NOT NULL DEFAULT 0.000,
    `amount`          DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    `currency_id`     INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `affacc_id`       INT(10) UNSIGNED NULL DEFAULT NULL,
    `pending_id`      INT(10) UNSIGNED NULL DEFAULT NULL,
    `status`          ENUM('pending','credited','reversed') NOT NULL DEFAULT 'pending',
    `reason`          VARCHAR(255) NULL DEFAULT NULL,
    `reversed_at`     DATETIME NULL DEFAULT NULL,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `invoice_item_unique` (`invoice_id`, `invoice_item_id`),
    KEY `ledger_id` (`ledger_id`),
    KEY `service_id` (`service_id`),
    KEY `affiliate_id` (`affiliate_id`),
    KEY `status` (`status`),
    KEY `created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Audit trail: every decision the engine makes, including the skips.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mod_customaffiliate_log` (
    `id`           INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `level`        ENUM('debug','info','warning','error') NOT NULL DEFAULT 'info',
    `service_id`   INT(10) UNSIGNED NULL DEFAULT NULL,
    `affiliate_id` INT(10) UNSIGNED NULL DEFAULT NULL,
    `invoice_id`   INT(10) UNSIGNED NULL DEFAULT NULL,
    `action`       VARCHAR(50) NOT NULL DEFAULT '',
    `amount`       DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    `percentage`   DECIMAL(6,3) NOT NULL DEFAULT 0.000,
    `description`  TEXT NULL DEFAULT NULL,
    `debug_data`   TEXT NULL DEFAULT NULL,
    `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `level` (`level`),
    KEY `service_id` (`service_id`),
    KEY `affiliate_id` (`affiliate_id`),
    KEY `invoice_id` (`invoice_id`),
    KEY `action` (`action`),
    KEY `created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Applied migrations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mod_customaffiliate_migrations` (
    `id`         INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `filename`   VARCHAR(190) NOT NULL,
    `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `filename` (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
