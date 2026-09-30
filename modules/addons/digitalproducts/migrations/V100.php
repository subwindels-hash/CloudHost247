<?php
namespace DigitalProducts\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Non-destructive baseline/hardening migration for the original digitalproducts
 * addon.  The legacy schema is preserved in-place; missing production columns
 * are added and existing data is backfilled rather than recreated.
 */
final class DigitalProductsInitialMigration implements Migration
{
    public function version()
    {
        return '1.0.0';
    }

    public function description()
    {
        return 'Create and harden Digital Products marketplace tables without destroying legacy data';
    }

    public function up()
    {
        $this->products();
        $this->files();
        $this->entitlements();
        $this->licenses();
        $this->tokens();
        $this->downloads();
        $this->apiTokens();
        $this->rateLimits();
        $this->backfill();
        $this->indexes();
    }

    private function products()
    {
        if (!Capsule::schema()->hasTable('mod_digitalproducts_products')) {
            Capsule::schema()->create('mod_digitalproducts_products', function ($table) {
                $table->increments('id');
                $table->unsignedInteger('product_id')->nullable(); // legacy WHMCS product id
                $table->unsignedInteger('whmcs_product_id')->nullable();
                $table->string('product_name', 255);
                $table->string('name', 255)->nullable();
                $table->string('slug', 191)->nullable();
                $table->text('description')->nullable();
                $table->text('short_description')->nullable();
                $table->string('product_type', 32)->default('software');
                $table->string('status', 24)->default('draft');
                $table->unsignedInteger('current_file_id')->nullable();
                $table->unsignedInteger('current_version_id')->nullable();
                $table->unsignedInteger('download_limit')->default(0);
                $table->unsignedInteger('link_expiry_hours')->default(48); // legacy setting
                $table->unsignedInteger('download_expiry_hours')->default(48);
                $table->boolean('license_enabled')->default(true);
                $table->string('license_expiry_mode', 32)->default('none');
                $table->string('access_mode', 32)->default('CURRENT_VERSION');
                $table->dateTime('created_at')->nullable();
                $table->dateTime('updated_at')->nullable();
                $table->index('product_id', 'dp_products_legacy_pid_idx');
                $table->unique('whmcs_product_id', 'dp_products_whmcs_unique');
                $table->index('whmcs_product_id', 'dp_products_whmcs_pid_idx');
                $table->index('status', 'dp_products_status_idx');
                $table->index('slug', 'dp_products_slug_idx');
            });
            return;
        }

        $this->addColumn('mod_digitalproducts_products', 'product_id', function ($table) { $table->unsignedInteger('product_id')->nullable(); });
        $this->addColumn('mod_digitalproducts_products', 'whmcs_product_id', function ($table) { $table->unsignedInteger('whmcs_product_id')->nullable(); });
        $this->addColumn('mod_digitalproducts_products', 'product_name', function ($table) { $table->string('product_name', 255)->nullable(); });
        $this->addColumn('mod_digitalproducts_products', 'name', function ($table) { $table->string('name', 255)->nullable(); });
        $this->addColumn('mod_digitalproducts_products', 'slug', function ($table) { $table->string('slug', 191)->nullable(); });
        $this->addColumn('mod_digitalproducts_products', 'description', function ($table) { $table->text('description')->nullable(); });
        $this->addColumn('mod_digitalproducts_products', 'short_description', function ($table) { $table->text('short_description')->nullable(); });
        $this->addColumn('mod_digitalproducts_products', 'product_type', function ($table) { $table->string('product_type', 32)->default('software'); });
        $this->addColumn('mod_digitalproducts_products', 'status', function ($table) { $table->string('status', 24)->default('draft'); });
        $this->addColumn('mod_digitalproducts_products', 'current_file_id', function ($table) { $table->unsignedInteger('current_file_id')->nullable(); });
        $this->addColumn('mod_digitalproducts_products', 'current_version_id', function ($table) { $table->unsignedInteger('current_version_id')->nullable(); });
        $this->addColumn('mod_digitalproducts_products', 'download_limit', function ($table) { $table->unsignedInteger('download_limit')->default(0); });
        $this->addColumn('mod_digitalproducts_products', 'link_expiry_hours', function ($table) { $table->unsignedInteger('link_expiry_hours')->default(48); });
        $this->addColumn('mod_digitalproducts_products', 'download_expiry_hours', function ($table) { $table->unsignedInteger('download_expiry_hours')->default(48); });
        $this->addColumn('mod_digitalproducts_products', 'license_enabled', function ($table) { $table->boolean('license_enabled')->default(true); });
        $this->addColumn('mod_digitalproducts_products', 'license_expiry_mode', function ($table) { $table->string('license_expiry_mode', 32)->default('none'); });
        $this->addColumn('mod_digitalproducts_products', 'access_mode', function ($table) { $table->string('access_mode', 32)->default('CURRENT_VERSION'); });
        $this->addColumn('mod_digitalproducts_products', 'created_at', function ($table) { $table->dateTime('created_at')->nullable(); });
        $this->addColumn('mod_digitalproducts_products', 'updated_at', function ($table) { $table->dateTime('updated_at')->nullable(); });
        $this->modifyStatusVarchar('mod_digitalproducts_products', 24, 'draft');
    }

    private function files()
    {
        if (!Capsule::schema()->hasTable('mod_digitalproducts_files')) {
            Capsule::schema()->create('mod_digitalproducts_files', function ($table) {
                $table->increments('id');
                $table->unsignedInteger('product_id'); // Digital product id
                $table->string('version', 50)->default('1.0.0');
                $table->string('filename', 255);
                $table->string('original_name', 255);
                $table->string('file_path', 500)->nullable();
                $table->string('storage_provider', 32)->default('local');
                $table->string('storage_key', 500)->nullable();
                $table->string('file_hash', 64)->nullable();
                $table->string('checksum_sha256', 64)->nullable();
                $table->bigInteger('file_size')->unsigned()->default(0);
                $table->text('release_notes')->nullable();
                $table->text('changelog')->nullable();
                $table->string('minimum_php_version', 32)->nullable();
                $table->string('maximum_php_version', 32)->nullable();
                $table->string('minimum_whmcs_version', 32)->nullable();
                $table->string('maximum_whmcs_version', 32)->nullable();
                $table->text('required_extensions')->nullable();
                $table->text('required_modules')->nullable();
                $table->date('release_date')->nullable();
                $table->unsignedInteger('download_count')->default(0);
                $table->string('status', 24)->default('active');
                $table->dateTime('created_at')->nullable();
                $table->dateTime('updated_at')->nullable();
                $table->index('product_id', 'dp_files_product_idx');
                $table->index(array('product_id', 'version'), 'dp_files_product_version_idx');
                $table->index('status', 'dp_files_status_idx');
            });
            return;
        }

        $this->addColumn('mod_digitalproducts_files', 'product_id', function ($table) { $table->unsignedInteger('product_id')->default(0); });
        $this->addColumn('mod_digitalproducts_files', 'version', function ($table) { $table->string('version', 50)->default('1.0.0'); });
        $this->addColumn('mod_digitalproducts_files', 'filename', function ($table) { $table->string('filename', 255)->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'original_name', function ($table) { $table->string('original_name', 255)->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'file_path', function ($table) { $table->string('file_path', 500)->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'storage_provider', function ($table) { $table->string('storage_provider', 32)->default('local'); });
        $this->addColumn('mod_digitalproducts_files', 'storage_key', function ($table) { $table->string('storage_key', 500)->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'file_hash', function ($table) { $table->string('file_hash', 64)->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'checksum_sha256', function ($table) { $table->string('checksum_sha256', 64)->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'file_size', function ($table) { $table->bigInteger('file_size')->unsigned()->default(0); });
        $this->addColumn('mod_digitalproducts_files', 'release_notes', function ($table) { $table->text('release_notes')->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'changelog', function ($table) { $table->text('changelog')->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'minimum_php_version', function ($table) { $table->string('minimum_php_version', 32)->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'maximum_php_version', function ($table) { $table->string('maximum_php_version', 32)->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'minimum_whmcs_version', function ($table) { $table->string('minimum_whmcs_version', 32)->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'maximum_whmcs_version', function ($table) { $table->string('maximum_whmcs_version', 32)->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'required_extensions', function ($table) { $table->text('required_extensions')->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'required_modules', function ($table) { $table->text('required_modules')->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'release_date', function ($table) { $table->date('release_date')->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'download_count', function ($table) { $table->unsignedInteger('download_count')->default(0); });
        $this->addColumn('mod_digitalproducts_files', 'status', function ($table) { $table->string('status', 24)->default('active'); });
        $this->addColumn('mod_digitalproducts_files', 'created_at', function ($table) { $table->dateTime('created_at')->nullable(); });
        $this->addColumn('mod_digitalproducts_files', 'updated_at', function ($table) { $table->dateTime('updated_at')->nullable(); });
        $this->modifyStatusVarchar('mod_digitalproducts_files', 24, 'active');
    }

    private function entitlements()
    {
        if (Capsule::schema()->hasTable('mod_digitalproducts_entitlements')) {
            $this->addColumn('mod_digitalproducts_entitlements', 'download_limit_override', function ($table) { $table->unsignedInteger('download_limit_override')->nullable(); });
            $this->addColumn('mod_digitalproducts_entitlements', 'download_count', function ($table) { $table->unsignedInteger('download_count')->default(0); });
            $this->addColumn('mod_digitalproducts_entitlements', 'last_download_at', function ($table) { $table->dateTime('last_download_at')->nullable(); });
            return;
        }
        Capsule::schema()->create('mod_digitalproducts_entitlements', function ($table) {
            $table->increments('id');
            $table->unsignedInteger('product_id');
            $table->unsignedInteger('whmcs_product_id');
            $table->unsignedInteger('order_id')->default(0);
            $table->unsignedInteger('service_id')->default(0);
            $table->unsignedInteger('client_id');
            $table->unsignedInteger('purchase_version_id')->nullable();
            $table->string('access_mode', 32)->default('CURRENT_VERSION');
            $table->string('status', 24)->default('active');
            $table->dateTime('purchased_at')->nullable();
            $table->dateTime('expires_at')->nullable();
            $table->unsignedInteger('download_limit_override')->nullable();
            $table->unsignedInteger('download_count')->default(0);
            $table->dateTime('last_download_at')->nullable();
            $table->dateTime('created_at')->nullable();
            $table->dateTime('updated_at')->nullable();
            $table->unique(array('client_id', 'service_id', 'product_id'), 'dp_entitlement_unique');
            $table->index('client_id', 'dp_entitlements_client_idx');
            $table->index('product_id', 'dp_entitlements_product_idx');
            $table->index('service_id', 'dp_entitlements_service_idx');
            $table->index('order_id', 'dp_entitlements_order_idx');
            $table->index('status', 'dp_entitlements_status_idx');
        });
    }

    private function licenses()
    {
        if (!Capsule::schema()->hasTable('mod_digitalproducts_licenses')) {
            Capsule::schema()->create('mod_digitalproducts_licenses', function ($table) {
                $table->increments('id');
                $table->unsignedInteger('product_id');
                $table->unsignedInteger('entitlement_id')->nullable();
                $table->unsignedInteger('service_id')->default(0);
                $table->unsignedInteger('client_id');
                $table->string('license_key', 128)->nullable(); // legacy plaintext column
                $table->string('license_hash', 64)->nullable();
                $table->string('license_prefix', 32)->nullable();
                $table->text('license_ciphertext')->nullable();
                $table->string('status', 24)->default('active');
                $table->text('domains')->nullable();
                $table->unsignedInteger('domain_limit')->default(0);
                $table->unsignedInteger('activations_limit')->default(0);
                $table->unsignedInteger('activations_count')->default(0);
                $table->dateTime('expires_at')->nullable();
                $table->dateTime('created_at')->nullable();
                $table->dateTime('updated_at')->nullable();
                $table->index('license_hash', 'dp_license_hash_idx');
                $table->index('license_key', 'dp_license_key_idx');
                $table->index('service_id', 'dp_license_service_idx');
                $table->index('client_id', 'dp_license_client_idx');
                $table->index('product_id', 'dp_license_product_idx');
                $table->unique(array('service_id', 'product_id'), 'dp_license_service_product_unique');
            });
            return;
        }
        $this->addColumn('mod_digitalproducts_licenses', 'entitlement_id', function ($table) { $table->unsignedInteger('entitlement_id')->nullable(); });
        $this->addColumn('mod_digitalproducts_licenses', 'license_hash', function ($table) { $table->string('license_hash', 64)->nullable(); });
        $this->addColumn('mod_digitalproducts_licenses', 'license_prefix', function ($table) { $table->string('license_prefix', 32)->nullable(); });
        $this->addColumn('mod_digitalproducts_licenses', 'license_ciphertext', function ($table) { $table->text('license_ciphertext')->nullable(); });
        $this->addColumn('mod_digitalproducts_licenses', 'domain_limit', function ($table) { $table->unsignedInteger('domain_limit')->default(0); });
        $this->addColumn('mod_digitalproducts_licenses', 'created_at', function ($table) { $table->dateTime('created_at')->nullable(); });
        $this->addColumn('mod_digitalproducts_licenses', 'updated_at', function ($table) { $table->dateTime('updated_at')->nullable(); });
        $this->modifyStatusVarchar('mod_digitalproducts_licenses', 24, 'active');
    }

    private function tokens()
    {
        if (Capsule::schema()->hasTable('mod_digitalproducts_download_tokens')) { return; }
        Capsule::schema()->create('mod_digitalproducts_download_tokens', function ($table) {
            $table->increments('id');
            $table->string('token_hash', 64);
            $table->unsignedInteger('entitlement_id');
            $table->unsignedInteger('file_id');
            $table->unsignedInteger('client_id');
            $table->unsignedInteger('service_id')->default(0);
            $table->unsignedInteger('product_id')->default(0);
            $table->dateTime('expires_at')->nullable();
            $table->dateTime('used_at')->nullable();
            $table->dateTime('revoked_at')->nullable();
            $table->unsignedInteger('uses')->default(0);
            $table->unsignedInteger('max_uses')->default(1);
            $table->dateTime('created_at')->nullable();
            $table->unique('token_hash', 'dp_download_token_hash_unique');
            $table->index('entitlement_id', 'dp_download_token_ent_idx');
            $table->index('client_id', 'dp_download_token_client_idx');
            $table->index('expires_at', 'dp_download_token_expires_idx');
        });
    }

    private function downloads()
    {
        if (!Capsule::schema()->hasTable('mod_digitalproducts_downloads')) {
            Capsule::schema()->create('mod_digitalproducts_downloads', function ($table) {
                $table->increments('id');
                $table->unsignedInteger('file_id')->default(0);
                $table->unsignedInteger('version_id')->default(0);
                $table->unsignedInteger('product_id')->default(0);
                $table->unsignedInteger('service_id')->default(0);
                $table->unsignedInteger('order_id')->default(0);
                $table->unsignedInteger('client_id')->default(0);
                $table->unsignedInteger('token_id')->nullable();
                $table->unsignedInteger('license_id')->nullable();
                $table->string('license_key', 128)->nullable();
                $table->string('download_token', 128)->nullable();
                $table->string('ip_address', 45)->nullable();
                $table->text('user_agent')->nullable();
                $table->string('status', 32)->default('success');
                $table->string('failure_reason', 255)->nullable();
                $table->dateTime('created_at')->nullable();
                $table->dateTime('updated_at')->nullable();
                $table->index('file_id', 'dp_downloads_file_idx');
                $table->index('version_id', 'dp_downloads_version_idx');
                $table->index('client_id', 'dp_downloads_client_idx');
                $table->index('service_id', 'dp_downloads_service_idx');
                $table->index('product_id', 'dp_downloads_product_idx');
                $table->index('status', 'dp_downloads_status_idx');
                $table->index('created_at', 'dp_downloads_created_idx');
            });
            return;
        }
        $this->addColumn('mod_digitalproducts_downloads', 'version_id', function ($table) { $table->unsignedInteger('version_id')->default(0); });
        $this->addColumn('mod_digitalproducts_downloads', 'order_id', function ($table) { $table->unsignedInteger('order_id')->default(0); });
        $this->addColumn('mod_digitalproducts_downloads', 'token_id', function ($table) { $table->unsignedInteger('token_id')->nullable(); });
        $this->addColumn('mod_digitalproducts_downloads', 'license_id', function ($table) { $table->unsignedInteger('license_id')->nullable(); });
        $this->addColumn('mod_digitalproducts_downloads', 'failure_reason', function ($table) { $table->string('failure_reason', 255)->nullable(); });
        $this->addColumn('mod_digitalproducts_downloads', 'created_at', function ($table) { $table->dateTime('created_at')->nullable(); });
        $this->addColumn('mod_digitalproducts_downloads', 'updated_at', function ($table) { $table->dateTime('updated_at')->nullable(); });
        $this->modifyStatusVarchar('mod_digitalproducts_downloads', 32, 'success');
    }

    private function apiTokens()
    {
        if (!Capsule::schema()->hasTable('mod_digitalproducts_api_tokens')) {
            Capsule::schema()->create('mod_digitalproducts_api_tokens', function ($table) {
                $table->increments('id');
                $table->unsignedInteger('client_id')->default(0);
                $table->string('token_name', 100);
                $table->string('api_token', 128)->nullable(); // legacy plaintext token
                $table->string('api_token_hash', 64)->nullable();
                $table->text('permissions')->nullable();
                $table->string('ip_restriction', 255)->nullable();
                $table->string('status', 24)->default('active');
                $table->dateTime('last_used_at')->nullable();
                $table->dateTime('expires_at')->nullable();
                $table->dateTime('created_at')->nullable();
                $table->dateTime('updated_at')->nullable();
                $table->index('client_id', 'dp_api_tokens_client_idx');
                $table->index('api_token_hash', 'dp_api_tokens_hash_idx');
            });
            return;
        }
        $this->addColumn('mod_digitalproducts_api_tokens', 'api_token_hash', function ($table) { $table->string('api_token_hash', 64)->nullable(); });
        $this->addColumn('mod_digitalproducts_api_tokens', 'status', function ($table) { $table->string('status', 24)->default('active'); });
        $this->addColumn('mod_digitalproducts_api_tokens', 'created_at', function ($table) { $table->dateTime('created_at')->nullable(); });
        $this->addColumn('mod_digitalproducts_api_tokens', 'updated_at', function ($table) { $table->dateTime('updated_at')->nullable(); });
    }

    private function rateLimits()
    {
        if (Capsule::schema()->hasTable('mod_digitalproducts_rate_limits')) { return; }
        Capsule::schema()->create('mod_digitalproducts_rate_limits', function ($table) {
            $table->increments('id');
            $table->string('bucket', 191);
            $table->string('identifier_hash', 64);
            $table->unsignedInteger('hits')->default(0);
            $table->dateTime('window_start');
            $table->dateTime('updated_at')->nullable();
            $table->unique(array('bucket', 'identifier_hash'), 'dp_rate_limit_unique');
            $table->index('window_start', 'dp_rate_limit_window_idx');
        });
    }

    private function backfill()
    {
        try { Capsule::statement("UPDATE mod_digitalproducts_products SET whmcs_product_id = product_id WHERE (whmcs_product_id IS NULL OR whmcs_product_id = 0) AND product_id IS NOT NULL"); } catch (\Throwable $e) {}
        try { Capsule::statement("UPDATE mod_digitalproducts_products SET name = product_name WHERE (name IS NULL OR name = '') AND product_name IS NOT NULL"); } catch (\Throwable $e) {}
        try { Capsule::statement("UPDATE mod_digitalproducts_products SET download_expiry_hours = link_expiry_hours WHERE (download_expiry_hours IS NULL OR download_expiry_hours = 0) AND link_expiry_hours IS NOT NULL"); } catch (\Throwable $e) {}
        try { Capsule::statement("UPDATE mod_digitalproducts_products SET current_version_id = current_file_id WHERE (current_version_id IS NULL OR current_version_id = 0) AND current_file_id IS NOT NULL"); } catch (\Throwable $e) {}
        try { Capsule::statement("UPDATE mod_digitalproducts_files SET checksum_sha256 = file_hash WHERE (checksum_sha256 IS NULL OR checksum_sha256 = '') AND file_hash IS NOT NULL"); } catch (\Throwable $e) {}
        try { Capsule::statement("UPDATE mod_digitalproducts_files SET release_notes = changelog WHERE (release_notes IS NULL OR release_notes = '') AND changelog IS NOT NULL"); } catch (\Throwable $e) {}
        try { Capsule::statement("UPDATE mod_digitalproducts_downloads SET version_id = file_id WHERE (version_id IS NULL OR version_id = 0) AND file_id IS NOT NULL"); } catch (\Throwable $e) {}
        try { Capsule::statement("UPDATE mod_digitalproducts_licenses SET license_hash = SHA2(license_key, 256), license_prefix = SUBSTRING(license_key, 1, 16) WHERE (license_hash IS NULL OR license_hash = '') AND license_key IS NOT NULL AND license_key <> ''"); } catch (\Throwable $e) {}
        try { Capsule::statement("UPDATE mod_digitalproducts_api_tokens SET api_token_hash = SHA2(api_token, 256) WHERE (api_token_hash IS NULL OR api_token_hash = '') AND api_token IS NOT NULL AND api_token <> ''"); } catch (\Throwable $e) {}
    }

    private function indexes()
    {
        $this->index('mod_digitalproducts_products', 'dp_products_whmcs_pid_idx', array('whmcs_product_id'));
        $this->index('mod_digitalproducts_products', 'dp_products_status_idx', array('status'));
        $this->index('mod_digitalproducts_files', 'dp_files_product_idx', array('product_id'));
        $this->index('mod_digitalproducts_files', 'dp_files_status_idx', array('status'));
        $this->index('mod_digitalproducts_downloads', 'dp_downloads_created_idx', array('created_at'));
        $this->index('mod_digitalproducts_download_tokens', 'dp_download_token_client_idx', array('client_id'));
        $this->index('mod_digitalproducts_licenses', 'dp_license_hash_idx', array('license_hash'));
    }

    private function addColumn($table, $column, $callback)
    {
        try {
            if (!Capsule::schema()->hasColumn($table, $column)) {
                Capsule::schema()->table($table, $callback);
            }
        } catch (\Throwable $e) {
            // Activation must be non-destructive.  Surface the first hard error
            // through WHMCS activation rather than silently damaging data.
            throw $e;
        }
    }

    private function index($table, $name, array $columns)
    {
        try {
            if (!Capsule::schema()->hasTable($table) || $this->indexExists($table, $name)) { return; }
            Capsule::schema()->table($table, function ($t) use ($columns, $name) { $t->index($columns, $name); });
        } catch (\Throwable $e) {
            // Existing installations may already have equivalent unnamed indexes.
        }
    }

    private function indexExists($table, $name)
    {
        try {
            $rows = Capsule::select('SHOW INDEX FROM `' . str_replace('`', '``', $table) . '` WHERE Key_name = ?', array($name));
            return !empty($rows);
        } catch (\Throwable $e) {
            return false;
        }
    }

    private function modifyStatusVarchar($table, $length, $default)
    {
        try {
            Capsule::statement('ALTER TABLE `' . str_replace('`', '``', $table) . '` MODIFY `status` VARCHAR(' . (int) $length . ") NOT NULL DEFAULT '" . str_replace("'", "''", $default) . "'");
        } catch (\Throwable $e) {
            // Non-MySQL drivers or restricted DB users may reject MODIFY.  The
            // code still uses legacy values when ALTER is unavailable.
        }
    }
}
