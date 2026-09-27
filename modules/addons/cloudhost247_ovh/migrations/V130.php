<?php
namespace CloudHost247\Ovh\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

final class OvhDiscoveryMigration implements Migration
{
    public function version() { return '1.3.0'; }
    public function description() { return 'Create explicit configurable-option mapping repository'; }
    public function up()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_ovh_option_mappings')) {
            Capsule::schema()->create('mod_cloudhost247_ovh_option_mappings', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('mapping_id');
                $table->unsignedBigInteger('ovh_option_id');
                $table->unsignedInteger('whmcs_option_id');
                $table->unsignedInteger('whmcs_suboption_id')->nullable();
                $table->unsignedInteger('admin_id')->nullable();
                $table->dateTime('created_at');
                $table->unique(array('mapping_id','ovh_option_id'), 'ch247_ovh_option_mapping_unique');
            });
        }
    }
}
