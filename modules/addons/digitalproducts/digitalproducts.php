<?php
/**
 * WHMCS Digital Products Marketplace Module
 *
 * A complete solution for selling downloadable digital products,
 * modules, plugins and scripts through WHMCS.
 *
 * @package    DigitalProducts
 * @author     Your Name
 * @copyright  2024 Your Company
 * @license    https://www.whmcs.com/license/ WHMCS License
 * @version    1.0.0
 * @link       https://yourcompany.com
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

use WHMCS\Database\Capsule;

/**
 * Module Configuration
 *
 * @return array
 */
function digitalproducts_config()
{
    return [
        'name'        => 'Digital Products Marketplace',
        'description' => 'Sell downloadable digital products, modules, plugins and scripts with version management, licensing and secure downloads.',
        'author'      => 'Your Company',
        'language'    => 'english',
        'version'     => '1.0.0',
        'fields'      => [
            'download_limit' => [
                'FriendlyName' => 'Default Download Limit',
                'Type'         => 'text',
                'Size'         => '5',
                'Default'      => '5',
                'Description'  => 'Maximum number of downloads per purchase (0 = unlimited)',
            ],
            'link_expiry_hours' => [
                'FriendlyName' => 'Download Link Expiry',
                'Type'         => 'text',
                'Size'         => '5',
                'Default'      => '48',
                'Description'  => 'Hours until download link expires',
            ],
            'license_enabled' => [
                'FriendlyName' => 'Enable License Keys',
                'Type'         => 'yesno',
                'Default'      => 'on',
                'Description'  => 'Generate license keys for each purchase',
            ],
            'storage_path' => [
                'FriendlyName' => 'File Storage Path',
                'Type'         => 'text',
                'Size'         => '50',
                'Default'      => '',
                'Description'  => 'Absolute path to store files (leave empty for default: WHMCS_ROOT/storage/digitalproducts/)',
            ],
            'email_delivery' => [
                'FriendlyName' => 'Email Download Info',
                'Type'         => 'yesno',
                'Default'      => 'on',
                'Description'  => 'Send download info email after purchase',
            ],
        ]
    ];
}

/**
 * Module Activation
 *
 * @return array
 */
function digitalproducts_activate()
{
    try {
        // Create products table
        if (!Capsule::schema()->hasTable('mod_digitalproducts_products')) {
            Capsule::schema()->create('mod_digitalproducts_products', function ($table) {
                $table->increments('id');
                $table->integer('product_id')->unsigned()->unique();
                $table->string('product_name', 255);
                $table->text('description')->nullable();
                $table->enum('status', ['active', 'inactive', 'retired'])->default('active');
                $table->integer('current_file_id')->unsigned()->nullable();
                $table->integer('download_limit')->unsigned()->default(0);
                $table->integer('link_expiry_hours')->unsigned()->default(48);
                $table->boolean('license_enabled')->default(true);
                $table->timestamps();
                $table->index('product_id');
            });
        }

        // Create files table
        if (!Capsule::schema()->hasTable('mod_digitalproducts_files')) {
            Capsule::schema()->create('mod_digitalproducts_files', function ($table) {
                $table->increments('id');
                $table->integer('product_id')->unsigned();
                $table->string('version', 50)->default('1.0.0');
                $table->string('filename', 255);
                $table->string('original_name', 255);
                $table->string('file_path', 500);
                $table->string('file_hash', 64)->nullable();
                $table->bigInteger('file_size')->unsigned()->default(0);
                $table->text('changelog')->nullable();
                $table->integer('download_count')->unsigned()->default(0);
                $table->enum('status', ['active', 'inactive'])->default('active');
                $table->timestamps();
                $table->index('product_id');
                $table->index(['product_id', 'status']);
            });
        }

        // Create licenses table
        if (!Capsule::schema()->hasTable('mod_digitalproducts_licenses')) {
            Capsule::schema()->create('mod_digitalproducts_licenses', function ($table) {
                $table->increments('id');
                $table->integer('product_id')->unsigned();
                $table->integer('service_id')->unsigned();
                $table->integer('client_id')->unsigned();
                $table->string('license_key', 64)->unique();
                $table->enum('status', ['active', 'suspended', 'expired', 'cancelled'])->default('active');
                $table->text('domains')->nullable();
                $table->integer('activations_limit')->unsigned()->default(0);
                $table->integer('activations_count')->unsigned()->default(0);
                $table->dateTime('expires_at')->nullable();
                $table->timestamps();
                $table->index('license_key');
                $table->index('service_id');
                $table->index('client_id');
                $table->index('product_id');
            });
        }

        // Create download logs table
        if (!Capsule::schema()->hasTable('mod_digitalproducts_downloads')) {
            Capsule::schema()->create('mod_digitalproducts_downloads', function ($table) {
                $table->increments('id');
                $table->integer('file_id')->unsigned();
                $table->integer('product_id')->unsigned();
                $table->integer('service_id')->unsigned();
                $table->integer('client_id')->unsigned();
                $table->string('license_key', 64)->nullable();
                $table->string('download_token', 128)->nullable();
                $table->string('ip_address', 45)->nullable();
                $table->text('user_agent')->nullable();
                $table->enum('status', ['success', 'failed', 'expired', 'limit'])->default('success');
                $table->timestamps();
                $table->index('file_id');
                $table->index('client_id');
                $table->index('service_id');
                $table->index('download_token');
            });
        }

        // Create API tokens table for external access
        if (!Capsule::schema()->hasTable('mod_digitalproducts_api_tokens')) {
            Capsule::schema()->create('mod_digitalproducts_api_tokens', function ($table) {
                $table->increments('id');
                $table->integer('client_id')->unsigned();
                $table->string('token_name', 100);
                $table->string('api_token', 128)->unique();
                $table->text('permissions')->nullable();
                $table->string('ip_restriction', 255)->nullable();
                $table->dateTime('last_used_at')->nullable();
                $table->dateTime('expires_at')->nullable();
                $table->timestamps();
                $table->index('client_id');
                $table->index('api_token');
            });
        }

        return [
            'status'  => 'success',
            'description' => 'Digital Products module activated successfully. Database tables created.',
        ];
    } catch (Exception $e) {
        return [
            'status'  => 'error',
            'description' => 'Failed to activate module: ' . $e->getMessage(),
        ];
    }
}

/**
 * Module Deactivation
 *
 * @return array
 */
function digitalproducts_deactivate()
{
    try {
        // We intentionally DO NOT drop tables on deactivation
        // to prevent data loss. Use upgrade function for cleanup.

        return [
            'status'  => 'success',
            'description' => 'Module deactivated. Database tables preserved to prevent data loss.',
        ];
    } catch (Exception $e) {
        return [
            'status'  => 'error',
            'description' => 'Failed to deactivate: ' . $e->getMessage(),
        ];
    }
}

/**
 * Module Upgrade
 *
 * @param array $vars
 */
function digitalproducts_upgrade($vars)
{
    $version = $vars['version'];

    try {
        // Future upgrade paths go here
        // if ($version < '1.1.0') { ... }
    } catch (Exception $e) {
        // Log error but don't crash
        logActivity('DigitalProducts Upgrade Error: ' . $e->getMessage());
    }
}

/**
 * Admin Area Output
 *
 * @param array $vars
 * @return string
 */
function digitalproducts_output($vars)
{
    require_once __DIR__ . '/lib/Admin.php';

    $admin = new DigitalProducts\Admin($vars);
    return $admin->render();
}

/**
 * Admin Area Sidebar
 *
 * @param array $vars
 * @return string
 */
function digitalproducts_sidebar($vars)
{
    $moduleLink = $vars['modulelink'];

    return <<<HTML
<div class="panel panel-default">
    <div class="panel-heading">
        <h3 class="panel-title"><i class="fa fa-bars"></i> Quick Navigation</h3>
    </div>
    <div class="list-group">
        <a href="{$moduleLink}&action=dashboard" class="list-group-item">
            <i class="fa fa-dashboard fa-fw"></i> Dashboard
        </a>
        <a href="{$moduleLink}&action=products" class="list-group-item">
            <i class="fa fa-cubes fa-fw"></i> Digital Products
        </a>
        <a href="{$moduleLink}&action=upload" class="list-group-item">
            <i class="fa fa-upload fa-fw"></i> Upload File
        </a>
        <a href="{$moduleLink}&action=versions" class="list-group-item">
            <i class="fa fa-code-fork fa-fw"></i> Version Management
        </a>
        <a href="{$moduleLink}&action=licenses" class="list-group-item">
            <i class="fa fa-key fa-fw"></i> License Keys
        </a>
        <a href="{$moduleLink}&action=downloads" class="list-group-item">
            <i class="fa fa-download fa-fw"></i> Download Logs
        </a>
        <a href="{$moduleLink}&action=settings" class="list-group-item">
            <i class="fa fa-cog fa-fw"></i> Settings
        </a>
    </div>
</div>

<div class="panel panel-info">
    <div class="panel-heading">
        <h3 class="panel-title"><i class="fa fa-info-circle"></i> Module Info</h3>
    </div>
    <div class="panel-body">
        <p><strong>Version:</strong> {$vars['version']}</p>
        <p><strong>PHP:</strong> " . PHP_VERSION . "</p>
        <hr>
        <p class="small text-muted">Secure digital product delivery with licensing.</p>
    </div>
</div>
HTML;
}
