<?php
/**
 * SMM Panel Integration Addon Module for WHMCS
 * Version: 1.0.0
 * Compatible with WHMCS 8.9.x and PHP 7.4+
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/lib/Helper.php';

/**
 * Module Configuration
 */
function smmaddon_config()
{
    return array(
        'name'        => 'SMM Panel Integration',
        'description' => 'Integrate SMM Panel API with WHMCS for automated social media marketing services.',
        'author'      => 'SMMDev',
        'version'     => '1.0.0',
        'language'    => 'english',
        'fields'      => array(
            'api_url' => array(
                'FriendlyName' => 'SMM Panel API URL',
                'Type'         => 'text',
                'Size'         => '100',
                'Default'      => 'https://panel.example.com/api/v2',
                'Description'  => 'Enter your SMM panel API URL.',
            ),
            'api_key' => array(
                'FriendlyName' => 'SMM Panel API Key',
                'Type'         => 'password',
                'Size'         => '100',
                'Default'      => '',
                'Description'  => 'Enter your SMM panel API Key.',
            ),
            'auto_sync' => array(
                'FriendlyName' => 'Auto Sync Services',
                'Type'         => 'yesno',
                'Default'      => 'off',
                'Description'  => 'Automatically sync services daily via cron.',
            ),
            'debug_mode' => array(
                'FriendlyName' => 'Debug Mode',
                'Type'         => 'yesno',
                'Default'      => 'off',
                'Description'  => 'Log all API requests and responses for troubleshooting.',
            ),
        ),
    );
}

/**
 * Module Activation
 */
function smmaddon_activate()
{
    try {
        $pdo = Illuminate\Database\Capsule\Manager::connection()->getPdo();

        // Config table
        $pdo->exec("CREATE TABLE IF NOT EXISTS `mod_smm_config` (
            `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
            `setting` VARCHAR(255) NOT NULL,
            `value` TEXT NOT NULL,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            UNIQUE KEY `setting` (`setting`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Services mapping table
        $pdo->exec("CREATE TABLE IF NOT EXISTS `mod_smm_services` (
            `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
            `smm_service_id` VARCHAR(255) NOT NULL,
            `smm_name` VARCHAR(500) NOT NULL,
            `smm_category` VARCHAR(255) NOT NULL DEFAULT '',
            `smm_rate` DECIMAL(10,4) NOT NULL DEFAULT '0.0000',
            `smm_min` INT(11) NOT NULL DEFAULT '0',
            `smm_max` INT(11) NOT NULL DEFAULT '0',
            `smm_type` VARCHAR(50) NOT NULL DEFAULT 'default',
            `whmcs_product_id` INT(11) UNSIGNED NOT NULL DEFAULT '0',
            `whmcs_server_id` INT(11) UNSIGNED NOT NULL DEFAULT '0',
            `markup_percent` DECIMAL(5,2) NOT NULL DEFAULT '0.00',
            `markup_fixed` DECIMAL(10,4) NOT NULL DEFAULT '0.0000',
            `is_active` TINYINT(1) NOT NULL DEFAULT '1',
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            UNIQUE KEY `smm_service_id_server` (`smm_service_id`, `whmcs_server_id`),
            KEY `whmcs_product_id` (`whmcs_product_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Orders tracking table
        $pdo->exec("CREATE TABLE IF NOT EXISTS `mod_smm_orders` (
            `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
            `whmcs_order_id` INT(11) UNSIGNED NOT NULL,
            `whmcs_service_id` INT(11) UNSIGNED NOT NULL,
            `whmcs_user_id` INT(11) UNSIGNED NOT NULL,
            `smm_order_id` VARCHAR(255) NOT NULL DEFAULT '',
            `smm_service_id` VARCHAR(255) NOT NULL,
            `quantity` INT(11) NOT NULL DEFAULT '0',
            `link` TEXT NOT NULL,
            `status` ENUM('pending','processing','inprogress','completed','canceled','partial','refunded','error') NOT NULL DEFAULT 'pending',
            `start_count` INT(11) NOT NULL DEFAULT '0',
            `remains` INT(11) NOT NULL DEFAULT '0',
            `api_response` TEXT,
            `last_check` DATETIME DEFAULT NULL,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            UNIQUE KEY `whmcs_service_id` (`whmcs_service_id`),
            KEY `smm_order_id` (`smm_order_id`),
            KEY `status` (`status`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // API Logs table
        $pdo->exec("CREATE TABLE IF NOT EXISTS `mod_smm_logs` (
            `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
            `action` VARCHAR(255) NOT NULL,
            `endpoint` VARCHAR(500) NOT NULL,
            `request` TEXT,
            `response` TEXT,
            `http_code` INT(11) DEFAULT NULL,
            `error` TEXT,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `action` (`action`),
            KEY `created_at` (`created_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Servers table reference (for provisioning mapping)
        $pdo->exec("CREATE TABLE IF NOT EXISTS `mod_smm_server_map` (
            `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
            `server_id` INT(11) UNSIGNED NOT NULL,
            `api_url` VARCHAR(500) NOT NULL,
            `api_key` VARCHAR(500) NOT NULL,
            `is_active` TINYINT(1) NOT NULL DEFAULT '1',
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            UNIQUE KEY `server_id` (`server_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        return array(
            'status'  => 'success',
            'description' => 'SMM Panel Integration module activated successfully. Database tables created.',
        );
    } catch (Exception $e) {
        return array(
            'status'  => 'error',
            'description' => 'Unable to activate module: ' . $e->getMessage(),
        );
    }
}

/**
 * Module Deactivation
 */
function smmaddon_deactivate()
{
    try {
        // We do NOT drop tables to preserve data on deactivate.
        // Admin can manually drop if needed.
        return array(
            'status'  => 'success',
            'description' => 'SMM Panel Integration module deactivated. Database tables preserved.',
        );
    } catch (Exception $e) {
        return array(
            'status'  => 'error',
            'description' => 'Unable to deactivate: ' . $e->getMessage(),
        );
    }
}

/**
 * Module Upgrade
 */
function smmaddon_upgrade($vars)
{
    // Placeholder for future version upgrades
}

/**
 * Admin Area Output
 */
function smmaddon_output($vars)
{
    require_once __DIR__ . '/lib/AdminDispatcher.php';
    $dispatcher = new SmmAddon\AdminDispatcher();
    $dispatcher->dispatch($vars);
}

/**
 * Admin Area Sidebar
 */
function smmaddon_sidebar($vars)
{
    $modulelink = $vars['modulelink'];
    return <<<HTML
<ul class="menu">
    <li><a href="{$modulelink}"><i class="fas fa-tachometer-alt"></i> Dashboard</a></li>
    <li><a href="{$modulelink}&action=services"><i class="fas fa-list"></i> Services</a></li>
    <li><a href="{$modulelink}&action=orders"><i class="fas fa-shopping-cart"></i> Orders</a></li>
    <li><a href="{$modulelink}&action=logs"><i class="fas fa-history"></i> Logs</a></li>
    <li><a href="{$modulelink}&action=settings"><i class="fas fa-cog"></i> Settings</a></li>
</ul>
HTML;
}

/**
 * Client Area Output (not used for addon, but placeholder)
 */
function smmaddon_clientarea($vars)
{
    return array();
}
