-- ---------------------------------------------------------------------------
-- CloudHost247 Email Hosting - canonical schema (version 1.0.0)
--
-- Applied by lib/Database/Migrator.php on first use and by
-- `php cron.php migrate`. Every statement is idempotent; the file can also be
-- run by hand against the WHMCS database.
--
-- No customer password, provider credential or token is ever stored in these
-- tables. Provider credentials live in the WHMCS-encrypted tblservers fields.
-- ---------------------------------------------------------------------------

-- Provisioned mailboxes / subscriptions, one row per WHMCS service.
CREATE TABLE IF NOT EXISTS `mod_cloudhost247_email_hosting_accounts` (
    `id`                INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `service_id`        INT(10) UNSIGNED NOT NULL,
    `client_id`         INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `provider`          VARCHAR(32) NOT NULL DEFAULT '',
    `remote_id`         VARCHAR(191) NULL DEFAULT NULL,
    `email`             VARCHAR(191) NOT NULL DEFAULT '',
    `domain`            VARCHAR(191) NOT NULL DEFAULT '',
    `plan_tier`         VARCHAR(32) NOT NULL DEFAULT '',
    `plan_sku`          VARCHAR(128) NOT NULL DEFAULT '',
    `license_state`     VARCHAR(32) NOT NULL DEFAULT 'unknown',
    `status`            VARCHAR(32) NOT NULL DEFAULT 'pending',
    `remote_status`     VARCHAR(64) NULL DEFAULT NULL,
    `storage_used_mb`   BIGINT(20) NULL DEFAULT NULL,
    `storage_quota_mb`  BIGINT(20) NULL DEFAULT NULL,
    `dns_state`         VARCHAR(32) NOT NULL DEFAULT 'unknown',
    `dns_checked_at`    DATETIME NULL DEFAULT NULL,
    `last_sync_at`      DATETIME NULL DEFAULT NULL,
    `last_sync_result`  VARCHAR(32) NULL DEFAULT NULL,
    `needs_reconcile`   TINYINT(1) NOT NULL DEFAULT 0,
    `reconcile_reason`  VARCHAR(255) NULL DEFAULT NULL,
    `metadata_json`     TEXT NULL DEFAULT NULL,
    `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `service_unique` (`service_id`),
    KEY `client_id` (`client_id`),
    KEY `provider_status` (`provider`, `status`),
    KEY `needs_reconcile` (`needs_reconcile`),
    KEY `last_sync_at` (`last_sync_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Idempotency + reconciliation ledger: one row per attempted remote operation.
CREATE TABLE IF NOT EXISTS `mod_cloudhost247_email_hosting_operations` (
    `id`              INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `service_id`      INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `provider`        VARCHAR(32) NOT NULL DEFAULT '',
    `operation`       VARCHAR(48) NOT NULL DEFAULT '',
    `idempotency_key` VARCHAR(191) NOT NULL,
    `state`           ENUM('in_progress','succeeded','failed','needs_reconcile') NOT NULL DEFAULT 'in_progress',
    `attempts`        INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `correlation_id`  VARCHAR(64) NULL DEFAULT NULL,
    `result_code`     VARCHAR(48) NULL DEFAULT NULL,
    `result_message`  VARCHAR(500) NULL DEFAULT NULL,
    `remote_id`       VARCHAR(191) NULL DEFAULT NULL,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idempotency_unique` (`idempotency_key`),
    KEY `service_operation` (`service_id`, `operation`),
    KEY `state` (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cooperative locks so cron, webhooks and admin actions cannot overlap.
CREATE TABLE IF NOT EXISTS `mod_cloudhost247_email_hosting_locks` (
    `lock_key`    VARCHAR(191) NOT NULL,
    `owner`       VARCHAR(64) NOT NULL DEFAULT '',
    `acquired_at` DATETIME NOT NULL,
    `expires_at`  DATETIME NOT NULL,
    PRIMARY KEY (`lock_key`),
    KEY `expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Structured, redacted log.
CREATE TABLE IF NOT EXISTS `mod_cloudhost247_email_hosting_log` (
    `id`             INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `correlation_id` VARCHAR(64) NULL DEFAULT NULL,
    `level`          ENUM('debug','info','warning','error') NOT NULL DEFAULT 'info',
    `service_id`     INT(10) UNSIGNED NULL DEFAULT NULL,
    `provider`       VARCHAR(32) NULL DEFAULT NULL,
    `event`          VARCHAR(96) NOT NULL DEFAULT '',
    `context_json`   TEXT NULL DEFAULT NULL,
    `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `service_id` (`service_id`),
    KEY `level` (`level`),
    KEY `correlation_id` (`correlation_id`),
    KEY `created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Webhook receipts, for signature auditing and replay protection.
CREATE TABLE IF NOT EXISTS `mod_cloudhost247_email_hosting_webhooks` (
    `id`           INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `provider`     VARCHAR(32) NOT NULL DEFAULT '',
    `event_id`     VARCHAR(191) NOT NULL,
    `event_type`   VARCHAR(96) NULL DEFAULT NULL,
    `service_id`   INT(10) UNSIGNED NULL DEFAULT NULL,
    `verified`     TINYINT(1) NOT NULL DEFAULT 0,
    `outcome`      VARCHAR(48) NOT NULL DEFAULT 'received',
    `payload_hash` CHAR(64) NOT NULL DEFAULT '',
    `received_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `provider_event` (`provider`, `event_id`),
    KEY `received_at` (`received_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- DNS records presented to the customer, as returned by the provider or as
-- configured by an administrator. Never invented by the module.
CREATE TABLE IF NOT EXISTS `mod_cloudhost247_email_hosting_dns` (
    `id`            INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `service_id`    INT(10) UNSIGNED NOT NULL,
    `domain`        VARCHAR(191) NOT NULL DEFAULT '',
    `record_type`   VARCHAR(16) NOT NULL DEFAULT '',
    `host`          VARCHAR(191) NOT NULL DEFAULT '',
    `value`         TEXT NULL DEFAULT NULL,
    `priority`      INT(10) NULL DEFAULT NULL,
    `ttl`           INT(10) NULL DEFAULT NULL,
    `purpose`       VARCHAR(48) NOT NULL DEFAULT '',
    `source`        VARCHAR(24) NOT NULL DEFAULT 'provider',
    `is_verified`   TINYINT(1) NULL DEFAULT NULL,
    `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `service_id` (`service_id`),
    KEY `record_type` (`record_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Editable public-page content (hero copy, FAQs, comparison notes).
CREATE TABLE IF NOT EXISTS `mod_cloudhost247_email_hosting_content` (
    `content_key` VARCHAR(96) NOT NULL,
    `locale`      VARCHAR(12) NOT NULL DEFAULT 'english',
    `value_json`  MEDIUMTEXT NULL DEFAULT NULL,
    `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`content_key`, `locale`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Applied migrations.
CREATE TABLE IF NOT EXISTS `mod_cloudhost247_email_hosting_migrations` (
    `id`         INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `filename`   VARCHAR(191) NOT NULL,
    `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `filename` (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
