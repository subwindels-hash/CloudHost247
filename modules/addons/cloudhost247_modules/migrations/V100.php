<?php
namespace CloudHost247\ModuleManager\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Additive schema for the Module Manager.
 *
 * Four namespaced tables: the installed-module registry, the uploaded-package
 * ledger, the per-file installation manifest that makes rollback and uninstall
 * exact, and the sanitized module lifecycle log. No WHMCS core table is
 * touched, and nothing here stores credential material.
 */
final class ModuleManagerInitialMigration implements Migration
{
    public function version() { return '1.0.0'; }

    public function description() { return 'Create the module registry, package ledger, installed-file manifest and lifecycle log'; }

    public function up()
    {
        $schema = Capsule::schema();

        if (!$schema->hasTable('mod_cloudhost247_modules')) {
            $schema->create('mod_cloudhost247_modules', function ($table) {
                $table->bigIncrements('id');
                $table->string('module_id', 64)->unique('ch247_module_id_unique');
                $table->string('name', 128)->default('');
                $table->string('version', 32)->default('');
                $table->string('module_type', 24)->index();
                $table->string('author', 128)->default('');
                $table->string('license', 64)->default('');
                $table->string('description', 500)->default('');
                $table->string('entry_point', 255)->default('');
                $table->string('install_path', 255)->default('');
                $table->string('status', 24)->default('installed')->index();
                $table->boolean('enabled')->default(false);
                $table->text('manifest_json')->nullable();
                $table->string('package_checksum', 64)->default('');
                $table->unsignedInteger('file_count')->default(0);
                $table->unsignedBigInteger('installed_bytes')->default(0);
                $table->unsignedInteger('installed_by')->nullable();
                $table->dateTime('installed_at')->nullable();
                $table->unsignedInteger('updated_by')->nullable();
                $table->dateTime('updated_at')->nullable();
                $table->string('previous_version', 32)->default('');
                $table->string('health_status', 32)->default('unknown');
                $table->string('health_detail', 255)->default('');
                $table->dateTime('health_checked_at')->nullable();
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_module_packages')) {
            $schema->create('mod_cloudhost247_module_packages', function ($table) {
                $table->bigIncrements('id');
                $table->string('checksum', 64)->unique('ch247_module_package_unique');
                $table->string('original_name', 128)->default('');
                $table->unsignedBigInteger('size_bytes')->default(0);
                $table->string('module_id', 64)->default('')->index();
                $table->string('module_name', 128)->default('');
                $table->string('version', 32)->default('');
                $table->string('module_type', 24)->default('');
                $table->string('status', 24)->default('uploaded')->index();
                $table->unsignedInteger('file_count')->default(0);
                $table->text('inspection_json')->nullable();
                $table->string('rejected_reason', 500)->default('');
                $table->unsignedInteger('uploaded_by')->nullable();
                $table->dateTime('uploaded_at')->nullable();
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_module_files')) {
            $schema->create('mod_cloudhost247_module_files', function ($table) {
                $table->bigIncrements('id');
                $table->string('module_id', 64)->index();
                $table->string('relative_path', 255);
                $table->string('sha256', 64)->default('');
                $table->unsignedBigInteger('bytes')->default(0);
                $table->string('action', 16)->default('created');
                $table->string('backup_name', 191)->default('');
                $table->dateTime('created_at')->nullable();
                $table->unique(array('module_id', 'relative_path'), 'ch247_module_file_unique');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_module_events')) {
            $schema->create('mod_cloudhost247_module_events', function ($table) {
                $table->bigIncrements('id');
                $table->string('module_id', 64)->default('')->index();
                $table->string('event_type', 32)->index();
                $table->string('result', 16)->default('success')->index();
                $table->string('version_from', 32)->default('');
                $table->string('version_to', 32)->default('');
                $table->string('package_checksum', 64)->default('');
                $table->string('detail', 500)->default('');
                $table->string('correlation_id', 64)->index();
                $table->unsignedInteger('admin_id')->nullable();
                $table->string('admin_ip', 45)->default('');
                $table->dateTime('created_at')->index();
            });
        }
    }
}
