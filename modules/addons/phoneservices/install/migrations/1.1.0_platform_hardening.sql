-- ============================================================
-- Phone Number Services Platform - 1.1.0 migration
-- Adds REST API credentials, provider event auditing and the
-- subscription ledger used by the lifecycle/billing engine.
-- Safe to re-run: every statement is IF NOT EXISTS guarded.
-- ============================================================

-- Per-client REST API credentials (hashed at rest)
CREATE TABLE IF NOT EXISTS `mod_phoneservices_api_keys` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `label` VARCHAR(100) NOT NULL DEFAULT 'default',
    `key_id` VARCHAR(32) NOT NULL,
    `key_hash` CHAR(64) NOT NULL,
    `scopes` VARCHAR(255) NOT NULL DEFAULT 'numbers,voip,sms,esim,usage',
    `status` ENUM('active','revoked') NOT NULL DEFAULT 'active',
    `last_used_at` DATETIME NULL,
    `last_used_ip` VARCHAR(45) NULL,
    `expires_at` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `key_id` (`key_id`),
    KEY `user_id` (`user_id`),
    KEY `status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Raw provider webhook/event audit trail (also used for idempotency)
CREATE TABLE IF NOT EXISTS `mod_phoneservices_provider_events` (
    `id` BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(50) NOT NULL,
    `event_type` VARCHAR(80) NOT NULL,
    `external_id` VARCHAR(190) NULL,
    `payload` MEDIUMTEXT NULL,
    `processed` TINYINT(1) NOT NULL DEFAULT 0,
    `processed_at` DATETIME NULL,
    `error` VARCHAR(500) NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `provider_event` (`provider`,`event_type`),
    KEY `external_id` (`external_id`),
    KEY `created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Recurring subscriptions for numbers and eSIM data plans
CREATE TABLE IF NOT EXISTS `mod_phoneservices_subscriptions` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT(10) UNSIGNED NOT NULL,
    `service_id` INT(10) UNSIGNED NULL DEFAULT 0,
    `service_type` ENUM('number','voip','sms','esim','bundle') NOT NULL,
    `resource_id` INT(10) UNSIGNED NULL DEFAULT 0,
    `plan_code` VARCHAR(100) NULL,
    `billing_cycle` ENUM('monthly','quarterly','annually','onetime') NOT NULL DEFAULT 'monthly',
    `amount` DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `status` ENUM('pending','active','suspended','cancelled','expired') NOT NULL DEFAULT 'pending',
    `auto_renew` TINYINT(1) NOT NULL DEFAULT 1,
    `started_at` DATETIME NULL,
    `next_due_date` DATE NULL,
    `cancelled_at` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `user_id` (`user_id`),
    KEY `service_type` (`service_type`),
    KEY `status_due` (`status`,`next_due_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional PSTN forwarding target used by the inbound call handlers
ALTER TABLE `mod_phoneservices_numbers`
    ADD COLUMN IF NOT EXISTS `forward_to` VARCHAR(30) NULL AFTER `sms_url`;

-- Provider-hosted QR image, used when no local QR renderer is installed
ALTER TABLE `mod_phoneservices_esims`
    ADD COLUMN IF NOT EXISTS `qr_code_url` VARCHAR(500) NULL AFTER `qr_code_data`;
