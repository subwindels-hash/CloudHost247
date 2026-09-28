<?php
namespace CloudHost247\ModuleManager\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Additive storage for the non-secret settings an installed module declares in
 * its manifest, so "Modules → Installed → Configure" has somewhere to write.
 *
 * Only operational values live here — a timeout, a default region, a feature
 * toggle. Credentials are rejected by the manifest parser and belong to the
 * encrypted API & Integrations vault, so this table never holds secrets.
 */
final class ModuleSettingsMigration implements Migration
{
    public function version() { return '1.1.0'; }

    public function description() { return 'Create the per-module configuration table for manifest-declared settings'; }

    public function up()
    {
        $schema = Capsule::schema();

        if (!$schema->hasTable('mod_cloudhost247_module_settings')) {
            $schema->create('mod_cloudhost247_module_settings', function ($table) {
                $table->bigIncrements('id');
                $table->string('module_id', 64)->index();
                $table->string('setting_key', 64);
                $table->text('setting_value')->nullable();
                $table->unsignedInteger('updated_by')->nullable();
                $table->dateTime('updated_at')->nullable();
                $table->unique(array('module_id', 'setting_key'), 'ch247_module_setting_unique');
            });
        }
    }
}
