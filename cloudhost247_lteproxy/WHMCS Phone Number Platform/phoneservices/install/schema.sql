-- ============================================================
-- Phone Number Services Platform - Database Schema
-- ============================================================
-- Run this via the module activation hook or manually
-- Compatible with MySQL 5.7+ / MariaDB 10.2+
-- ============================================================

-- Settings table
CREATE TABLE IF NOT EXISTS `mod_phoneservices_settings` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `setting_name` VARCHAR(100) NOT NULL,
    `setting_value` TEXT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `setting_name` (`setting_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Virtual phone numbers
CREATE TABLE IF NOT EXISTS `mod_phoneservices_numbers` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `assigned_service_id` INT(10) UNSIGNED NULL DEFAULT 0,
    `provider` VARCHAR(50) NOT NULL,
    `provider_id` VARCHAR(100) NOT NULL,
    `number` VARCHAR(30) NOT NULL,
    `country` CHAR(2) NOT NULL,
    `type` ENUM('local','tollfree','mobile','national') NOT NULL DEFAULT 'local',
    `status` ENUM('pending','active','suspended','released','expired') NOT NULL DEFAULT 'pending',
    `friendly_name` VARCHAR(255) NULL,
    `monthly_cost` DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    `setup_cost` DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    `voice_url` VARCHAR(500) NULL,
    `sms_url` VARCHAR(500) NULL,
    `purchased_at` DATETIME NULL,
    `activated_at` DATETIME NULL,
    `renewed_at` DATETIME NULL,
    `suspended_at` DATETIME NULL,
    `released_at` DATETIME NULL,
    `next_renewal` DATETIME NULL,
    `suspend_reason` VARCHAR(255) NULL,
    `renewal_count` INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `user_id` (`user_id`),
    KEY `provider_id` (`provider_id`),
    KEY `status` (`status`),
    KEY `country` (`country`),
    KEY `next_renewal` (`next_renewal`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Call logs
CREATE TABLE IF NOT EXISTS `mod_phoneservices_calls` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `provider` VARCHAR(50) NOT NULL,
    `call_id` VARCHAR(100) NOT NULL,
    `from_number` VARCHAR(30) NOT NULL,
    `to_number` VARCHAR(30) NOT NULL,
    `direction` ENUM('inbound','outbound') NOT NULL DEFAULT 'outbound',
    `status` ENUM('initiated','ringing','in-progress','connected','completed','ended','failed','busy','no-answer','cancelled') NOT NULL DEFAULT 'initiated',
    `duration` INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `cost` DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `recording_url` VARCHAR(500) NULL,
    `started_at` DATETIME NULL,
    `ended_at` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `call_id_provider` (`call_id`,`provider`),
    KEY `user_id` (`user_id`),
    KEY `status` (`status`),
    KEY `started_at` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Messages (SMS, WhatsApp, Email)
CREATE TABLE IF NOT EXISTS `mod_phoneservices_messages` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `provider` VARCHAR(50) NOT NULL,
    `message_id` VARCHAR(100) NULL,
    `from_number` VARCHAR(30) NULL,
    `to_number` VARCHAR(255) NOT NULL,
    `body` TEXT NOT NULL,
    `direction` ENUM('inbound','outbound') NOT NULL DEFAULT 'outbound',
    `status` ENUM('pending','sent','delivered','received','failed','read') NOT NULL DEFAULT 'pending',
    `price` DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `segments` INT(3) UNSIGNED NOT NULL DEFAULT 1,
    `channel` ENUM('sms','whatsapp','email','mms') NOT NULL DEFAULT 'sms',
    `error_message` VARCHAR(255) NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `user_id` (`user_id`),
    KEY `message_id` (`message_id`),
    KEY `status` (`status`),
    KEY `channel` (`channel`),
    KEY `created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- OTP / 2FA codes
CREATE TABLE IF NOT EXISTS `mod_phoneservices_otp` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT(10) UNSIGNED NOT NULL,
    `recipient` VARCHAR(255) NOT NULL,
    `code_hash` VARCHAR(255) NOT NULL,
    `type` ENUM('sms','whatsapp','email') NOT NULL DEFAULT 'sms',
    `expires_at` DATETIME NOT NULL,
    `used` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
    `verified_at` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `user_id` (`user_id`),
    KEY `recipient` (`recipient`),
    KEY `used_expires` (`used`,`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- eSIM profiles
CREATE TABLE IF NOT EXISTS `mod_phoneservices_esims` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `provider` VARCHAR(50) NOT NULL,
    `provider_esim_id` VARCHAR(100) NOT NULL,
    `order_id` VARCHAR(100) NULL,
    `plan_id` VARCHAR(100) NOT NULL,
    `iccid` VARCHAR(30) NULL,
    `lpa_code` VARCHAR(255) NULL,
    `qr_code_data` TEXT NULL,
    `status` ENUM('pending','active','suspended','expired','cancelled') NOT NULL DEFAULT 'pending',
    `friendly_name` VARCHAR(255) NULL,
    `data_total_mb` INT(10) UNSIGNED NULL,
    `data_used_mb` INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `purchased_at` DATETIME NULL,
    `activated_at` DATETIME NULL,
    `expires_at` DATETIME NULL,
    `expired_at` DATETIME NULL,
    `renewed_at` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `user_id` (`user_id`),
    KEY `provider_esim_id` (`provider_esim_id`),
    KEY `status` (`status`),
    KEY `expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Usage records
CREATE TABLE IF NOT EXISTS `mod_phoneservices_usage` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `service_type` ENUM('voice','sms','esim_data','number') NOT NULL,
    `reference_id` INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `used_value` DECIMAL(15,4) NOT NULL DEFAULT 0.0000,
    `total_value` DECIMAL(15,4) NULL,
    `unit` VARCHAR(20) NOT NULL DEFAULT 'unit',
    `recorded_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `user_id` (`user_id`),
    KEY `service_type` (`service_type`),
    KEY `recorded_at` (`recorded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Transactions / billing
CREATE TABLE IF NOT EXISTS `mod_phoneservices_transactions` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `service_type` VARCHAR(50) NOT NULL,
    `reference_id` INT(10) UNSIGNED NULL,
    `amount` DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `status` ENUM('pending','completed','failed','refunded','cancelled') NOT NULL DEFAULT 'pending',
    `invoice_id` INT(10) UNSIGNED NULL,
    `gateway` VARCHAR(50) NULL,
    `gateway_transaction_id` VARCHAR(255) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `user_id` (`user_id`),
    KEY `status` (`status`),
    KEY `service_type` (`service_type`),
    KEY `created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pricing rules
CREATE TABLE IF NOT EXISTS `mod_phoneservices_pricing` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `service_type` VARCHAR(50) NOT NULL,
    `country` CHAR(2) NOT NULL DEFAULT 'DEFAULT',
    `rate_per_minute` DECIMAL(10,6) NOT NULL DEFAULT 0.000000,
    `rate_per_unit` DECIMAL(10,6) NOT NULL DEFAULT 0.000000,
    `monthly_cost` DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    `setup_cost` DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `service_country` (`service_type`,`country`),
    KEY `country` (`country`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- System logs
CREATE TABLE IF NOT EXISTS `mod_phoneservices_logs` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `level` ENUM('debug','info','warning','error') NOT NULL DEFAULT 'info',
    `message` TEXT NOT NULL,
    `context` TEXT NULL,
    `source` VARCHAR(255) NULL,
    `ip_address` VARCHAR(45) NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `level` (`level`),
    KEY `created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- WebRTC tokens
CREATE TABLE IF NOT EXISTS `mod_phoneservices_webrtc_tokens` (
    `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT(10) UNSIGNED NOT NULL,
    `token` TEXT NOT NULL,
    `identity` VARCHAR(100) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `expires_at` DATETIME NOT NULL,
    `used` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `user_id` (`user_id`),
    KEY `expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default pricing
INSERT INTO `mod_phoneservices_pricing` (`service_type`, `country`, `rate_per_minute`, `rate_per_unit`, `monthly_cost`, `setup_cost`, `currency`)
VALUES 
('voice', 'DEFAULT', 0.013000, 0.000000, 0.0000, 0.0000, 'USD'),
('sms', 'DEFAULT', 0.000000, 0.007500, 0.0000, 0.0000, 'USD'),
('number', 'US', 0.000000, 0.000000, 1.0000, 2.0000, 'USD'),
('number', 'GB', 0.000000, 0.000000, 1.5000, 2.0000, 'USD'),
('number', 'CA', 0.000000, 0.000000, 1.0000, 2.0000, 'USD')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
